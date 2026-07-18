const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const path = require("node:path");

const {
    assertContainerName,
    sha256File,
    toolError
} = require("./databaseTools");
const {
    assertExternalBackupDirectory,
    isLoopbackHost
} = require("./databaseSafety");

const BACKUP_KIND = "fittrack.mysql.logical-backup";
const BACKUP_SCHEMA_VERSION = 1;
const BACKUP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_MANIFEST_BYTES = 64 * 1024;
const RETENTION_POLICY = Object.freeze({ daily: 7, weekly: 4, monthly: 3 });

const EXIT_CODES = Object.freeze({
    OK: 0,
    CONFIG_UNSAFE: 10,
    FAILED: 20,
    MISSING: 21,
    STALE: 22,
    INTEGRITY: 23,
    RETENTION: 24,
    LOCKED: 25
});

function backupPolicyError(code, message, details = {}) {
    return toolError(code, message, details);
}

function requiredText(env, name) {
    const value = env?.[name];
    if (typeof value !== "string" || value.length === 0) {
        throw backupPolicyError(
            "BACKUP_CONFIG_UNSAFE",
            `${name} must be explicitly configured for automated backups.`
        );
    }
    return value;
}

function assertDatabaseName(database) {
    if (!/^[A-Za-z0-9_$-]+$/.test(database || "")) {
        throw backupPolicyError("BACKUP_CONFIG_UNSAFE", "Backup database name is invalid.");
    }
    return database;
}

function assertAbsoluteExternalDirectory(directory, repositoryRoot) {
    if (!path.isAbsolute(directory)) {
        throw backupPolicyError(
            "BACKUP_LOCATION_FORBIDDEN",
            "Automated backup storage must use an absolute path outside the repository."
        );
    }
    const resolved = assertExternalBackupDirectory(directory, repositoryRoot);
    if (path.parse(resolved).root === resolved) {
        throw backupPolicyError(
            "BACKUP_LOCATION_FORBIDDEN",
            "A filesystem root cannot be used as the backup directory."
        );
    }
    return resolved;
}

function assertBackupStatusEnvironment(env, repositoryRoot) {
    const database = assertDatabaseName(requiredText(env, "DB_NAME"));
    const expectedDatabase = requiredText(env, "FITTRACK_BACKUP_EXPECTED_DATABASE");
    if (expectedDatabase !== database) {
        throw backupPolicyError(
            "BACKUP_TARGET_MISMATCH",
            "Configured and explicitly expected backup databases do not match."
        );
    }
    if (requiredText(env, "FITTRACK_BACKUP_ACK") !== `backup:${database}`) {
        throw backupPolicyError(
            "BACKUP_ACK_INVALID",
            "Automated backup acknowledgement does not match the configured database."
        );
    }
    const directory = assertAbsoluteExternalDirectory(
        requiredText(env, "FITTRACK_BACKUP_DIR"),
        repositoryRoot
    );
    return { database, directory };
}

function assertAutomatedBackupEnvironment(env, config, repositoryRoot) {
    const statusConfig = assertBackupStatusEnvironment(env, repositoryRoot);
    for (const name of ["DB_HOST", "DB_USER", "DB_PASSWORD", "FITTRACK_DB_CONTAINER"]) {
        requiredText(env, name);
    }
    if (!isLoopbackHost(config?.host)) {
        throw backupPolicyError(
            "BACKUP_TARGET_FORBIDDEN",
            "Automated Docker backups are restricted to a loopback database target."
        );
    }
    if (config.database !== statusConfig.database) {
        throw backupPolicyError(
            "BACKUP_TARGET_MISMATCH",
            "Resolved and explicitly expected backup databases do not match."
        );
    }
    assertContainerName(env.FITTRACK_DB_CONTAINER);
    return {
        ...statusConfig,
        container: env.FITTRACK_DB_CONTAINER
    };
}

async function resolveBackupDirectory({ directory, repositoryRoot, create = false }) {
    if (create) await fsPromises.mkdir(directory, { recursive: true });
    try {
        const [backupDirectory, realRepositoryRoot] = await Promise.all([
            fsPromises.realpath(directory),
            fsPromises.realpath(repositoryRoot)
        ]);
        assertAbsoluteExternalDirectory(backupDirectory, realRepositoryRoot);
        return backupDirectory;
    } catch (error) {
        if (!create && error?.code === "ENOENT") {
            throw backupPolicyError("BACKUP_MISSING", "Backup directory does not exist.");
        }
        throw error;
    }
}

function timestampToken(date) {
    return date
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}Z$/, "Z");
}

function validDate(value, field) {
    if (typeof value !== "string") {
        throw backupPolicyError("BACKUP_INTEGRITY_FAILED", `${field} is invalid.`);
    }
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
        throw backupPolicyError("BACKUP_INTEGRITY_FAILED", `${field} is invalid.`);
    }
    return parsed;
}

function validSha256(value, field) {
    if (!/^[a-f0-9]{64}$/.test(value || "")) {
        throw backupPolicyError("BACKUP_INTEGRITY_FAILED", `${field} is invalid.`);
    }
    return value;
}

function validPositiveInteger(value, field, minimum = 1) {
    if (!Number.isSafeInteger(value) || value < minimum) {
        throw backupPolicyError("BACKUP_INTEGRITY_FAILED", `${field} is invalid.`);
    }
    return value;
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function validateBackupManifest(manifest) {
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
        throw backupPolicyError("BACKUP_INTEGRITY_FAILED", "Backup manifest is invalid.");
    }
    if (manifest.schemaVersion !== BACKUP_SCHEMA_VERSION || manifest.kind !== BACKUP_KIND) {
        throw backupPolicyError("BACKUP_INTEGRITY_FAILED", "Backup manifest format is unsupported.");
    }
    if (manifest.state !== "complete") {
        throw backupPolicyError("BACKUP_INTEGRITY_FAILED", "Backup manifest is not complete.");
    }
    const database = manifest.source?.database;
    if (!/^[A-Za-z0-9_$-]+$/.test(database || "")) {
        throw backupPolicyError("BACKUP_INTEGRITY_FAILED", "Backup source database is invalid.");
    }
    if (!/^[a-f0-9-]{36}$/i.test(manifest.source?.serverUuid || "")) {
        throw backupPolicyError("BACKUP_INTEGRITY_FAILED", "Backup source identity is invalid.");
    }
    const createdAt = validDate(manifest.createdAt, "Backup creation time");
    const completedAt = validDate(manifest.completedAt, "Backup completion time");
    if (completedAt < createdAt) {
        throw backupPolicyError("BACKUP_INTEGRITY_FAILED", "Backup completion precedes creation.");
    }

    const artifactName = manifest.artifact?.name;
    const expectedName = `${database}-${timestampToken(createdAt)}.sql.gz`;
    if (
        typeof artifactName !== "string" ||
        path.basename(artifactName) !== artifactName ||
        artifactName !== expectedName
    ) {
        throw backupPolicyError("BACKUP_INTEGRITY_FAILED", "Backup artifact name is invalid.");
    }
    if (manifest.artifact.compression !== "gzip") {
        throw backupPolicyError("BACKUP_INTEGRITY_FAILED", "Backup compression metadata is invalid.");
    }
    validPositiveInteger(manifest.artifact.bytes, "Compressed backup size");
    validSha256(manifest.artifact.sha256, "Compressed backup hash");
    validPositiveInteger(manifest.logicalDump?.bytes, "Logical backup size", 256);
    validSha256(manifest.logicalDump?.sha256, "Logical backup hash");
    return manifest;
}

function createBackupManifest({
    database,
    serverUuid,
    createdAt,
    completedAt,
    artifactName,
    artifactVerification,
    logicalVerification
}) {
    const manifest = {
        schemaVersion: BACKUP_SCHEMA_VERSION,
        kind: BACKUP_KIND,
        state: "complete",
        createdAt: createdAt.toISOString(),
        completedAt: completedAt.toISOString(),
        source: {
            database,
            serverUuid: String(serverUuid).toLowerCase()
        },
        artifact: {
            name: artifactName,
            compression: "gzip",
            bytes: artifactVerification.bytes,
            sha256: artifactVerification.sha256
        },
        logicalDump: {
            bytes: logicalVerification.bytes,
            sha256: logicalVerification.sha256
        }
    };
    return validateBackupManifest(manifest);
}

function manifestPathForArtifact(artifactPath) {
    return `${artifactPath}.manifest.json`;
}

async function writeJsonExclusive(filename, value) {
    const handle = await fsPromises.open(filename, "wx", 0o600);
    try {
        await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
        await handle.sync();
    } finally {
        await handle.close();
    }
}

function isWithin(root, candidate) {
    const relative = path.relative(root, candidate);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function readAndVerifyBackupManifest(
    manifestPath,
    { expectedDatabase, expectedArtifactPath, verifyHash = true } = {}
) {
    let manifestStat;
    try {
        manifestStat = await fsPromises.lstat(manifestPath);
    } catch (error) {
        if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
            throw backupPolicyError(
                "BACKUP_INTEGRITY_FAILED",
                "Backup manifest file is missing."
            );
        }
        throw error;
    }
    if (
        !manifestStat.isFile() ||
        manifestStat.isSymbolicLink() ||
        manifestStat.size < 32 ||
        manifestStat.size > MAX_MANIFEST_BYTES
    ) {
        throw backupPolicyError("BACKUP_INTEGRITY_FAILED", "Backup manifest file is invalid.");
    }

    let manifest;
    try {
        manifest = validateBackupManifest(
            JSON.parse(await fsPromises.readFile(manifestPath, "utf8"))
        );
    } catch (error) {
        if (error?.code === "BACKUP_INTEGRITY_FAILED") throw error;
        throw backupPolicyError("BACKUP_INTEGRITY_FAILED", "Backup manifest JSON is invalid.");
    }
    if (expectedDatabase && manifest.source.database !== expectedDatabase) {
        throw backupPolicyError("BACKUP_INTEGRITY_FAILED", "Backup manifest database is unexpected.");
    }
    if (path.basename(manifestPath) !== `${manifest.artifact.name}.manifest.json`) {
        throw backupPolicyError("BACKUP_INTEGRITY_FAILED", "Backup manifest filename is invalid.");
    }

    const backupDirectory = await fsPromises.realpath(path.dirname(manifestPath));
    const artifactCandidate = path.join(backupDirectory, manifest.artifact.name);
    let artifactStat;
    try {
        artifactStat = await fsPromises.lstat(artifactCandidate);
    } catch (error) {
        if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
            throw backupPolicyError(
                "BACKUP_INTEGRITY_FAILED",
                "Backup artifact file is missing."
            );
        }
        throw error;
    }
    if (!artifactStat.isFile() || artifactStat.isSymbolicLink()) {
        throw backupPolicyError("BACKUP_INTEGRITY_FAILED", "Backup artifact file is invalid.");
    }
    const artifactPath = await fsPromises.realpath(artifactCandidate);
    if (!isWithin(backupDirectory, artifactPath)) {
        throw backupPolicyError("BACKUP_INTEGRITY_FAILED", "Backup artifact escapes its directory.");
    }
    if (expectedArtifactPath) {
        const expectedRealPath = await fsPromises.realpath(expectedArtifactPath);
        if (path.relative(expectedRealPath, artifactPath) !== "") {
            throw backupPolicyError("BACKUP_INTEGRITY_FAILED", "Backup artifact is not the expected file.");
        }
    }
    if (artifactStat.size !== manifest.artifact.bytes) {
        throw backupPolicyError("BACKUP_INTEGRITY_FAILED", "Backup artifact size is invalid.");
    }
    if (verifyHash && (await sha256File(artifactPath)) !== manifest.artifact.sha256) {
        throw backupPolicyError("BACKUP_INTEGRITY_FAILED", "Backup artifact hash is invalid.");
    }

    return {
        manifest,
        manifestPath: await fsPromises.realpath(manifestPath),
        artifactPath
    };
}

function ownedManifestPattern(database) {
    return new RegExp(
        `^${escapeRegExp(database)}-\\d{8}T\\d{6}Z\\.sql\\.gz\\.manifest\\.json$`
    );
}

async function listVerifiedBackups({ backupDirectory, database, verifyHash = true }) {
    const entries = await fsPromises.readdir(backupDirectory, { withFileTypes: true });
    const pattern = ownedManifestPattern(database);
    const backups = [];
    for (const entry of entries) {
        if (!pattern.test(entry.name)) continue;
        backups.push(
            await readAndVerifyBackupManifest(path.join(backupDirectory, entry.name), {
                expectedDatabase: database,
                verifyHash
            })
        );
    }
    backups.sort(
        (left, right) =>
            new Date(right.manifest.completedAt) - new Date(left.manifest.completedAt) ||
            right.manifest.artifact.name.localeCompare(left.manifest.artifact.name)
    );
    return backups;
}

function isoWeekBucket(value) {
    const source = new Date(value);
    const date = new Date(Date.UTC(
        source.getUTCFullYear(),
        source.getUTCMonth(),
        source.getUTCDate()
    ));
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - day);
    const weekYear = date.getUTCFullYear();
    const yearStart = new Date(Date.UTC(weekYear, 0, 1));
    const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
    return `${weekYear}-W${String(week).padStart(2, "0")}`;
}

function selectRetentionBackups(backups, policy = RETENTION_POLICY) {
    const sorted = [...backups].sort(
        (left, right) =>
            new Date(right.manifest.completedAt) - new Date(left.manifest.completedAt)
    );
    const keep = new Set();
    const select = (limit, bucket) => {
        const seen = new Set();
        for (const backup of sorted) {
            const key = bucket(new Date(backup.manifest.completedAt));
            if (seen.has(key)) continue;
            seen.add(key);
            if (seen.size <= limit) keep.add(backup.manifest.artifact.name);
            if (seen.size >= limit) break;
        }
    };
    select(policy.daily, (date) => date.toISOString().slice(0, 10));
    select(policy.weekly, isoWeekBucket);
    select(policy.monthly, (date) => date.toISOString().slice(0, 7));
    if (sorted[0]) keep.add(sorted[0].manifest.artifact.name);
    return {
        keep: sorted.filter((backup) => keep.has(backup.manifest.artifact.name)),
        remove: sorted.filter((backup) => !keep.has(backup.manifest.artifact.name))
    };
}

async function applyBackupRetention({ backupDirectory, database }) {
    const backups = await listVerifiedBackups({ backupDirectory, database, verifyHash: true });
    const plan = selectRetentionBackups(backups);
    try {
        for (const backup of [...plan.remove].reverse()) {
            await readAndVerifyBackupManifest(backup.manifestPath, {
                expectedDatabase: database,
                expectedArtifactPath: backup.artifactPath,
                verifyHash: true
            });
        }
        for (const backup of [...plan.remove].reverse()) {
            await fsPromises.rm(backup.manifestPath);
            await fsPromises.rm(backup.artifactPath);
        }
    } catch (error) {
        throw backupPolicyError(
            "BACKUP_RETENTION_FAILED",
            "Backup retention could not be applied safely.",
            { cause: error }
        );
    }
    return {
        policy: RETENTION_POLICY,
        kept: plan.keep.length,
        removed: plan.remove.length
    };
}

function backupExitCode(code) {
    if (code === "BACKUP_MISSING") return EXIT_CODES.MISSING;
    if (code === "BACKUP_STALE") return EXIT_CODES.STALE;
    if (code === "BACKUP_INTEGRITY_FAILED" || code === "BACKUP_VERIFICATION_FAILED") {
        return EXIT_CODES.INTEGRITY;
    }
    if (code === "BACKUP_RETENTION_FAILED") return EXIT_CODES.RETENTION;
    if (code === "BACKUP_LOCKED") return EXIT_CODES.LOCKED;
    if (
        [
            "BACKUP_CONFIG_UNSAFE",
            "BACKUP_LOCATION_REQUIRED",
            "BACKUP_LOCATION_FORBIDDEN",
            "BACKUP_TARGET_FORBIDDEN",
            "BACKUP_TARGET_MISMATCH",
            "BACKUP_ACK_INVALID",
            "DATABASE_TOOL_CONFIG_INVALID"
        ].includes(code)
    ) {
        return EXIT_CODES.CONFIG_UNSAFE;
    }
    return EXIT_CODES.FAILED;
}

function safeBackupFailure(error, event, now = new Date()) {
    const candidate = typeof error?.code === "string" ? error.code : "BACKUP_FAILED";
    const knownCodes = new Set([
        "BACKUP_ACK_INVALID",
        "BACKUP_CONFIG_UNSAFE",
        "BACKUP_FAILED",
        "BACKUP_INTEGRITY_FAILED",
        "BACKUP_LOCATION_FORBIDDEN",
        "BACKUP_LOCATION_REQUIRED",
        "BACKUP_LOCKED",
        "BACKUP_MISSING",
        "BACKUP_RETENTION_FAILED",
        "BACKUP_STALE",
        "BACKUP_TARGET_FORBIDDEN",
        "BACKUP_TARGET_MISMATCH",
        "BACKUP_VERIFICATION_FAILED",
        "DATABASE_TOOL_CONFIG_INVALID",
        "DATABASE_TOOL_FAILED",
        "DATABASE_TOOL_UNAVAILABLE"
    ]);
    const code = knownCodes.has(candidate) ? candidate : "BACKUP_FAILED";
    return {
        schemaVersion: 1,
        event,
        status: "failed",
        code,
        exitCode: backupExitCode(code),
        timestamp: now.toISOString(),
        ...(error?.backupCreated === true ? { backupCreated: true } : {})
    };
}

async function checkBackupStatus({ env, repositoryRoot, now = new Date() }) {
    const config = assertBackupStatusEnvironment(env, repositoryRoot);
    const backupDirectory = await resolveBackupDirectory({
        directory: config.directory,
        repositoryRoot,
        create: false
    });
    const backups = await listVerifiedBackups({
        backupDirectory,
        database: config.database,
        verifyHash: true
    });
    if (backups.length === 0) {
        throw backupPolicyError("BACKUP_MISSING", "No complete backup manifest was found.");
    }
    const latest = backups[0];
    const completedAt = new Date(latest.manifest.completedAt);
    const ageMs = now - completedAt;
    if (ageMs < -MAX_CLOCK_SKEW_MS) {
        throw backupPolicyError("BACKUP_INTEGRITY_FAILED", "Latest backup is dated in the future.");
    }
    const stale = ageMs > BACKUP_MAX_AGE_MS;
    return {
        schemaVersion: 1,
        event: "database_backup_status",
        status: stale ? "stale" : "ok",
        code: stale ? "BACKUP_STALE" : "BACKUP_OK",
        exitCode: stale ? EXIT_CODES.STALE : EXIT_CODES.OK,
        checkedAt: now.toISOString(),
        database: config.database,
        latest: {
            artifact: latest.manifest.artifact.name,
            completedAt: latest.manifest.completedAt,
            ageSeconds: Math.max(0, Math.floor(ageMs / 1000)),
            bytes: latest.manifest.artifact.bytes,
            sha256: latest.manifest.artifact.sha256
        },
        maximumAgeSeconds: BACKUP_MAX_AGE_MS / 1000,
        targetOutsideRepository: true
    };
}

module.exports = {
    BACKUP_KIND,
    BACKUP_MAX_AGE_MS,
    BACKUP_SCHEMA_VERSION,
    EXIT_CODES,
    RETENTION_POLICY,
    applyBackupRetention,
    assertAutomatedBackupEnvironment,
    assertBackupStatusEnvironment,
    backupExitCode,
    backupPolicyError,
    checkBackupStatus,
    createBackupManifest,
    isoWeekBucket,
    listVerifiedBackups,
    manifestPathForArtifact,
    readAndVerifyBackupManifest,
    resolveBackupDirectory,
    safeBackupFailure,
    selectRetentionBackups,
    validateBackupManifest,
    writeJsonExclusive
};
