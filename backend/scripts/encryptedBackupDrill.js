const crypto = require("node:crypto");
const fsPromises = require("node:fs/promises");
const path = require("node:path");
const mysql = require("mysql2");

const db = require("../config/db");
const { createStructuredLogger } = require("../startup/logger");
const { safetyError } = require("./databaseSafety");
const { createEncryptedBackup } = require("./encryptedBackupCreate");
const { verifyEncryptedBackup } = require("./encryptedBackupVerify");
const { restoreEncryptedBackup } = require("./encryptedBackupRestore");
const { createMigrationRuntime } = require("./migrationRuntime");
const migrateDoctor = require("./migrateDoctor");
const { backupCliExitCode } = require("./backupExitCodes");

const NOOP_LOGGER = { info() {}, warn() {}, error() {} };

function randomToken(bytes = 6) {
    return crypto.randomBytes(bytes).toString("hex");
}

// Matches databaseSafety.js#isDisposableDatabaseName: fittrack_restore_...
function drillDatabaseName() {
    return `fittrack_restore_stage2b1_${randomToken()}`;
}

async function listTables(pool, database) {
    const [rows] = await pool.promise().query(
        `SELECT TABLE_NAME AS name
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
         ORDER BY TABLE_NAME`,
        [database]
    );
    return rows.map((row) => row.name);
}

async function countRows(pool, database, tableName) {
    if (!/^[A-Za-z0-9_$-]+$/.test(database || "")) {
        throw safetyError("DRILL_TABLE_NAME_INVALID", "Encountered an unsafe database name during the drill.");
    }
    if (!/^[A-Za-z0-9_$]+$/.test(tableName || "")) {
        throw safetyError("DRILL_TABLE_NAME_INVALID", "Encountered an unsafe table name during the drill.");
    }
    const [rows] = await pool.promise().query(
        `SELECT COUNT(*) AS total FROM ${mysql.escapeId(database)}.${mysql.escapeId(tableName)}`
    );
    return Number(rows[0].total);
}

async function snapshotTableCounts(pool, database) {
    const tables = await listTables(pool, database);
    const counts = {};
    for (const table of tables) {
        counts[table] = await countRows(pool, database, table);
    }
    return { tables, counts };
}

async function runRestoreDrill({ env = process.env } = {}) {
    const startedAt = Date.now();
    const sourceConfig = db.readDatabaseConfig(env);
    const sourcePool = db.createPool(sourceConfig);

    let backupPath;
    let targetDatabase;
    let targetPool;
    const cleanupNotes = [];

    try {
        const source = await snapshotTableCounts(sourcePool, sourceConfig.database);

        const createReport = await createEncryptedBackup({ env });
        backupPath = path.join(path.resolve(env.BACKUP_OUTPUT_DIRECTORY), createReport.filename);

        const verifyReport = await verifyEncryptedBackup({
            env: { ...env, FITTRACK_BACKUP_VERIFY_FILE: backupPath }
        });

        // The drill uses its own narrowly-scoped, explicit restore
        // authorization: BACKUP_RESTORE_ENABLED plus an acknowledgement
        // bound to the exact disposable target name it just generated -
        // never NODE_ENV, which is not a restore authorization mechanism.
        targetDatabase = drillDatabaseName();
        const restoreReport = await restoreEncryptedBackup({
            env: {
                ...env,
                BACKUP_RESTORE_ENABLED: "true",
                FITTRACK_RESTORE_FILE: backupPath,
                FITTRACK_RESTORE_TARGET_DATABASE: targetDatabase,
                FITTRACK_RESTORE_ACK: `restore:${targetDatabase}`
            }
        });

        const targetConfig = { ...sourceConfig, database: targetDatabase };
        targetPool = db.createPool(targetConfig);

        const doctorRuntime = createMigrationRuntime({ pool: targetPool, logger: NOOP_LOGGER });
        const doctorReport = await migrateDoctor.main({
            env: { NODE_ENV: "test" },
            databaseConfig: targetConfig,
            runtime: doctorRuntime,
            logger: NOOP_LOGGER,
            setExitCode: () => {}
        });
        // migrateDoctor.main() already closed doctorRuntime/targetPool in its
        // own finally block; acquire a fresh pool for the row-count pass.
        targetPool = db.createPool(targetConfig);

        const target = await snapshotTableCounts(targetPool, targetDatabase);
        const missingTables = source.tables.filter((name) => !target.tables.includes(name));
        const mismatchedCounts = source.tables
            .filter((name) => target.tables.includes(name))
            .filter((name) => source.counts[name] !== target.counts[name])
            .map((name) => ({ table: name, source: source.counts[name], restored: target.counts[name] }));

        if (doctorReport.state !== "ready") {
            throw safetyError(
                "DRILL_MIGRATION_DOCTOR_NOT_READY",
                `Migration doctor did not report ready for the restored database (state: ${doctorReport.state}).`
            );
        }
        if (missingTables.length > 0) {
            throw safetyError(
                "DRILL_TABLES_MISSING",
                `Restored database is missing expected tables: ${missingTables.join(", ")}.`
            );
        }
        if (mismatchedCounts.length > 0) {
            throw safetyError(
                "DRILL_ROW_COUNT_MISMATCH",
                "Restored database row counts do not match the source database."
            );
        }

        return {
            result: "ok",
            sourceDatabase: sourceConfig.database,
            targetDatabase,
            backup: {
                filename: createReport.filename,
                bytes: createReport.bytes,
                ciphertextSha256: createReport.ciphertextSha256,
                keyId: createReport.keyId
            },
            verify: {
                logicalBytes: verifyReport.logicalBytes,
                logicalSha256: verifyReport.logicalSha256
            },
            restore: {
                restoredTables: restoreReport.restoredTables
            },
            migrationDoctor: {
                state: doctorReport.state,
                summary: doctorReport.summary
            },
            tablesCompared: source.tables.length,
            durationMs: Date.now() - startedAt
        };
    } finally {
        await db.closePool(sourcePool);
        if (targetPool) {
            try {
                await db.closePool(targetPool);
            } catch (error) {
                cleanupNotes.push({ step: "close_target_pool", error: error.message });
            }
        }
        if (targetDatabase) {
            try {
                const adminConfig = db.readDatabaseConfig(env, { includeDatabase: false });
                const admin = db.createAdminConnection(adminConfig);
                try {
                    await admin.query(`DROP DATABASE IF EXISTS ${mysql.escapeId(targetDatabase)}`);
                } finally {
                    await admin.end();
                }
            } catch (error) {
                cleanupNotes.push({ step: "drop_target_database", error: error.message });
            }
        }
        if (backupPath) {
            try {
                await fsPromises.rm(backupPath, { force: true });
            } catch (error) {
                cleanupNotes.push({ step: "remove_backup_artifact", error: error.message });
            }
        }
        if (cleanupNotes.length > 0) {
            createStructuredLogger().error("backup_restore_drill_cleanup_incomplete", { cleanupNotes });
        }
    }
}

async function main() {
    const report = await runRestoreDrill();
    createStructuredLogger().info("restore_drill_succeeded", {
        sourceDatabase: report.sourceDatabase,
        targetDatabase: report.targetDatabase,
        tablesCompared: report.tablesCompared,
        durationMs: report.durationMs
    });
    process.stdout.write(`${JSON.stringify(report)}\n`);
}

if (require.main === module) {
    main().catch((error) => {
        createStructuredLogger().error("backup_restore_drill_failed", { error });
        process.exitCode = backupCliExitCode(error);
    });
}

module.exports = {
    drillDatabaseName,
    main,
    runRestoreDrill
};
