const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
    DOCTOR_EXIT_CODES,
    buildDoctorReport,
    createSelectOnlyConnection,
    isSelectOnlyStatement,
    validateLedgerRecords
} = require("../migrations/doctor");
const { createStructuredLogger } = require("../startup/logger");
const {
    createSafeDatabaseTarget,
    main: runDoctorCli
} = require("../scripts/migrateDoctor");

function migration(id) {
    return {
        id,
        description: id,
        checksum: crypto.createHash("sha256").update(id).digest("hex"),
        async up() {}
    };
}

function appliedRecord(definition, overrides = {}) {
    return {
        id: definition.id,
        description: definition.description,
        checksum: definition.checksum,
        status: "applied",
        started_at: new Date("2026-07-18T12:00:00.000Z"),
        applied_at: new Date("2026-07-18T12:00:01.000Z"),
        execution_ms: 1000,
        failure_code: null,
        ...overrides
    };
}

function ledger(overrides = {}) {
    return {
        exists: true,
        valid: true,
        checks: [],
        issues: [],
        ...overrides
    };
}

test("migration doctor reports a clean state with exit code 0", () => {
    const migrations = [migration("001_alpha"), migration("002_beta")];
    const report = buildDoctorReport({
        database: "fittrack_test",
        migrations,
        records: migrations.map((item) => appliedRecord(item)),
        ledger: ledger(),
        schemaChecks: [
            {
                migrationId: "001_alpha",
                kind: "table",
                object: "users",
                table: "users",
                status: "ok",
                expected: { exists: true },
                actual: { exists: true }
            }
        ]
    });

    assert.equal(report.state, "ready");
    assert.equal(report.code, "MIGRATION_DOCTOR_OK");
    assert.equal(report.exitCode, DOCTOR_EXIT_CODES.READY);
    assert.equal(report.recoveryRequired, false);
    assert.deepEqual(report.issues, []);
});

test("pending migrations are distinct from recovery and use exit code 2", () => {
    const migrations = [migration("001_alpha"), migration("002_beta")];
    const report = buildDoctorReport({
        database: "fittrack_test",
        migrations,
        records: [appliedRecord(migrations[0])],
        ledger: ledger(),
        schemaChecks: []
    });

    assert.equal(report.state, "pending");
    assert.equal(report.exitCode, DOCTOR_EXIT_CODES.PENDING);
    assert.equal(report.recoveryRequired, false);
    assert.deepEqual(report.migrationStatus.pending, ["002_beta"]);
    assert.equal(report.issues[0].code, "MIGRATIONS_PENDING");
});

test("dirty migration includes safe details and partial schema diagnostics", () => {
    const migrations = [migration("001_alpha"), migration("002_beta")];
    const records = [
        appliedRecord(migrations[0]),
        appliedRecord(migrations[1], {
            status: "failed",
            applied_at: null,
            failure_code: "INTENTIONAL_FAILURE"
        })
    ];
    const report = buildDoctorReport({
        database: "fittrack_test",
        migrations,
        records,
        ledger: ledger(),
        schemaChecks: [
            {
                migrationId: "002_beta",
                kind: "column",
                object: "users.safe_column",
                table: "users",
                status: "ok",
                expected: { columnType: "int", nullable: true },
                actual: { columnType: "int", nullable: true }
            },
            {
                migrationId: "002_beta",
                kind: "column",
                object: "users.missing_column",
                table: "users",
                status: "missing",
                expected: { columnType: "int", nullable: true },
                actual: null
            }
        ]
    });

    assert.equal(report.state, "recovery_required");
    assert.equal(report.exitCode, DOCTOR_EXIT_CODES.RECOVERY_REQUIRED);
    assert.deepEqual(report.migrationStatus.dirty, [
        {
            migrationId: "002_beta",
            status: "failed",
            startedAt: "2026-07-18T12:00:00.000Z",
            appliedAt: null,
            failureCode: "INTENTIONAL_FAILURE"
        }
    ]);
    assert.ok(report.issues.some((item) => item.code === "MIGRATION_DIRTY"));
    assert.ok(
        report.issues.some((item) => item.code === "MIGRATION_SCHEMA_PARTIAL")
    );
    assert.ok(
        report.issues.some((item) => item.code === "MIGRATION_SCHEMA_MISSING")
    );
});

test("checksum drift and unknown ledger entries require recovery", () => {
    const migrations = [migration("001_alpha"), migration("002_beta")];
    const records = [
        appliedRecord(migrations[0], { checksum: "0".repeat(64) }),
        appliedRecord(migrations[1]),
        appliedRecord(migration("900_database_ahead"))
    ];
    const report = buildDoctorReport({
        database: "fittrack_test",
        migrations,
        records,
        ledger: ledger(),
        schemaChecks: []
    });

    assert.equal(report.exitCode, DOCTOR_EXIT_CODES.RECOVERY_REQUIRED);
    assert.ok(
        report.issues.some((item) => item.code === "MIGRATION_CHECKSUM_DRIFT")
    );
    assert.ok(report.issues.some((item) => item.code === "MIGRATION_UNKNOWN"));
});

test("unsafe ledger failure codes are not returned verbatim", () => {
    const definition = migration("001_alpha");
    const records = [
        appliedRecord(definition, {
            status: "failed",
            applied_at: null,
            failure_code: "password=hunter2"
        })
    ];

    const issues = validateLedgerRecords(records);
    assert.ok(issues.some((item) => item.reason === "invalid_failure_code"));

    const report = buildDoctorReport({
        database: "fittrack_test",
        migrations: [definition],
        records,
        ledger: ledger({ valid: false, issues }),
        schemaChecks: []
    });
    const serialized = JSON.stringify(report);
    assert.equal(serialized.includes("hunter2"), false);
    assert.equal(
        report.migrationStatus.dirty[0].failureCode,
        "MIGRATION_FAILURE_CODE_INVALID"
    );
});

test("read-only connection accepts one SELECT and rejects every write form", async () => {
    const queries = [];
    const connection = {
        async query(sql) {
            queries.push(sql);
            return [[]];
        }
    };
    const readOnly = createSelectOnlyConnection(connection);

    assert.equal(isSelectOnlyStatement(" SELECT 1 AS ok "), true);
    assert.equal(isSelectOnlyStatement("SELECT 1; DELETE FROM users"), false);
    assert.equal(isSelectOnlyStatement("SELECT GET_LOCK('doctor', 1)"), false);
    assert.equal(isSelectOnlyStatement("SELECT * FROM users FOR UPDATE"), false);
    assert.equal(isSelectOnlyStatement("SELECT 1 INTO @doctor_result"), false);
    assert.equal(isSelectOnlyStatement("UPDATE users SET email = 'x'"), false);
    await readOnly.query("SELECT 1 AS ok");
    await assert.rejects(
        readOnly.query("CREATE TABLE forbidden (id INT)"),
        (error) => error.code === "MIGRATION_DOCTOR_WRITE_FORBIDDEN"
    );
    assert.deepEqual(queries, ["SELECT 1 AS ok"]);
});

test("CLI emits a safe JSON target without user or password and preserves exit 0", async () => {
    const lines = [];
    const logger = createStructuredLogger({
        log(line) {
            lines.push(line);
        },
        warn(line) {
            lines.push(line);
        },
        error(line) {
            lines.push(line);
        }
    });
    let closed = false;
    let exitCode;
    const report = {
        database: "fittrack_test",
        state: "ready",
        code: "MIGRATION_DOCTOR_OK",
        exitCode: 0,
        ready: true,
        recoveryRequired: false,
        summary: {
            applied: 4,
            pending: 0,
            dirty: 0,
            drift: 0,
            unknown: 0,
            schemaIssues: 0,
            ledgerIssues: 0
        },
        migrationStatus: {
            applied: [],
            pending: [],
            dirty: [],
            drift: [],
            unknown: []
        },
        ledger: { exists: true, valid: true, checks: [] },
        schemaChecks: [],
        issues: []
    };

    await runDoctorCli({
        env: { NODE_ENV: "test" },
        databaseConfig: {
            host: "127.0.0.1",
            port: 3306,
            database: "fittrack_test",
            user: "credential-user-must-not-appear",
            password: "password-must-not-appear"
        },
        runtime: {
            pool: {},
            logger,
            async verifyConnection() {},
            async close() {
                closed = true;
            }
        },
        doctor: {
            async diagnose() {
                return report;
            }
        },
        logger,
        setExitCode(value) {
            exitCode = value;
        }
    });

    assert.equal(closed, true);
    assert.equal(exitCode, 0);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].includes("password-must-not-appear"), false);
    assert.equal(lines[0].includes("credential-user-must-not-appear"), false);
    const output = JSON.parse(lines[0]);
    assert.equal(output.event, "migration_doctor_result");
    assert.deepEqual(output.target, {
        nodeEnv: "test",
        host: "127.0.0.1",
        port: 3306,
        database: "fittrack_test",
        selectedDatabase: "fittrack_test"
    });
});

test("unsafe host strings are replaced instead of leaking URI credentials", () => {
    const target = createSafeDatabaseTarget(
        {
            host: "mysql://user:supersecret@internal/fittrack",
            port: 3306,
            database: "fittrack",
            password: "another-secret"
        },
        { NODE_ENV: "production" }
    );

    assert.equal(target.host, "[INVALID_DB_HOST]");
    assert.equal(JSON.stringify(target).includes("supersecret"), false);
    assert.equal(JSON.stringify(target).includes("another-secret"), false);
});

test("CLI maps operational failures to exit code 1 and still closes the pool", async () => {
    const lines = [];
    const logger = createStructuredLogger({
        log(line) {
            lines.push(line);
        },
        warn(line) {
            lines.push(line);
        },
        error(line) {
            lines.push(line);
        }
    });
    let closed = false;
    let exitCode;

    const result = await runDoctorCli({
        env: { NODE_ENV: "test" },
        databaseConfig: {
            host: "127.0.0.1",
            port: 3306,
            database: "fittrack_test",
            user: "root",
            password: "failure-password-must-not-appear"
        },
        runtime: {
            pool: {},
            logger,
            async verifyConnection() {
                const error = new Error("connection refused password=hunter2");
                error.code = "ECONNREFUSED";
                throw error;
            },
            async close() {
                closed = true;
            }
        },
        logger,
        setExitCode(value) {
            exitCode = value;
        }
    });

    assert.equal(closed, true);
    assert.equal(exitCode, DOCTOR_EXIT_CODES.OPERATIONAL_FAILURE);
    assert.equal(result.state, "failed");
    assert.equal(lines.length, 1);
    assert.equal(lines[0].includes("hunter2"), false);
    assert.equal(lines[0].includes("failure-password-must-not-appear"), false);
    const output = JSON.parse(lines[0]);
    assert.equal(output.code, "MIGRATION_DOCTOR_FAILED");
    assert.equal(output.exitCode, 1);
});
