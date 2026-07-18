const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const mysql = require("mysql2");
const path = require("node:path");

const db = require("../config/db");
const { createStructuredLogger } = require("../startup/logger");
const {
    assertDestructiveTestTarget,
    assertRestoreAcknowledgement,
    safetyError
} = require("./databaseSafety");
const {
    runDockerDatabaseTool,
    verifyLogicalBackupFile
} = require("./databaseTools");

async function resolveRestoreFile(env = process.env) {
    if (!env.FITTRACK_RESTORE_FILE) {
        throw safetyError(
            "RESTORE_FILE_REQUIRED",
            "FITTRACK_RESTORE_FILE must identify an existing logical .sql backup."
        );
    }
    const filename = path.resolve(env.FITTRACK_RESTORE_FILE);
    if (path.extname(filename).toLowerCase() !== ".sql") {
        throw safetyError("RESTORE_FILE_INVALID", "Restore input must be a .sql file.");
    }
    await fsPromises.access(filename, fs.constants.R_OK);
    return filename;
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

async function restoreBackup({ env = process.env } = {}) {
    const config = db.readDatabaseConfig(env);
    assertDestructiveTestTarget(config, env);
    assertRestoreAcknowledgement(env);
    const filename = await resolveRestoreFile(env);
    const verification = await verifyLogicalBackupFile(filename);

    await recreateTargetDatabase(config);
    await runDockerDatabaseTool({
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
        input: fs.createReadStream(filename)
    });

    const pool = db.createPool(config);
    try {
        await db.verifyConnection(pool);
        const [rows] = await pool.promise().query(
            `SELECT COUNT(*) AS total
             FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = ?`,
            [config.database]
        );
        return {
            database: config.database,
            source: filename,
            sourceBytes: verification.bytes,
            sourceSha256: verification.sha256,
            restoredTables: Number(rows[0].total)
        };
    } finally {
        await db.closePool(pool);
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
    recreateTargetDatabase,
    resolveRestoreFile,
    restoreBackup
};
