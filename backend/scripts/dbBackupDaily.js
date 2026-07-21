const fsPromises = require("node:fs/promises");
const path = require("node:path");

const db = require("../config/db");
const { createBackup, REPOSITORY_ROOT } = require("./dbBackup");
const {
    applyBackupRetention,
    assertAutomatedBackupEnvironment,
    backupPolicyError,
    createBackupManifest,
    resolveBackupDirectory,
    safeBackupFailure,
    writeJsonExclusive
} = require("./databaseBackupPolicy");
const { assertLegacyUnencryptedBackupAllowed } = require("./databaseSafety");
const {
    compressLogicalBackupFile,
    createBackupFilename,
    runDockerDatabaseTool,
    verifyGzipLogicalBackupFile
} = require("./databaseTools");

function normalizeIdentity(value) {
    const database = value?.database;
    const serverUuid = String(value?.serverUuid || "").toLowerCase();
    if (!/^[A-Za-z0-9_$-]+$/.test(database || "") || !/^[a-f0-9-]{36}$/.test(serverUuid)) {
        throw backupPolicyError(
            "BACKUP_TARGET_MISMATCH",
            "Database target identity could not be established."
        );
    }
    return { database, serverUuid };
}

function assertMatchingDatabaseIdentities({ configured, container, expectedDatabase }) {
    const configuredIdentity = normalizeIdentity(configured);
    const containerIdentity = normalizeIdentity(container);
    if (
        configuredIdentity.database !== expectedDatabase ||
        containerIdentity.database !== expectedDatabase ||
        configuredIdentity.serverUuid !== containerIdentity.serverUuid
    ) {
        throw backupPolicyError(
            "BACKUP_TARGET_MISMATCH",
            "Configured database and Docker backup target are not the same MySQL instance."
        );
    }
    return configuredIdentity;
}

async function readConfiguredDatabaseIdentity(config, database = db) {
    const pool = database.createPool(config);
    try {
        const [rows] = await pool.promise().query(
            "SELECT DATABASE() AS databaseName, @@server_uuid AS serverUuid"
        );
        return normalizeIdentity({
            database: rows[0]?.databaseName,
            serverUuid: rows[0]?.serverUuid
        });
    } finally {
        await database.closePool(pool);
    }
}

async function readContainerDatabaseIdentity(config, container, runTool = runDockerDatabaseTool) {
    const output = await runTool({
        container,
        executable: "mysql",
        password: config.password,
        toolArgs: [
            `--user=${config.user}`,
            "--protocol=socket",
            "--batch",
            "--skip-column-names",
            "--raw",
            `--database=${config.database}`,
            "--execute=SELECT DATABASE(), @@server_uuid"
        ],
        captureOutput: true
    });
    const lines = String(output || "")
        .trim()
        .split(/\r?\n/)
        .filter(Boolean);
    const fields = lines.length === 1 ? lines[0].split("\t") : [];
    if (fields.length !== 2) {
        throw backupPolicyError(
            "BACKUP_TARGET_MISMATCH",
            "Docker database target identity could not be established."
        );
    }
    return normalizeIdentity({ database: fields[0], serverUuid: fields[1] });
}

async function acquireBackupLock(backupDirectory, now = new Date()) {
    const lockPath = path.join(backupDirectory, ".fittrack-backup.lock");
    let handle;
    try {
        handle = await fsPromises.open(lockPath, "wx", 0o600);
        await handle.writeFile(
            `${JSON.stringify({ schemaVersion: 1, startedAt: now.toISOString(), pid: process.pid })}\n`,
            "utf8"
        );
        await handle.sync();
    } catch (error) {
        if (handle) await handle.close();
        if (error?.code !== "EEXIST") await fsPromises.rm(lockPath, { force: true });
        if (error?.code === "EEXIST") {
            throw backupPolicyError("BACKUP_LOCKED", "Another backup run holds the backup lock.");
        }
        throw error;
    }
    await handle.close();
    return async () => fsPromises.rm(lockPath, { force: true });
}

async function createDailyBackup({
    env = process.env,
    now = new Date(),
    repositoryRoot = REPOSITORY_ROOT,
    dependencies = {}
} = {}) {
    const services = {
        readDatabaseConfig: db.readDatabaseConfig,
        readConfiguredIdentity: readConfiguredDatabaseIdentity,
        readContainerIdentity: readContainerDatabaseIdentity,
        createRawBackup: createBackup,
        compress: compressLogicalBackupFile,
        verifyCompressed: verifyGzipLogicalBackupFile,
        writeJson: writeJsonExclusive,
        rename: fsPromises.rename,
        remove: fsPromises.rm,
        retention: applyBackupRetention,
        acquireLock: acquireBackupLock,
        clock: () => new Date(),
        ...dependencies
    };
    const config = services.readDatabaseConfig(env);
    // Must run before resolveBackupDirectory/acquireLock create anything on
    // disk - a rejected legacy run should leave zero trace, not even a
    // lock file.
    assertLegacyUnencryptedBackupAllowed(env);
    const automation = assertAutomatedBackupEnvironment(env, config, repositoryRoot);
    const backupDirectory = await resolveBackupDirectory({
        directory: automation.directory,
        repositoryRoot,
        create: true
    });
    const releaseLock = await services.acquireLock(backupDirectory, now);

    let rawPath;
    let artifactPartialPath;
    let artifactPath;
    let manifestPartialPath;
    let manifestPath;
    let published = false;
    try {
        const [configuredIdentity, containerIdentity] = await Promise.all([
            services.readConfiguredIdentity(config),
            services.readContainerIdentity(config, automation.container)
        ]);
        const identity = assertMatchingDatabaseIdentities({
            configured: configuredIdentity,
            container: containerIdentity,
            expectedDatabase: automation.database
        });

        const raw = await services.createRawBackup({ env, now });
        const expectedRawPath = path.join(
            backupDirectory,
            createBackupFilename(automation.database, now)
        );
        if (path.resolve(raw.path) !== path.resolve(expectedRawPath)) {
            throw backupPolicyError(
                "BACKUP_INTEGRITY_FAILED",
                "Raw backup was created at an unexpected path."
            );
        }
        rawPath = expectedRawPath;
        artifactPath = `${rawPath}.gz`;
        artifactPartialPath = `${artifactPath}.partial`;
        manifestPath = `${artifactPath}.manifest.json`;
        manifestPartialPath = `${manifestPath}.partial`;

        const compressed = await services.compress(rawPath, artifactPartialPath);
        const verified = await services.verifyCompressed(artifactPartialPath, {
            bytes: compressed.bytes,
            sha256: compressed.sha256,
            logicalBytes: raw.bytes,
            logicalSha256: raw.sha256
        });
        const completedAt = services.clock();
        const manifest = createBackupManifest({
            database: automation.database,
            serverUuid: identity.serverUuid,
            createdAt: now,
            completedAt,
            artifactName: path.basename(artifactPath),
            artifactVerification: {
                bytes: verified.bytes,
                sha256: verified.sha256
            },
            logicalVerification: {
                bytes: verified.logicalBytes,
                sha256: verified.logicalSha256
            }
        });
        await services.writeJson(manifestPartialPath, manifest);
        await services.rename(artifactPartialPath, artifactPath);
        await services.rename(manifestPartialPath, manifestPath);
        published = true;
        await services.remove(rawPath);
        rawPath = undefined;

        let retention;
        try {
            retention = await services.retention({
                backupDirectory,
                database: automation.database
            });
        } catch (error) {
            error.backupCreated = true;
            throw error;
        }
        return {
            schemaVersion: 1,
            event: "database_backup_completed",
            status: "ok",
            code: "BACKUP_CREATED",
            exitCode: 0,
            createdAt: manifest.completedAt,
            database: automation.database,
            sourceIdentityVerified: true,
            artifact: {
                name: manifest.artifact.name,
                bytes: manifest.artifact.bytes,
                sha256: manifest.artifact.sha256
            },
            retention
        };
    } catch (error) {
        for (const candidate of [artifactPartialPath, manifestPartialPath]) {
            if (candidate) await services.remove(candidate, { force: true });
        }
        if (!published) {
            for (const candidate of [artifactPath, manifestPath, rawPath]) {
                if (candidate) await services.remove(candidate, { force: true });
            }
        } else {
            error.backupCreated = true;
        }
        throw error;
    } finally {
        await releaseLock();
    }
}

async function main() {
    const report = await createDailyBackup();
    process.stdout.write(`${JSON.stringify(report)}\n`);
    return report;
}

if (require.main === module) {
    main().catch((error) => {
        const report = safeBackupFailure(error, "database_backup_failed");
        process.stderr.write(`${JSON.stringify(report)}\n`);
        process.exitCode = report.exitCode;
    });
}

module.exports = {
    acquireBackupLock,
    assertMatchingDatabaseIdentities,
    createDailyBackup,
    main,
    normalizeIdentity,
    readConfiguredDatabaseIdentity,
    readContainerDatabaseIdentity
};
