const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const mysql = require("mysql2");
const path = require("node:path");
const zlib = require("node:zlib");

const db = require("../config/db");
const { createStructuredLogger } = require("../startup/logger");
const {
    assertDestructiveTestTarget,
    assertRestoreAcknowledgement,
    safetyError
} = require("./databaseSafety");
const {
    manifestPathForArtifact,
    readAndVerifyBackupManifest
} = require("./databaseBackupPolicy");
const {
    runDockerDatabaseTool,
    verifyGzipLogicalBackupFile,
    verifyLogicalBackupFile
} = require("./databaseTools");

async function resolveRestoreFile(env = process.env) {
    if (!env.FITTRACK_RESTORE_FILE) {
        throw safetyError(
            "RESTORE_FILE_REQUIRED",
            "FITTRACK_RESTORE_FILE must identify an existing logical .sql or .sql.gz backup."
        );
    }
    const filename = path.resolve(env.FITTRACK_RESTORE_FILE);
    const normalized = filename.toLowerCase();
    if (!normalized.endsWith(".sql") && !normalized.endsWith(".sql.gz")) {
        throw safetyError("RESTORE_FILE_INVALID", "Restore input must be a .sql or .sql.gz file.");
    }
    await fsPromises.access(filename, fs.constants.R_OK);
    return filename;
}

async function prepareRestoreSource(filename) {
    if (!filename.toLowerCase().endsWith(".sql.gz")) {
        const verification = await verifyLogicalBackupFile(filename);
        return {
            compressed: false,
            sourceBytes: verification.bytes,
            sourceSha256: verification.sha256,
            logicalBytes: verification.bytes,
            logicalSha256: verification.sha256,
            inputTransforms: []
        };
    }

    const manifestEntry = await readAndVerifyBackupManifest(
        manifestPathForArtifact(filename),
        { expectedArtifactPath: filename, verifyHash: true }
    );
    const manifest = manifestEntry.manifest;
    const verification = await verifyGzipLogicalBackupFile(filename, {
        bytes: manifest.artifact.bytes,
        sha256: manifest.artifact.sha256,
        logicalBytes: manifest.logicalDump.bytes,
        logicalSha256: manifest.logicalDump.sha256
    });
    return {
        compressed: true,
        sourceBytes: verification.bytes,
        sourceSha256: verification.sha256,
        logicalBytes: verification.logicalBytes,
        logicalSha256: verification.logicalSha256,
        inputTransforms: [zlib.createGunzip()]
    };
}

async function recreateTargetDatabase(config) {
    const admin = db.createAdminConnection();
    try {
        await admin.query(`DROP DATABASE IF EXISTS ${mysql.escapeId(config.database)}`);
        await admin.query(
            `CREATE DATABASE ${mysql.escapeId(config.database)}
             CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`
        );
    } finally {
        await admin.end();
    }
}

async function restoreBackup({ env = process.env, dependencies = {} } = {}) {
    const services = {
        database: db,
        readDatabaseConfig: db.readDatabaseConfig,
        resolveFile: resolveRestoreFile,
        prepareSource: prepareRestoreSource,
        recreateDatabase: recreateTargetDatabase,
        runTool: runDockerDatabaseTool,
        ...dependencies
    };
    const config = services.readDatabaseConfig(env);
    assertDestructiveTestTarget(config, env);
    assertRestoreAcknowledgement(env);
    const filename = await services.resolveFile(env);
    // Verify the manifest, compressed artifact and expanded logical dump before DROP DATABASE.
    const source = await services.prepareSource(filename);

    await services.recreateDatabase(config);
    await services.runTool({
        container: env.FITTRACK_DB_CONTAINER || "fittrack_mysql",
        executable: "mysql",
        password: config.password,
        interactive: true,
        toolArgs: [
            `--user=${config.user}`,
            "--binary-mode",
            "--default-character-set=utf8mb4",
            config.database
        ],
        input: fs.createReadStream(filename),
        inputTransforms: source.inputTransforms
    });

    const pool = services.database.createPool(config);
    try {
        await services.database.verifyConnection(pool);
        const [rows] = await pool.promise().query(
            `SELECT COUNT(*) AS total
             FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = ?`,
            [config.database]
        );
        return {
            database: config.database,
            source: filename,
            sourceBytes: source.sourceBytes,
            sourceSha256: source.sourceSha256,
            logicalBytes: source.logicalBytes,
            logicalSha256: source.logicalSha256,
            compression: source.compressed ? "gzip" : "none",
            restoredTables: Number(rows[0].total)
        };
    } finally {
        await services.database.closePool(pool);
    }
}

async function main() {
    const report = await restoreBackup();
    process.stdout.write(`${JSON.stringify(report)}\n`);
}

if (require.main === module) {
    main().catch((error) => {
        createStructuredLogger().error("database_restore_failed", { error });
        process.exitCode = 1;
    });
}

module.exports = {
    main,
    prepareRestoreSource,
    recreateTargetDatabase,
    resolveRestoreFile,
    restoreBackup
};
