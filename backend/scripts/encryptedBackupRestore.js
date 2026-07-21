const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const mysql = require("mysql2");
const path = require("node:path");
const zlib = require("node:zlib");
const { Writable } = require("node:stream");

const db = require("../config/db");
const { readBackupCryptoConfig } = require("../config/backupCryptoConfig");
const { readBackupTimeoutConfig } = require("../config/backupTimeoutConfig");
const { createStructuredLogger } = require("../startup/logger");
const {
    assertRestoreEnabled,
    assertRestoreTargetAcknowledgement,
    assertRestoreTargetAvailability,
    assertRestoreTargetDatabase,
    isLoopbackHost,
    safetyError
} = require("./databaseSafety");
const { runDockerDatabaseTool } = require("./databaseTools");
const { backupCliExitCode } = require("./backupExitCodes");
const { createDecryptor, readBackupFileLayout } = require("./encryptedBackupFormat");
const { readAndProcessEncryptedBackup } = require("./encryptedBackupStream");

function requiredTargetDatabase(env) {
    const value = env.FITTRACK_RESTORE_TARGET_DATABASE;
    if (typeof value !== "string" || !value.trim()) {
        throw safetyError(
            "RESTORE_TARGET_REQUIRED",
            "FITTRACK_RESTORE_TARGET_DATABASE must be explicitly set."
        );
    }
    return value.trim();
}

async function resolveRestoreFile(env) {
    const value = env.FITTRACK_RESTORE_FILE;
    if (typeof value !== "string" || !value.trim()) {
        throw safetyError(
            "BACKUP_FILE_REQUIRED",
            "FITTRACK_RESTORE_FILE must point to an existing .ftbackup file."
        );
    }
    const filePath = path.resolve(value.trim());
    if (path.extname(filePath).toLowerCase() !== ".ftbackup") {
        throw safetyError("BACKUP_FILE_INVALID", "Restore input must be a .ftbackup file.");
    }
    await fsPromises.access(filePath, fs.constants.R_OK);
    return filePath;
}

function discardSink() {
    return new Writable({
        write(chunk, encoding, callback) {
            callback();
        }
    });
}

async function databaseExists(adminConfig, name) {
    const admin = db.createAdminConnection(adminConfig);
    try {
        const [rows] = await admin.query(
            "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?",
            [name]
        );
        return rows.length > 0;
    } finally {
        await admin.end();
    }
}

async function recreateTargetDatabase(adminConfig, targetDatabase) {
    const admin = db.createAdminConnection(adminConfig);
    try {
        await admin.query(`DROP DATABASE IF EXISTS ${mysql.escapeId(targetDatabase)}`);
        await admin.query(
            `CREATE DATABASE ${mysql.escapeId(targetDatabase)}
             CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`
        );
    } finally {
        await admin.end();
    }
}

async function restoreEncryptedBackup({ env = process.env } = {}) {
    // BACKUP_RESTORE_ENABLED is the single explicit authorization switch -
    // NODE_ENV is never consulted for authorization here, so a genuine
    // recovery run against a real incident environment never has to lie
    // about its own NODE_ENV just to use this tool.
    assertRestoreEnabled(env);
    const adminConfig = db.readDatabaseConfig(env, { includeDatabase: false });
    if (!isLoopbackHost(adminConfig.host)) {
        throw safetyError(
            "RESTORE_TARGET_FORBIDDEN",
            "Encrypted backup restore is restricted to a loopback database target."
        );
    }

    const targetDatabase = requiredTargetDatabase(env);
    // Bound to the exact target database name, not just a constant phrase -
    // an operator must confirm which specific database is about to be
    // dropped and recreated, not paste the same phrase for any target.
    assertRestoreTargetAcknowledgement(env, targetDatabase);
    const cryptoConfig = readBackupCryptoConfig(env);
    const timeoutConfig = readBackupTimeoutConfig(env);
    const filePath = await resolveRestoreFile(env);

    // Pass 1 - authenticate the whole file before anything about the
    // target database is touched. Identical contract to the standalone
    // verify command: full decrypt + decompress + read-to-end, discarded,
    // never written to disk. Only a backup that passes this in full may
    // ever reach a second, real pass into mysql.
    const verified = await readAndProcessEncryptedBackup({
        filePath,
        key: cryptoConfig.key,
        expectedKeyId: cryptoConfig.keyId,
        sink: discardSink()
    });

    assertRestoreTargetDatabase(targetDatabase, { sourceDatabase: verified.header.database });
    if (env.DB_NAME && targetDatabase.toLowerCase() === String(env.DB_NAME).toLowerCase()) {
        throw safetyError(
            "RESTORE_TARGET_IS_SOURCE",
            "Restore target database must not equal the configured DB_NAME."
        );
    }

    const container = env.FITTRACK_DB_CONTAINER || "fittrack_mysql";
    const exists = await databaseExists(adminConfig, targetDatabase);
    assertRestoreTargetAvailability({ exists, allowRecreateAck: env.FITTRACK_RESTORE_ALLOW_RECREATE });

    await recreateTargetDatabase(adminConfig, targetDatabase);

    // Pass 2 - the file is now proven authentic; stream it directly into
    // mysql: ciphertext file -> AES-256-GCM decrypt -> gunzip -> mysql
    // client stdin, entirely in-flight. No plaintext dump is ever written
    // to disk on either pass.
    const started = Date.now();
    const layout = await readBackupFileLayout(filePath);
    const decipher = createDecryptor({
        key: cryptoConfig.key,
        iv: layout.iv,
        aad: layout.headerBytes,
        tag: layout.tag
    });
    const cipherStream = fs.createReadStream(filePath, {
        start: layout.ciphertextStart,
        end: layout.ciphertextEnd - 1
    });

    await runDockerDatabaseTool({
        container,
        executable: "mysql",
        password: adminConfig.password,
        interactive: true,
        toolArgs: [
            `--user=${adminConfig.user}`,
            "--binary-mode",
            "--default-character-set=utf8mb4",
            targetDatabase
        ],
        input: cipherStream,
        inputTransforms: [decipher, zlib.createGunzip()],
        timeoutMs: timeoutConfig.restoreTimeoutMs,
        dockerOperationTimeoutMs: timeoutConfig.dockerOperationTimeoutMs
    });

    const targetPool = db.createPool({ ...adminConfig, database: targetDatabase });
    try {
        await db.verifyConnection(targetPool);
        const [rows] = await targetPool.promise().query(
            `SELECT COUNT(*) AS total
             FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = ?`,
            [targetDatabase]
        );
        return {
            result: "ok",
            targetDatabase,
            sourceDatabase: verified.header.database,
            backupCreatedAt: verified.header.createdAt,
            keyId: verified.header.keyId,
            restoredTables: Number(rows[0].total),
            durationMs: Date.now() - started
        };
    } finally {
        await db.closePool(targetPool);
    }
}

async function main() {
    const report = await restoreEncryptedBackup();
    process.stdout.write(`${JSON.stringify(report)}\n`);
}

if (require.main === module) {
    main().catch((error) => {
        createStructuredLogger().error("backup_restore_failed", { error });
        process.exitCode = backupCliExitCode(error);
    });
}

module.exports = {
    databaseExists,
    main,
    recreateTargetDatabase,
    resolveRestoreFile,
    restoreEncryptedBackup
};
