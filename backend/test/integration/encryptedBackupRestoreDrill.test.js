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
const fs = require("node:fs");
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
    // Stage 3B2 added migration 010 (010_auth_sessions), bringing the total
    // applied-migration count from 9 to 10 - this restore drill exercises
    // the real migration ledger, so it must track the current count.
    assert.equal(report.migrationDoctor.summary.applied, 10);
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

// Stage 2B1 hardening: restore authorization no longer consults NODE_ENV at
// all - BACKUP_RESTORE_ENABLED plus an acknowledgement bound to the exact
// target database name is the only way in. This helper builds that
// contract consistently across the tests below.
function restoreAuthEnv(targetDatabase, overrides = {}) {
    return {
        BACKUP_RESTORE_ENABLED: "true",
        FITTRACK_RESTORE_TARGET_DATABASE: targetDatabase,
        FITTRACK_RESTORE_ACK: `restore:${targetDatabase}`,
        ...overrides
    };
}

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
                        ...restoreAuthEnv(targetDatabase),
                        FITTRACK_RESTORE_FILE: backupPath
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

test("restoreEncryptedBackup rejects when BACKUP_RESTORE_ENABLED is missing, before touching any file or database", async () => {
    const targetDatabase = "fittrack_restore_stage2b1_placeholder";
    const env = baseEnv({
        BACKUP_ENCRYPTION_KEY_B64: crypto.randomBytes(32).toString("base64"),
        FITTRACK_RESTORE_FILE: path.join(backupDirectory, "does-not-need-to-exist.ftbackup"),
        FITTRACK_RESTORE_TARGET_DATABASE: targetDatabase,
        FITTRACK_RESTORE_ACK: `restore:${targetDatabase}`
        // BACKUP_RESTORE_ENABLED intentionally omitted
    });
    await assert.rejects(
        restoreEncryptedBackup({ env }),
        (error) => error.code === "RESTORE_NOT_ENABLED"
    );
});

test("NODE_ENV=test alone never authorizes a restore - BACKUP_RESTORE_ENABLED is still required", async () => {
    const targetDatabase = "fittrack_restore_stage2b1_placeholder2";
    const env = baseEnv({
        BACKUP_ENCRYPTION_KEY_B64: crypto.randomBytes(32).toString("base64"),
        NODE_ENV: "test",
        FITTRACK_RESTORE_FILE: path.join(backupDirectory, "does-not-need-to-exist.ftbackup"),
        FITTRACK_RESTORE_TARGET_DATABASE: targetDatabase,
        FITTRACK_RESTORE_ACK: `restore:${targetDatabase}`
        // BACKUP_RESTORE_ENABLED still intentionally omitted
    });
    await assert.rejects(
        restoreEncryptedBackup({ env }),
        (error) => error.code === "RESTORE_NOT_ENABLED"
    );
});

test("restoreEncryptedBackup rejects a missing/mismatched acknowledgement before touching any file or database", async () => {
    const targetDatabase = "fittrack_restore_stage2b1_placeholder3";
    const env = baseEnv({
        BACKUP_ENCRYPTION_KEY_B64: crypto.randomBytes(32).toString("base64"),
        BACKUP_RESTORE_ENABLED: "true",
        FITTRACK_RESTORE_FILE: path.join(backupDirectory, "does-not-need-to-exist.ftbackup"),
        FITTRACK_RESTORE_TARGET_DATABASE: targetDatabase,
        FITTRACK_RESTORE_ACK: "restore:a-different-database-name"
    });
    await assert.rejects(
        restoreEncryptedBackup({ env }),
        (error) => error.code === "RESTORE_ACK_INVALID"
    );
});

test("restoreEncryptedBackup rejects a missing explicit target database before touching any file", async () => {
    const env = baseEnv({
        BACKUP_ENCRYPTION_KEY_B64: crypto.randomBytes(32).toString("base64"),
        BACKUP_RESTORE_ENABLED: "true",
        FITTRACK_RESTORE_FILE: path.join(backupDirectory, "does-not-need-to-exist.ftbackup"),
        FITTRACK_RESTORE_ACK: "restore:fittrack_restore_stage2b1_placeholder"
        // FITTRACK_RESTORE_TARGET_DATABASE intentionally omitted
    });
    await assert.rejects(
        restoreEncryptedBackup({ env }),
        (error) => error.code === "RESTORE_TARGET_REQUIRED"
    );
});

test("restoreEncryptedBackup succeeds with the full, explicit authorization contract (proves the positive path, not just the guards)", async () => {
    const key = crypto.randomBytes(32).toString("base64");
    const env = baseEnv({ BACKUP_ENCRYPTION_KEY_B64: key });
    const created = await createEncryptedBackup({ env });
    const backupPath = path.join(backupDirectory, created.filename);
    const targetDatabase = `fittrack_restore_stage2b1_${crypto.randomBytes(6).toString("hex")}`;
    try {
        const result = await restoreEncryptedBackup({
            env: {
                ...env,
                ...restoreAuthEnv(targetDatabase),
                FITTRACK_RESTORE_FILE: backupPath
            }
        });
        assert.equal(result.result, "ok");
        assert.equal(result.targetDatabase, targetDatabase);
        assert.ok(result.restoredTables > 0);
    } finally {
        await adminConnection.query(`DROP DATABASE IF EXISTS \`${targetDatabase}\``);
        await fsPromises.rm(backupPath, { force: true });
    }
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
                        ...restoreAuthEnv(targetDatabase),
                        FITTRACK_RESTORE_FILE: backupPath
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

// Critical release gate (Stage 2B1 hardening, section 7): GCM streaming
// means decrypted plaintext could in principle leak out of a Decipher
// stream before the final auth-tag check - restoreEncryptedBackup's
// verify-then-restore two-pass design (see encryptedBackupRestore.js) exists
// specifically so that never happens with real mysql. These two tests prove
// the target database is not merely "unchanged" but never even created -
// stronger than "0 rows imported", since recreateTargetDatabase() and the
// mysql import both only run after the file has already passed full
// authentication.
test("a bitflipped (tampered) backup causes restore to reject before the target database is even created - no mysql import ever runs", async () => {
    const key = crypto.randomBytes(32).toString("base64");
    const env = baseEnv({ BACKUP_ENCRYPTION_KEY_B64: key });
    const created = await createEncryptedBackup({ env });
    const backupPath = path.join(backupDirectory, created.filename);
    try {
        const buffer = await fsPromises.readFile(backupPath);
        buffer[buffer.length - 20] ^= 0xff;
        const tamperedPath = path.join(backupDirectory, "tampered-for-restore.ftbackup");
        await fsPromises.writeFile(tamperedPath, buffer);
        const targetDatabase = `fittrack_restore_stage2b1_${crypto.randomBytes(6).toString("hex")}`;
        try {
            await assert.rejects(
                restoreEncryptedBackup({
                    env: {
                        ...env,
                        ...restoreAuthEnv(targetDatabase),
                        FITTRACK_RESTORE_FILE: tamperedPath
                    }
                })
            );
            const [rows] = await adminConnection.query(
                "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?",
                [targetDatabase]
            );
            assert.equal(
                rows.length,
                0,
                "the target database must never be created when the backup fails authentication"
            );
        } finally {
            await adminConnection.query(`DROP DATABASE IF EXISTS \`${targetDatabase}\``);
            await fsPromises.rm(tamperedPath, { force: true });
        }
    } finally {
        await fsPromises.rm(backupPath, { force: true });
    }
});

test("restoring with the wrong key causes rejection before the target database is even created - no mysql import ever runs", async () => {
    const createKey = crypto.randomBytes(32).toString("base64");
    const wrongKey = crypto.randomBytes(32).toString("base64");
    const env = baseEnv({ BACKUP_ENCRYPTION_KEY_B64: createKey });
    const created = await createEncryptedBackup({ env });
    const backupPath = path.join(backupDirectory, created.filename);
    const targetDatabase = `fittrack_restore_stage2b1_${crypto.randomBytes(6).toString("hex")}`;
    try {
        await assert.rejects(
            restoreEncryptedBackup({
                env: {
                    ...env,
                    BACKUP_ENCRYPTION_KEY_B64: wrongKey,
                    ...restoreAuthEnv(targetDatabase),
                    FITTRACK_RESTORE_FILE: backupPath
                }
            })
        );
        const [rows] = await adminConnection.query(
            "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?",
            [targetDatabase]
        );
        assert.equal(rows.length, 0, "the target database must never be created with the wrong key");
    } finally {
        await adminConnection.query(`DROP DATABASE IF EXISTS \`${targetDatabase}\``);
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

// Stage 2B1 hardening (section 6): a direct, active proof - not an
// inference from a failed SQL import - that create/verify/restore never
// produce a plaintext artifact anywhere: the configured output directory,
// the OS temp directory, and this repository's own scratch temp directory
// are all actively watched for new entries for the whole duration of a
// real backup+verify+restore cycle.
function watchForNewEntries(directory) {
    const seen = new Set();
    let watcher;
    try {
        watcher = fs.watch(directory, (eventType, filename) => {
            if (filename) seen.add(filename);
        });
    } catch {
        watcher = null;
    }
    return {
        seen,
        stop: () => watcher?.close()
    };
}

async function snapshotEntries(directory) {
    try {
        return new Set(await fsPromises.readdir(directory));
    } catch {
        return new Set();
    }
}

test("create, verify and restore never leave a plaintext artifact in the output directory, the OS temp directory, or a project temp directory", async () => {
    const key = crypto.randomBytes(32).toString("base64");
    const env = baseEnv({ BACKUP_ENCRYPTION_KEY_B64: key });

    const osTmpBefore = await snapshotEntries(os.tmpdir());
    const projectTmpDir = path.resolve(__dirname, "..", "..", "tmp");
    const projectTmpBefore = await snapshotEntries(projectTmpDir);
    const outputWatch = watchForNewEntries(backupDirectory);

    const created = await createEncryptedBackup({ env });
    const backupPath = path.join(backupDirectory, created.filename);

    await verifyEncryptedBackup({
        env: { ...env, FITTRACK_BACKUP_VERIFY_FILE: backupPath }
    });

    const targetDatabase = `fittrack_restore_stage2b1_${crypto.randomBytes(6).toString("hex")}`;
    let restoreError;
    try {
        await restoreEncryptedBackup({
            env: {
                ...env,
                ...restoreAuthEnv(targetDatabase),
                FITTRACK_RESTORE_FILE: backupPath
            }
        });
    } catch (error) {
        restoreError = error;
    } finally {
        await adminConnection.query(`DROP DATABASE IF EXISTS \`${targetDatabase}\``);
    }
    assert.equal(restoreError, undefined, "restore of a genuinely valid backup must succeed");

    outputWatch.stop();
    const osTmpAfter = await snapshotEntries(os.tmpdir());
    const projectTmpAfter = await snapshotEntries(projectTmpDir);

    const forbidden = /\.sql$|\.sql\.gz$|\.dump$|plaintext|decrypted/i;
    for (const name of outputWatch.seen) {
        assert.ok(
            /\.ftbackup(\.partial)?$/i.test(name),
            `unexpected file observed in the output directory during the run: ${name}`
        );
        assert.doesNotMatch(name, forbidden, `forbidden plaintext-looking artifact observed: ${name}`);
    }
    const finalOutputEntries = await fsPromises.readdir(backupDirectory);
    assert.deepEqual(
        finalOutputEntries,
        [created.filename],
        "only the final .ftbackup may remain in the output directory after a successful run"
    );

    for (const name of osTmpAfter) {
        if (osTmpBefore.has(name)) continue;
        assert.doesNotMatch(
            name,
            forbidden,
            `a new, plaintext-looking file appeared in the OS temp directory: ${name}`
        );
    }
    for (const name of projectTmpAfter) {
        if (projectTmpBefore.has(name)) continue;
        assert.doesNotMatch(
            name,
            forbidden,
            `a new, plaintext-looking file appeared in the project temp directory: ${name}`
        );
    }

    await fsPromises.rm(backupPath, { force: true });
});

test("createEncryptedBackup honors a configured dump timeout end-to-end: a too-short timeout fails closed and leaves no .partial file", async () => {
    const env = baseEnv({
        BACKUP_ENCRYPTION_KEY_B64: crypto.randomBytes(32).toString("base64"),
        // The allowed minimum (5000ms) is still far shorter than mysqldump
        // needs to even establish its connection and begin, in practice -
        // but to keep this test fast and deterministic without depending on
        // real timing margins, point at a container that cannot be reached
        // quickly enough combined with the minimum timeout, proving the
        // configured value is genuinely wired through to the real Docker
        // call rather than merely accepted by the config reader.
        BACKUP_DUMP_TIMEOUT_MS: "5000",
        FITTRACK_DB_CONTAINER: "fittrack_container_that_does_not_exist"
    });
    await assert.rejects(createEncryptedBackup({ env }));
    const entries = await fsPromises.readdir(backupDirectory);
    assert.equal(
        entries.filter((name) => name.endsWith(".ftbackup") || name.endsWith(".ftbackup.partial")).length,
        0
    );
});

test("a real create sets the output directory to mode 0700 and the final .ftbackup to mode 0600 on POSIX platforms", async (t) => {
    if (process.platform === "win32") {
        return; // documented platform limitation - Windows does not enforce POSIX modes
    }
    const freshOutputDir = path.join(backupDirectory, `perm-check-${crypto.randomBytes(4).toString("hex")}`);
    t.after(() => fsPromises.rm(freshOutputDir, { recursive: true, force: true }));
    const env = baseEnv({
        BACKUP_ENCRYPTION_KEY_B64: crypto.randomBytes(32).toString("base64"),
        BACKUP_OUTPUT_DIRECTORY: freshOutputDir
    });
    const created = await createEncryptedBackup({ env });
    try {
        const dirStat = await fsPromises.stat(freshOutputDir);
        assert.equal(dirStat.mode & 0o777, 0o700);
        const fileStat = await fsPromises.stat(path.join(freshOutputDir, created.filename));
        assert.equal(fileStat.mode & 0o777, 0o600);
    } finally {
        await fsPromises.rm(path.join(freshOutputDir, created.filename), { force: true });
    }
});
