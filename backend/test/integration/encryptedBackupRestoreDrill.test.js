// Real, end-to-end proof of the Stage 2B1 encrypted backup pipeline: a
// genuine `docker exec mysqldump`, real gzip + AES-256-GCM encryption, a
// real decrypt + verify pass, a real disposable restore target database, a
// real `docker exec mysql` import, and a real migration doctor run against
// the restored copy - no mocks, no fakes, against the actual local MySQL
// container. Cleanup (dropping the restore target, removing the backup
// artifact) happens inside runRestoreDrill()'s own `finally` block; this
// file additionally asserts that cleanup actually took effect.
const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const mysql = require("mysql2/promise");

const TEST_DATABASE = `fittrack_backup_drill_${process.pid}_${Date.now()}`;
if (!/^fittrack_backup_drill_[A-Za-z0-9_]+$/.test(TEST_DATABASE)) {
    throw new Error("Refusing to use an unsafe backup drill test database name.");
}

process.env.NODE_ENV = "test";
process.env.DB_NAME = TEST_DATABASE;
process.env.JWT_SECRET = "fittrack-backup-drill-test-secret-with-at-least-32-characters";
process.env.INVITATION_ACCEPT_BASE_URL = "http://127.0.0.1:4173";
// Isolate this run from any real SMTP configuration a developer may have in
// their own local backend/.env - see the matching comment in
// studioApi.test.js. Unrelated to backups, but this file also triggers
// config/db.js's dotenv fallback like every other integration test.
process.env.INVITATION_EMAIL_PROVIDER = "";

const db = require("../../config/db");
const { createMigrationRunner } = require("../../migrations/runner");
const { runRestoreDrill } = require("../../scripts/encryptedBackupDrill");
const { createEncryptedBackup } = require("../../scripts/encryptedBackupCreate");
const { verifyEncryptedBackup } = require("../../scripts/encryptedBackupVerify");
const { restoreEncryptedBackup } = require("../../scripts/encryptedBackupRestore");
const { buildHeader, createEncryptor, encodeHeader } = require("../../scripts/encryptedBackupFormat");

const NOOP_LOGGER = { info() {}, warn() {}, error() {} };
let adminConnection;
let pool;
let backupDirectory;

function baseEnv(overrides = {}) {
    return {
        ...process.env,
        FITTRACK_DB_CONTAINER: process.env.FITTRACK_DB_CONTAINER || "fittrack_mysql",
        BACKUP_ENCRYPTION_KEY_ID: "integration-test-key",
        BACKUP_OUTPUT_DIRECTORY: backupDirectory,
        ...overrides
    };
}

before(async () => {
    adminConnection = await mysql.createConnection(
        db.readDatabaseConfig(process.env, { includeDatabase: false })
    );
    await adminConnection.query(`CREATE DATABASE \`${TEST_DATABASE}\` CHARACTER SET utf8mb4`);
    const runner = createMigrationRunner({ pool: db, logger: NOOP_LOGGER });
    await runner.migrate({ expectedDatabase: TEST_DATABASE });
    pool = db.promise();

    backupDirectory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "fittrack-backup-drill-"));
});

after(async () => {
    if (backupDirectory) {
        await fsPromises.rm(backupDirectory, { recursive: true, force: true });
    }
    await db.closePool(db);
    if (adminConnection) {
        assert.match(TEST_DATABASE, /^fittrack_backup_drill_[A-Za-z0-9_]+$/);
        await adminConnection.query(`DROP DATABASE IF EXISTS \`${TEST_DATABASE}\``);
        await adminConnection.end();
    }
});

test("a real encrypted backup + restore drill against the disposable source database proves the full pipeline end-to-end", async () => {
    const [[before1RowCount]] = await pool.query(
        "SELECT COUNT(*) AS total FROM exercises WHERE user_id IS NULL"
    );
    assert.ok(Number(before1RowCount.total) > 0, "expected migration 003 to have seeded global exercises");

    const key = crypto.randomBytes(32).toString("base64");
    const env = baseEnv({ BACKUP_ENCRYPTION_KEY_B64: key });

    const report = await runRestoreDrill({ env });

    assert.equal(report.result, "ok");
    assert.equal(report.sourceDatabase, TEST_DATABASE);
    assert.match(report.targetDatabase, /^fittrack_restore_stage2b1_[a-f0-9]+$/);
    assert.equal(report.backup.keyId, "integration-test-key");
    assert.match(report.backup.ciphertextSha256, /^[a-f0-9]{64}$/);
    assert.ok(report.backup.bytes > 0);
    assert.match(report.verify.logicalSha256, /^[a-f0-9]{64}$/);
    assert.ok(report.restore.restoredTables > 0);

    assert.equal(report.migrationDoctor.state, "ready");
    assert.equal(report.migrationDoctor.summary.applied, 8);
    assert.equal(report.migrationDoctor.summary.pending, 0);
    assert.equal(report.migrationDoctor.summary.dirty, 0);
    assert.equal(report.migrationDoctor.summary.drift, 0);
    assert.equal(report.migrationDoctor.summary.unknown, 0);
    assert.equal(report.migrationDoctor.summary.schemaIssues, 0);
    assert.equal(report.migrationDoctor.summary.ledgerIssues, 0);
    assert.ok(report.tablesCompared > 0);

    // Cleanup already happened inside runRestoreDrill()'s own finally block -
    // prove it actually took effect rather than trusting the report alone.
    const [rows] = await adminConnection.query(
        "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?",
        [report.targetDatabase]
    );
    assert.equal(rows.length, 0, "restore target database must be dropped after the drill");

    const entries = await fsPromises.readdir(backupDirectory);
    assert.equal(
        entries.filter((name) => name.endsWith(".ftbackup") || name.endsWith(".ftbackup.partial")).length,
        0,
        "no backup artifact should remain in the output directory after the drill"
    );
});

test("a failed dump (unreachable Docker container) leaves no .partial or .ftbackup file behind", async () => {
    const key = crypto.randomBytes(32).toString("base64");
    const env = baseEnv({
        BACKUP_ENCRYPTION_KEY_B64: key,
        FITTRACK_DB_CONTAINER: "fittrack_container_that_does_not_exist"
    });

    await assert.rejects(createEncryptedBackup({ env }));

    const entries = await fsPromises.readdir(backupDirectory);
    assert.equal(
        entries.filter((name) => name.endsWith(".ftbackup") || name.endsWith(".ftbackup.partial")).length,
        0,
        "a failed dump must never leave a partial or plausible-looking backup file behind"
    );
});

test("restoreEncryptedBackup refuses an already-existing target database without the explicit recreate acknowledgement, and creates no second copy", async () => {
    const key = crypto.randomBytes(32).toString("base64");
    const env = baseEnv({ BACKUP_ENCRYPTION_KEY_B64: key });

    const created = await createEncryptedBackup({ env });
    const backupPath = path.join(backupDirectory, created.filename);
    try {
        const targetDatabase = `fittrack_restore_stage2b1_${crypto.randomBytes(6).toString("hex")}`;
        await adminConnection.query(
            `CREATE DATABASE \`${targetDatabase}\` CHARACTER SET utf8mb4`
        );
        try {
            await assert.rejects(
                restoreEncryptedBackup({
                    env: {
                        ...env,
                        NODE_ENV: "test",
                        FITTRACK_RESTORE_FILE: backupPath,
                        FITTRACK_RESTORE_TARGET_DATABASE: targetDatabase,
                        FITTRACK_RESTORE_ACK: "restore-local-test-database"
                    }
                }),
                (error) => error.code === "RESTORE_TARGET_ALREADY_EXISTS"
            );
        } finally {
            await adminConnection.query(`DROP DATABASE IF EXISTS \`${targetDatabase}\``);
        }
    } finally {
        await fsPromises.rm(backupPath, { force: true });
    }
});

test("restoreEncryptedBackup rejects a missing acknowledgement before touching any file or database", async () => {
    const env = baseEnv({
        BACKUP_ENCRYPTION_KEY_B64: crypto.randomBytes(32).toString("base64"),
        NODE_ENV: "test",
        FITTRACK_RESTORE_FILE: path.join(backupDirectory, "does-not-need-to-exist.ftbackup"),
        FITTRACK_RESTORE_TARGET_DATABASE: "fittrack_restore_stage2b1_placeholder"
        // FITTRACK_RESTORE_ACK intentionally omitted
    });
    await assert.rejects(
        restoreEncryptedBackup({ env }),
        (error) => error.code === "TEST_DB_OPERATION_FORBIDDEN"
    );
});

test("restoreEncryptedBackup rejects a missing explicit target database before touching any file", async () => {
    const env = baseEnv({
        BACKUP_ENCRYPTION_KEY_B64: crypto.randomBytes(32).toString("base64"),
        NODE_ENV: "test",
        FITTRACK_RESTORE_FILE: path.join(backupDirectory, "does-not-need-to-exist.ftbackup"),
        FITTRACK_RESTORE_ACK: "restore-local-test-database"
        // FITTRACK_RESTORE_TARGET_DATABASE intentionally omitted
    });
    await assert.rejects(
        restoreEncryptedBackup({ env }),
        (error) => error.code === "RESTORE_TARGET_REQUIRED"
    );
});

test("a restore whose backup is authentic but whose SQL content is broken fails during the real mysql import, not silently", async () => {
    const key = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);
    const header = buildHeader({
        createdAt: new Date(),
        keyId: "integration-test-key",
        database: TEST_DATABASE,
        ivBase64: iv.toString("base64"),
        appliedMigrations: []
    });
    const { prefix, headerBytes } = encodeHeader(header);
    const cipher = createEncryptor({ key, iv, aad: headerBytes });
    const brokenSql = Buffer.from("THIS IS NOT VALID SQL AT ALL; %%% BROKEN SYNTAX;\n");
    const gzipped = zlib.gzipSync(brokenSql);
    const ciphertext = Buffer.concat([cipher.update(gzipped), cipher.final()]);
    const tag = cipher.getAuthTag();
    const backupPath = path.join(backupDirectory, "broken-sql.ftbackup");
    await fsPromises.writeFile(backupPath, Buffer.concat([prefix, ciphertext, tag]));

    try {
        const targetDatabase = `fittrack_restore_stage2b1_${crypto.randomBytes(6).toString("hex")}`;
        try {
            await assert.rejects(
                restoreEncryptedBackup({
                    env: baseEnv({
                        BACKUP_ENCRYPTION_KEY_B64: key.toString("base64"),
                        NODE_ENV: "test",
                        FITTRACK_RESTORE_FILE: backupPath,
                        FITTRACK_RESTORE_TARGET_DATABASE: targetDatabase,
                        FITTRACK_RESTORE_ACK: "restore-local-test-database"
                    })
                }),
                (error) => error.code === "DATABASE_TOOL_FAILED"
            );
        } finally {
            await adminConnection.query(`DROP DATABASE IF EXISTS \`${targetDatabase}\``);
        }
    } finally {
        await fsPromises.rm(backupPath, { force: true });
    }
});

test("createEncryptedBackup fails closed when the configured output directory cannot be created (a path component is a file, not a directory)", async () => {
    const blockerFile = path.join(backupDirectory, "not-a-directory");
    await fsPromises.writeFile(blockerFile, "blocking file");
    try {
        const env = baseEnv({
            BACKUP_ENCRYPTION_KEY_B64: crypto.randomBytes(32).toString("base64"),
            BACKUP_OUTPUT_DIRECTORY: path.join(blockerFile, "subdir")
        });
        await assert.rejects(createEncryptedBackup({ env }));
    } finally {
        await fsPromises.rm(blockerFile, { force: true });
    }
});
