const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { after, before, test } = require("node:test");
const mysql = require("mysql2/promise");

const db = require("../config/db");
const {
    DOCTOR_EXIT_CODES,
    createMigrationDoctor,
    isSelectOnlyStatement
} = require("../migrations/doctor");
const { loadMigrations } = require("../migrations/loader");
const { createMigrationRunner } = require("../migrations/runner");

const RUN_INTEGRATION = process.env.FITTRACK_RUN_DB_INTEGRATION !== "false";
const createdDatabases = new Set();
let admin;

function silentLogger() {
    return {
        info() {},
        warn() {},
        error() {}
    };
}

function assertDisposableDatabaseName(name) {
    assert.match(name, /^fittrack_migration_test_[a-f0-9]+$/);
}

async function createDisposableDatabase() {
    const name = `fittrack_migration_test_${crypto.randomBytes(6).toString("hex")}`;
    assertDisposableDatabaseName(name);
    await admin.query(
        `CREATE DATABASE ${mysql.escapeId(name)}
         CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`
    );
    createdDatabases.add(name);
    return name;
}

function createTestPool(database) {
    return db.createPool({
        ...db.readDatabaseConfig(),
        database
    });
}

async function databaseSnapshot(pool, database) {
    const sql = pool.promise();
    const [ledgerExists] = await sql.query(
        `SELECT COUNT(*) AS total
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'schema_migrations'`,
        [database]
    );
    const hasLedger = Number(ledgerExists[0].total) === 1;
    const ledger = hasLedger
        ? (
              await sql.query(
                  `SELECT migration_id, description, checksum, status,
                          started_at, applied_at, execution_ms, failure_code
                   FROM schema_migrations
                   ORDER BY migration_id`
              )
          )[0]
        : [];
    const [columns] = await sql.query(
        `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name,
                COLUMN_TYPE AS column_type, IS_NULLABLE AS is_nullable
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ?
         ORDER BY TABLE_NAME, ORDINAL_POSITION`,
        [database]
    );
    const [indexes] = await sql.query(
        `SELECT TABLE_NAME AS table_name, INDEX_NAME AS index_name,
                NON_UNIQUE AS non_unique, SEQ_IN_INDEX AS sequence_number,
                COLUMN_NAME AS column_name
         FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = ?
         ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
        [database]
    );
    const [constraints] = await sql.query(
        `SELECT TABLE_NAME AS table_name, CONSTRAINT_NAME AS constraint_name,
                CONSTRAINT_TYPE AS constraint_type
         FROM information_schema.TABLE_CONSTRAINTS
         WHERE CONSTRAINT_SCHEMA = ?
         ORDER BY TABLE_NAME, CONSTRAINT_NAME`,
        [database]
    );
    const [seedRows] = await sql.query(
        `SELECT COUNT(*) AS total
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'exercises'`,
        [database]
    );
    let globalExerciseCount = null;
    if (Number(seedRows[0].total) === 1) {
        const [rows] = await sql.query(
            "SELECT COUNT(*) AS total FROM exercises WHERE user_id IS NULL"
        );
        globalExerciseCount = Number(rows[0].total);
    }

    return {
        hasLedger,
        ledger,
        columns,
        indexes,
        constraints,
        globalExerciseCount
    };
}

before(async () => {
    if (!RUN_INTEGRATION) {
        return;
    }
    admin = await mysql.createConnection(
        db.readDatabaseConfig(process.env, { includeDatabase: false })
    );
});

after(async () => {
    if (!admin) {
        return;
    }
    for (const database of createdDatabases) {
        assertDisposableDatabaseName(database);
        await admin.query(`DROP DATABASE IF EXISTS ${mysql.escapeId(database)}`);
    }
    await admin.end();
});

test(
    "migration doctor is SELECT-only, creates no ledger and accepts the real final schema",
    { skip: !RUN_INTEGRATION },
    async () => {
        const database = await createDisposableDatabase();
        const pool = createTestPool(database);
        const observedQueries = [];
        const doctor = createMigrationDoctor({
            pool,
            onQuery(sql) {
                observedQueries.push(sql);
            }
        });

        try {
            const emptyBefore = await databaseSnapshot(pool, database);
            const pending = await doctor.diagnose();
            const emptyAfter = await databaseSnapshot(pool, database);

            assert.equal(pending.exitCode, DOCTOR_EXIT_CODES.PENDING);
            assert.equal(pending.recoveryRequired, false);
            assert.equal(pending.summary.pending, 5);
            assert.equal(emptyBefore.hasLedger, false);
            assert.deepEqual(emptyAfter, emptyBefore, "doctor must not create the ledger");

            const runner = createMigrationRunner({ pool, logger: silentLogger() });
            await runner.migrate();

            const migratedBefore = await databaseSnapshot(pool, database);
            const ready = await doctor.diagnose();
            const migratedAfter = await databaseSnapshot(pool, database);

            assert.equal(ready.exitCode, DOCTOR_EXIT_CODES.READY, JSON.stringify(ready.issues));
            assert.equal(ready.state, "ready");
            assert.equal(ready.summary.schemaIssues, 0);
            assert.equal(ready.summary.ledgerIssues, 0);
            assert.ok(ready.schemaChecks.length > 0);
            assert.ok(ready.schemaChecks.every((check) => check.status === "ok"));
            assert.deepEqual(
                migratedAfter,
                migratedBefore,
                "doctor must not change ledger, schema, seeds, or application data"
            );
            assert.ok(observedQueries.length > 0);
            assert.ok(observedQueries.every(isSelectOnlyStatement));
        } finally {
            await db.closePool(pool);
        }
    }
);

test(
    "migration doctor reports a dirty partially present real schema without mutating it",
    { skip: !RUN_INTEGRATION },
    async () => {
        const database = await createDisposableDatabase();
        const pool = createTestPool(database);
        const migrations = loadMigrations();
        const runner = createMigrationRunner({
            pool,
            migrations: migrations.slice(0, 3),
            logger: silentLogger()
        });

        try {
            await runner.migrate();
            await pool.promise().query(
                `ALTER TABLE progress_entries
                 ADD COLUMN source_type VARCHAR(16) NOT NULL DEFAULT 'manual'`
            );
            const dirtyMigration = migrations[3];
            await pool.promise().query(
                `INSERT INTO schema_migrations (
                    migration_id, description, checksum, status,
                    started_at, applied_at, execution_ms, failure_code
                 ) VALUES (?, ?, ?, 'failed', ?, NULL, 25, 'INTENTIONAL_FAILURE')`,
                [
                    dirtyMigration.id,
                    dirtyMigration.description,
                    dirtyMigration.checksum,
                    new Date("2026-07-18T12:00:00.000Z")
                ]
            );

            const beforeDoctor = await databaseSnapshot(pool, database);
            const report = await createMigrationDoctor({ pool }).diagnose();
            const afterDoctor = await databaseSnapshot(pool, database);

            assert.equal(report.exitCode, DOCTOR_EXIT_CODES.RECOVERY_REQUIRED);
            assert.equal(report.recoveryRequired, true);
            assert.equal(report.migrationStatus.dirty.length, 1);
            assert.deepEqual(report.migrationStatus.dirty[0], {
                migrationId: "004_training_history_consistency",
                status: "failed",
                startedAt: "2026-07-18T12:00:00.000Z",
                appliedAt: null,
                failureCode: "INTENTIONAL_FAILURE"
            });
            assert.ok(
                report.issues.some((item) => item.code === "MIGRATION_SCHEMA_PARTIAL")
            );
            assert.ok(
                report.issues.some((item) => item.code === "MIGRATION_SCHEMA_MISSING")
            );
            assert.deepEqual(afterDoctor, beforeDoctor);
        } finally {
            await db.closePool(pool);
        }
    }
);
