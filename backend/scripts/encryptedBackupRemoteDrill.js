// Stage 2B2A full remote restore drill: create -> local verify -> upload to
// S3-compatible storage -> remote HeadObject/metadata check -> remote
// inventory check -> download into a fresh directory -> ciphertext-sha256
// check -> full Stage 2B1 GCM verify -> restore *from the downloaded copy*
// (never the original local file - this is what actually proves the round
// trip) into a disposable database -> Migration Doctor -> table/row
// comparison against the real source database. Cleanup always runs in
// `finally`; unlike the local drill (encryptedBackupDrill.js), a cleanup
// failure here is never allowed to present as success - see the explicit
// check after the try/finally block below.
const crypto = require("node:crypto");
const fsPromises = require("node:fs/promises");
const path = require("node:path");
const mysql = require("mysql2");

const db = require("../config/db");
const { readBackupRemoteConfig } = require("../config/backupRemoteConfig");
const { createStructuredLogger } = require("../startup/logger");
const { safetyError } = require("./databaseSafety");
const { backupCliExitCode } = require("./backupExitCodes");
const { createEncryptedBackup } = require("./encryptedBackupCreate");
const { verifyEncryptedBackup } = require("./encryptedBackupVerify");
const { restoreEncryptedBackup } = require("./encryptedBackupRestore");
const { uploadEncryptedBackup } = require("./encryptedBackupRemoteUpload");
const { fetchAndVerifyRemoteBackup } = require("./encryptedBackupRemoteFetch");
const { listRemoteBackups } = require("./encryptedBackupRemoteList");
const { createS3Client, deleteObject, headObject, remoteError } = require("./backupRemoteStorage");
const { snapshotTableCounts } = require("./encryptedBackupDrill");
const { createMigrationRuntime } = require("./migrationRuntime");
const migrateDoctor = require("./migrateDoctor");

const NOOP_LOGGER = { info() {}, warn() {}, error() {} };

function randomToken(bytes = 6) {
    return crypto.randomBytes(bytes).toString("hex");
}

// Matches databaseSafety.js#isDisposableDatabaseName: fittrack_restore_...
function remoteDrillDatabaseName() {
    return `fittrack_restore_stage2b2a_${randomToken()}`;
}

async function runRemoteRestoreDrill({ env = process.env } = {}) {
    const startedAt = Date.now();
    const remoteConfig = readBackupRemoteConfig(env);
    const client = createS3Client(remoteConfig);

    const sourceConfig = db.readDatabaseConfig(env);
    const sourcePool = db.createPool(sourceConfig);

    let backupPath;
    let downloadDirectory;
    let remoteKey;
    let remoteVersionId;
    let targetDatabase;
    let targetPool;
    let result;
    const cleanupNotes = [];

    try {
        const source = await snapshotTableCounts(sourcePool, sourceConfig.database);

        const createReport = await createEncryptedBackup({ env });
        backupPath = path.join(path.resolve(env.BACKUP_OUTPUT_DIRECTORY), createReport.filename);

        const verifyReport = await verifyEncryptedBackup({
            env: { ...env, FITTRACK_BACKUP_VERIFY_FILE: backupPath }
        });

        const uploadReport = await uploadEncryptedBackup({
            env: { ...env, FITTRACK_BACKUP_REMOTE_FILE: backupPath }
        });
        remoteKey = uploadReport.key;
        remoteVersionId = uploadReport.versionId;

        const head = await headObject({ client, remoteConfig, key: remoteKey });
        if (head.ContentLength !== uploadReport.bytes) {
            throw remoteError("REMOTE_METADATA_INCONSISTENT", "Remote HeadObject size does not match the upload report.");
        }

        const inventory = await listRemoteBackups({ env });
        const inventoryEntry = inventory.entries.find((entry) => entry.key === remoteKey);
        if (!inventoryEntry || !inventoryEntry.recognized) {
            throw remoteError("REMOTE_METADATA_INCONSISTENT", "Uploaded object did not appear as a recognized entry in the remote inventory.");
        }

        downloadDirectory = path.join(path.dirname(backupPath), `remote-drill-download-${randomToken(4)}`);
        const downloadReport = await fetchAndVerifyRemoteBackup({
            env,
            key: remoteKey,
            destinationDirectory: downloadDirectory,
            keepFile: true
        });

        // The critical proof: restore from the *downloaded* copy, never the
        // original local file - this is what actually exercises the full
        // off-host round trip rather than just the local pipeline again.
        targetDatabase = remoteDrillDatabaseName();
        const restoreReport = await restoreEncryptedBackup({
            env: {
                ...env,
                BACKUP_RESTORE_ENABLED: "true",
                FITTRACK_RESTORE_FILE: downloadReport.localPath,
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

        result = {
            result: "ok",
            sourceDatabase: sourceConfig.database,
            targetDatabase,
            bucket: remoteConfig.bucket,
            remoteKey,
            backup: {
                filename: createReport.filename,
                bytes: createReport.bytes,
                ciphertextSha256: createReport.ciphertextSha256,
                keyId: createReport.keyId
            },
            localVerify: {
                logicalBytes: verifyReport.logicalBytes,
                logicalSha256: verifyReport.logicalSha256
            },
            remoteVerify: {
                bytes: downloadReport.bytes,
                ciphertextSha256: downloadReport.ciphertextSha256
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
                cleanupNotes.push({ step: "remove_local_backup_artifact", error: error.message });
            }
        }
        if (downloadDirectory) {
            try {
                await fsPromises.rm(downloadDirectory, { recursive: true, force: true });
            } catch (error) {
                cleanupNotes.push({ step: "remove_downloaded_artifact", error: error.message });
            }
        }
        if (remoteKey) {
            try {
                // Delete the exact version this drill created, when known -
                // on a versioned bucket this avoids ever creating a delete
                // marker over (or removing) a different version than the
                // one the drill itself published.
                await deleteObject({ client, remoteConfig, key: remoteKey, versionId: remoteVersionId });
            } catch (error) {
                cleanupNotes.push({ step: "delete_remote_test_object", error: error.message });
            }
        }
        if (cleanupNotes.length > 0) {
            createStructuredLogger().error("remote_backup_drill_cleanup_incomplete", { cleanupNotes });
        }
    }

    // A cleanup failure must never present as a successful drill, even
    // though every core step above already succeeded - this is stricter
    // than the local drill (encryptedBackupDrill.js), which only logs
    // cleanup problems, because a remote test object left behind is a real,
    // billable, off-host artifact rather than a purely local one.
    if (cleanupNotes.length > 0) {
        throw remoteError(
            "REMOTE_DRILL_CLEANUP_FAILED",
            `Remote drill cleanup did not fully succeed: ${cleanupNotes.map((note) => note.step).join(", ")}.`
        );
    }
    return result;
}

async function main() {
    const report = await runRemoteRestoreDrill();
    createStructuredLogger().info("remote_backup_drill_succeeded", {
        sourceDatabase: report.sourceDatabase,
        targetDatabase: report.targetDatabase,
        bucket: report.bucket,
        tablesCompared: report.tablesCompared,
        durationMs: report.durationMs
    });
    process.stdout.write(`${JSON.stringify(report)}\n`);
}

if (require.main === module) {
    main().catch((error) => {
        createStructuredLogger().error("remote_backup_drill_failed", { error });
        process.exitCode = backupCliExitCode(error);
    });
}

module.exports = {
    main,
    remoteDrillDatabaseName,
    runRemoteRestoreDrill
};
