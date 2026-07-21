const crypto = require("node:crypto");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");

const db = require("../config/db");
const { readBackupCryptoConfig } = require("../config/backupCryptoConfig");
const { createMigrationRunner } = require("../migrations/runner");
const { createStructuredLogger } = require("../startup/logger");
const { assertExternalBackupDirectory, isLoopbackHost, safetyError } = require("./databaseSafety");
const { runDockerDatabaseTool, sha256File } = require("./databaseTools");
const {
    IV_LENGTH,
    buildHeader,
    createEncryptor,
    encodeHeader
} = require("./encryptedBackupFormat");

const REPOSITORY_ROOT = path.resolve(__dirname, "../..");
const NOOP_LOGGER = { info() {}, warn() {}, error() {} };

function randomToken(bytes = 4) {
    return crypto.randomBytes(bytes).toString("hex");
}

// Deliberately "fittrack-..." rather than the configured database name: the
// filename is a neutral, disposable label, never a place operational
// identifiers are encoded. The actual source database lives, authenticated,
// inside the encrypted header instead.
function createBackupFilename(now) {
    const timestamp = now
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}Z$/, "Z");
    return `fittrack-${timestamp}-${randomToken()}.ftbackup`;
}

// Uses its own dedicated pool (closed immediately after) rather than the
// shared default db pool - a one-shot CLI process must be able to exit on
// its own once createEncryptedBackup() resolves, without the caller having
// to know to close a pool it never explicitly opened.
async function readAppliedMigrations(config) {
    const pool = db.createPool(config);
    try {
        const runner = createMigrationRunner({ pool, logger: NOOP_LOGGER });
        const status = await runner.status();
        return status.applied.map((migration) => migration.id);
    } finally {
        await db.closePool(pool);
    }
}

async function writePrefix(output, prefix) {
    await new Promise((resolve, reject) => {
        output.write(prefix, (error) => (error ? reject(error) : resolve()));
    });
}

async function appendAuthTag(filePath, tag) {
    const stat = await fsPromises.stat(filePath);
    const handle = await fsPromises.open(filePath, "r+");
    try {
        await handle.write(tag, 0, tag.length, stat.size);
        await handle.sync();
    } finally {
        await handle.close();
    }
    return stat.size + tag.length;
}

async function createEncryptedBackup({ env = process.env, now = new Date() } = {}) {
    const config = db.readDatabaseConfig(env);
    if (!isLoopbackHost(config.host)) {
        throw safetyError(
            "BACKUP_TARGET_FORBIDDEN",
            "Encrypted backup creation is restricted to a loopback database target."
        );
    }

    const cryptoConfig = readBackupCryptoConfig(env);
    const requestedDirectory = assertExternalBackupDirectory(env.BACKUP_OUTPUT_DIRECTORY, REPOSITORY_ROOT);
    await fsPromises.mkdir(requestedDirectory, { recursive: true });
    const backupDirectory = await fsPromises.realpath(requestedDirectory);
    assertExternalBackupDirectory(backupDirectory, await fsPromises.realpath(REPOSITORY_ROOT));

    const appliedMigrations = await readAppliedMigrations(config);

    const filename = createBackupFilename(now);
    const finalPath = path.join(backupDirectory, filename);
    const partialPath = `${finalPath}.partial`;

    const iv = crypto.randomBytes(IV_LENGTH);
    const header = buildHeader({
        createdAt: now,
        keyId: cryptoConfig.keyId,
        database: config.database,
        ivBase64: iv.toString("base64"),
        appliedMigrations
    });
    const { prefix, headerBytes } = encodeHeader(header);
    const cipher = createEncryptor({ key: cryptoConfig.key, iv, aad: headerBytes });
    const gzip = zlib.createGzip();

    const output = fs.createWriteStream(partialPath, { flags: "wx", mode: 0o600 });
    try {
        await writePrefix(output, prefix);
        // mysqldump stdout -> gzip -> AES-256-GCM -> the (still ".partial")
        // file, entirely in-flight: the plaintext SQL dump never touches
        // disk on its own, only ever as ciphertext.
        await runDockerDatabaseTool({
            container: env.FITTRACK_DB_CONTAINER || "fittrack_mysql",
            executable: "mysqldump",
            password: config.password,
            toolArgs: [
                `--user=${config.user}`,
                "--single-transaction",
                "--quick",
                "--routines",
                "--triggers",
                "--events",
                "--hex-blob",
                "--set-gtid-purged=OFF",
                "--no-tablespaces",
                "--skip-lock-tables",
                "--default-character-set=utf8mb4",
                config.database
            ],
            output,
            outputTransforms: [gzip, cipher]
        });

        const tag = cipher.getAuthTag();
        const bytes = await appendAuthTag(partialPath, tag);
        const ciphertextSha256 = await sha256File(partialPath);

        // Only now, after dump + compression + encryption + authentication
        // tag are all fully and successfully written, does the file get its
        // real name - an interrupted or failed run never leaves a
        // plausible-looking backup behind.
        await fsPromises.rename(partialPath, finalPath);

        return {
            result: "ok",
            filename,
            bytes,
            formatVersion: header.formatVersion,
            keyId: header.keyId,
            createdAt: header.createdAt,
            durationMs: Date.now() - now.getTime(),
            ciphertextSha256
        };
    } catch (error) {
        output.destroy();
        await fsPromises.rm(partialPath, { force: true });
        throw error;
    }
}

async function main() {
    const report = await createEncryptedBackup();
    process.stdout.write(`${JSON.stringify(report)}\n`);
}

if (require.main === module) {
    main().catch((error) => {
        createStructuredLogger().error("backup_create_failed", { error });
        process.exitCode = 1;
    });
}

module.exports = {
    REPOSITORY_ROOT,
    createBackupFilename,
    createEncryptedBackup,
    main
};
