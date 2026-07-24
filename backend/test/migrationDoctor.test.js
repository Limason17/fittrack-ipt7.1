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
const { MIGRATION_SCHEMA_CONTRACT } = require("../migrations/schemaContract");
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

test("Stage 1A schema contract covers every studio table, column, index and constraint", () => {
    const contract = MIGRATION_SCHEMA_CONTRACT.find(
        (item) => item.migrationId === "005_studio_tenancy_and_rbac"
    );
    assert.ok(contract);

    const keys = new Set(
        contract.checks.map((check) => {
            if (check.kind === "table") return `table:${check.table}`;
            if (check.kind === "column") return `column:${check.table}.${check.column}`;
            if (check.kind === "index") return `index:${check.table}.${check.index}`;
            return `${check.kind}:${check.table}.${check.constraint}`;
        })
    );
    const expected = [
        "table:studios",
        "table:studio_memberships",
        "table:studio_invitations",
        "table:studio_audit_events",
        "column:studios.public_id",
        "column:studios.default_weight_unit",
        "column:studio_memberships.joined_at",
        "column:studio_invitations.token_hash",
        "column:studio_invitations.revoked_at",
        "column:studio_audit_events.details_json",
        "index:studios.uq_studios_slug",
        "index:studio_memberships.uq_studio_memberships_studio_user",
        "index:studio_memberships.idx_studio_memberships_user_status",
        "index:studio_memberships.idx_studio_memberships_studio_role_status",
        "index:studio_invitations.uq_studio_invitations_token_hash",
        "index:studio_invitations.idx_studio_invitations_studio_status_expires",
        "index:studio_invitations.idx_studio_invitations_email_status",
        "index:studio_audit_events.idx_studio_audit_events_studio_created_id",
        "index:studio_audit_events.idx_studio_audit_events_actor_created_id",
        "foreign_key:studios.fk_studios_created_by_user",
        "foreign_key:studio_memberships.fk_studio_memberships_studio",
        "foreign_key:studio_memberships.fk_studio_memberships_user",
        "foreign_key:studio_memberships.fk_studio_memberships_invited_by_user",
        "foreign_key:studio_invitations.fk_studio_invitations_studio",
        "foreign_key:studio_invitations.fk_studio_invitations_invited_by_user",
        "foreign_key:studio_invitations.fk_studio_invitations_accepted_by_user",
        "foreign_key:studio_audit_events.fk_studio_audit_events_studio",
        "foreign_key:studio_audit_events.fk_studio_audit_events_actor_user",
        "check_constraint:studios.chk_studios_status",
        "check_constraint:studios.chk_studios_default_weight_unit",
        "check_constraint:studio_memberships.chk_studio_memberships_role",
        "check_constraint:studio_memberships.chk_studio_memberships_status",
        "check_constraint:studio_invitations.chk_studio_invitations_role",
        "check_constraint:studio_invitations.chk_studio_invitations_status"
    ];
    for (const key of expected) assert.ok(keys.has(key), `missing schema check ${key}`);

    const expectedColumns = {
        studios: [
            "id", "public_id", "name", "slug", "status", "default_locale",
            "default_timezone", "default_weight_unit", "created_by_user_id",
            "created_at", "updated_at"
        ],
        studio_memberships: [
            "id", "public_id", "studio_id", "user_id", "role", "status",
            "invited_by_user_id", "joined_at", "created_at", "updated_at"
        ],
        studio_invitations: [
            "id", "public_id", "studio_id", "email_normalized", "role",
            "token_hash", "status", "expires_at", "invited_by_user_id",
            "accepted_by_user_id", "accepted_at", "created_at", "revoked_at"
        ],
        studio_audit_events: [
            "id", "public_id", "studio_id", "actor_user_id", "event_type",
            "target_type", "target_public_id", "details_json", "created_at"
        ]
    };
    for (const [tableName, columns] of Object.entries(expectedColumns)) {
        assert.deepEqual(
            contract.checks
                .filter((check) => check.kind === "column" && check.table === tableName)
                .map((check) => check.column)
                .sort(),
            [...columns].sort()
        );
    }

    const expectedIndexes = {
        studios: [
            "PRIMARY", "uq_studios_public_id", "uq_studios_slug",
            "idx_studios_created_by_user"
        ],
        studio_memberships: [
            "PRIMARY", "uq_studio_memberships_public_id",
            "uq_studio_memberships_studio_user",
            "idx_studio_memberships_user_status",
            "idx_studio_memberships_studio_role_status",
            "idx_studio_memberships_invited_by_user"
        ],
        studio_invitations: [
            "PRIMARY", "uq_studio_invitations_public_id",
            "uq_studio_invitations_token_hash",
            "idx_studio_invitations_studio_status_expires",
            "idx_studio_invitations_email_status",
            "idx_studio_invitations_invited_by_user",
            "idx_studio_invitations_accepted_by_user"
        ],
        studio_audit_events: [
            "PRIMARY", "uq_studio_audit_events_public_id",
            "idx_studio_audit_events_studio_created_id",
            "idx_studio_audit_events_actor_created_id"
        ]
    };
    for (const [tableName, indexes] of Object.entries(expectedIndexes)) {
        assert.deepEqual(
            contract.checks
                .filter((check) => check.kind === "index" && check.table === tableName)
                .map((check) => check.index)
                .sort(),
            [...indexes].sort()
        );
    }
    assert.equal(contract.checks.length, 83);
});

test("Stage 1B.1 schema contract covers every coaching, program, version, day, exercise and assignment table, column, index, FK and constraint", () => {
    const contract = MIGRATION_SCHEMA_CONTRACT.find(
        (item) => item.migrationId === "006_coach_member_training"
    );
    assert.ok(contract);

    const keys = new Set(
        contract.checks.map((check) => {
            if (check.kind === "table") return `table:${check.table}`;
            if (check.kind === "column") return `column:${check.table}.${check.column}`;
            if (check.kind === "index") return `index:${check.table}.${check.index}`;
            return `${check.kind}:${check.table}.${check.constraint}`;
        })
    );
    const expected = [
        "table:studio_coaching_relationships",
        "table:studio_training_programs",
        "table:studio_training_program_versions",
        "table:studio_training_program_days",
        "table:studio_training_program_exercises",
        "table:studio_program_assignments",
        "column:studio_coaching_relationships.active_pair_marker",
        "column:studio_training_program_versions.version_number",
        "column:studio_training_program_exercises.exercise_name_snapshot",
        "column:studio_program_assignments.coaching_relationship_id",
        "index:studio_coaching_relationships.uq_coaching_relationships_active_pair",
        "index:studio_training_program_versions.uq_program_versions_program_number",
        "index:studio_training_program_days.uq_program_days_version_position",
        "index:studio_training_program_exercises.uq_program_exercises_day_position",
        "foreign_key:studio_coaching_relationships.fk_coaching_relationships_coach_membership",
        "foreign_key:studio_coaching_relationships.fk_coaching_relationships_member_membership",
        "foreign_key:studio_program_assignments.fk_program_assignments_version",
        "foreign_key:studio_program_assignments.fk_program_assignments_coaching_relationship",
        "check_constraint:studio_coaching_relationships.chk_coaching_relationships_distinct_membership",
        "check_constraint:studio_training_program_versions.chk_program_versions_number",
        "check_constraint:studio_training_program_exercises.chk_program_exercises_reps_range",
        "check_constraint:studio_program_assignments.chk_program_assignments_dates"
    ];
    for (const key of expected) assert.ok(keys.has(key), `missing schema check ${key}`);

    const expectedColumnCounts = {
        studio_coaching_relationships: 12,
        studio_training_programs: 9,
        studio_training_program_versions: 9,
        studio_training_program_days: 8,
        studio_training_program_exercises: 16,
        studio_program_assignments: 15
    };
    for (const [tableName, count] of Object.entries(expectedColumnCounts)) {
        assert.equal(
            contract.checks.filter((check) => check.kind === "column" && check.table === tableName).length,
            count,
            `unexpected column count for ${tableName}`
        );
    }

    assert.equal(
        contract.checks.filter((check) => check.kind === "table").length,
        6
    );
    assert.equal(
        contract.checks.filter((check) => check.kind === "foreign_key").length,
        15
    );
    assert.equal(
        contract.checks.filter((check) => check.kind === "check_constraint").length,
        18
    );
    assert.equal(contract.checks.length, 133);

    assert.ok(
        contract.checks
            .filter((check) => check.kind !== "table")
            .every((check) => check.pendingMissingAllowed === false),
        "an already-applied Stage 1B.1 column, index, FK or constraint must never be treated as optionally missing"
    );
});

test("Stage 1B.2B1 schema contract covers every workout session, exercise and set table, column, index, FK and constraint", () => {
    const contract = MIGRATION_SCHEMA_CONTRACT.find(
        (item) => item.migrationId === "007_studio_workout_execution"
    );
    assert.ok(contract);

    const keys = new Set(
        contract.checks.map((check) => {
            if (check.kind === "table") return `table:${check.table}`;
            if (check.kind === "column") return `column:${check.table}.${check.column}`;
            if (check.kind === "index") return `index:${check.table}.${check.index}`;
            return `${check.kind}:${check.table}.${check.constraint}`;
        })
    );
    const expected = [
        "table:studio_workout_sessions",
        "table:studio_workout_session_exercises",
        "table:studio_workout_session_sets",
        "column:studio_workout_sessions.client_start_key",
        "column:studio_workout_sessions.revision",
        "column:studio_workout_session_exercises.exercise_name_snapshot",
        "column:studio_workout_session_exercises.source_program_exercise_id",
        "column:studio_workout_session_sets.actual_reps",
        "index:studio_workout_sessions.uq_workout_sessions_start_key",
        "index:studio_workout_session_exercises.uq_session_exercises_session_position",
        "index:studio_workout_session_sets.uq_session_sets_exercise_position",
        "foreign_key:studio_workout_sessions.fk_workout_sessions_studio",
        "foreign_key:studio_workout_sessions.fk_workout_sessions_assignment",
        "foreign_key:studio_workout_sessions.fk_workout_sessions_member_membership",
        "foreign_key:studio_workout_sessions.fk_workout_sessions_program_version",
        "foreign_key:studio_workout_sessions.fk_workout_sessions_program_day",
        "foreign_key:studio_workout_sessions.fk_workout_sessions_coaching_relationship",
        "foreign_key:studio_workout_session_exercises.fk_session_exercises_session",
        "foreign_key:studio_workout_session_exercises.fk_session_exercises_source",
        "foreign_key:studio_workout_session_sets.fk_session_sets_exercise",
        "check_constraint:studio_workout_sessions.chk_workout_sessions_status",
        "check_constraint:studio_workout_sessions.chk_workout_sessions_revision",
        "check_constraint:studio_workout_session_exercises.chk_session_exercises_reps_range",
        "check_constraint:studio_workout_session_sets.chk_session_sets_completed_at"
    ];
    for (const key of expected) assert.ok(keys.has(key), `missing schema check ${key}`);

    const expectedColumnCounts = {
        studio_workout_sessions: 17,
        studio_workout_session_exercises: 20,
        studio_workout_session_sets: 15
    };
    for (const [tableName, count] of Object.entries(expectedColumnCounts)) {
        assert.equal(
            contract.checks.filter((check) => check.kind === "column" && check.table === tableName).length,
            count,
            `unexpected column count for ${tableName}`
        );
    }

    assert.equal(contract.checks.filter((check) => check.kind === "table").length, 3);
    assert.equal(contract.checks.filter((check) => check.kind === "index").length, 16);
    assert.equal(contract.checks.filter((check) => check.kind === "foreign_key").length, 9);
    assert.equal(contract.checks.filter((check) => check.kind === "check_constraint").length, 26);
    assert.equal(contract.checks.length, 106);

    // deliberate departure from Stage 1B.1: only source_program_exercise_id uses SET NULL,
    // every other workout session FK is a proactive CASCADE to avoid the Stage 1B.1-class
    // FK-ordering bug where a RESTRICT edge blocks studio deletion depending on cascade order
    const deleteRules = Object.fromEntries(
        contract.checks
            .filter((check) => check.kind === "foreign_key")
            .map((check) => [check.constraint, check.deleteRule])
    );
    assert.equal(deleteRules.fk_session_exercises_source, "SET NULL");
    for (const [constraint, rule] of Object.entries(deleteRules)) {
        if (constraint === "fk_session_exercises_source") continue;
        assert.equal(rule, "CASCADE", `${constraint} must cascade so studio deletion never fails on cascade ordering`);
    }

    assert.ok(
        contract.checks
            .filter((check) => check.kind !== "table")
            .every((check) => check.pendingMissingAllowed === false),
        "an already-applied Stage 1B.2B1 column, index, FK or constraint must never be treated as optionally missing"
    );
});

test("Stage 1B.2B2B schema contract covers every workout session feedback table, column, index, FK and constraint", () => {
    const contract = MIGRATION_SCHEMA_CONTRACT.find(
        (item) => item.migrationId === "008_studio_workout_session_feedback"
    );
    assert.ok(contract);

    const keys = new Set(
        contract.checks.map((check) => {
            if (check.kind === "table") return `table:${check.table}`;
            if (check.kind === "column") return `column:${check.table}.${check.column}`;
            if (check.kind === "index") return `index:${check.table}.${check.index}`;
            return `${check.kind}:${check.table}.${check.constraint}`;
        })
    );
    const expected = [
        "table:studio_workout_session_feedback",
        "column:studio_workout_session_feedback.client_feedback_key",
        "column:studio_workout_session_feedback.body",
        "column:studio_workout_session_feedback.author_user_id",
        "index:studio_workout_session_feedback.uq_workout_session_feedback_idempotency",
        "index:studio_workout_session_feedback.uq_workout_session_feedback_public_id",
        "foreign_key:studio_workout_session_feedback.fk_workout_session_feedback_studio",
        "foreign_key:studio_workout_session_feedback.fk_workout_session_feedback_session",
        "foreign_key:studio_workout_session_feedback.fk_workout_session_feedback_relationship",
        "foreign_key:studio_workout_session_feedback.fk_workout_session_feedback_coach_membership",
        "foreign_key:studio_workout_session_feedback.fk_workout_session_feedback_author",
        "check_constraint:studio_workout_session_feedback.chk_workout_session_feedback_body"
    ];
    for (const key of expected) assert.ok(keys.has(key), `missing schema check ${key}`);

    assert.equal(contract.checks.filter((check) => check.kind === "table").length, 1);
    assert.equal(contract.checks.filter((check) => check.kind === "column").length, 10);
    assert.equal(contract.checks.filter((check) => check.kind === "index").length, 8);
    assert.equal(contract.checks.filter((check) => check.kind === "foreign_key").length, 5);
    assert.equal(contract.checks.filter((check) => check.kind === "check_constraint").length, 1);
    assert.equal(contract.checks.length, 25);

    // author_user_id is the one deliberate RESTRICT (matching every other *_user_id FK in this
    // schema, e.g. fk_studios_created_by_user): a user who authored feedback can never be
    // hard-deleted out from under it. Every other edge cascades with the studio/session chain.
    const deleteRules = Object.fromEntries(
        contract.checks
            .filter((check) => check.kind === "foreign_key")
            .map((check) => [check.constraint, check.deleteRule])
    );
    assert.equal(deleteRules.fk_workout_session_feedback_author, "RESTRICT");
    for (const [constraint, rule] of Object.entries(deleteRules)) {
        if (constraint === "fk_workout_session_feedback_author") continue;
        assert.equal(rule, "CASCADE", `${constraint} must cascade so studio/session deletion never orphans feedback`);
    }

    assert.ok(
        contract.checks
            .filter((check) => check.kind !== "table")
            .every((check) => check.pendingMissingAllowed === false),
        "an already-applied Stage 1B.2B2B column, index, FK or constraint must never be treated as optionally missing"
    );
});

test("Stage 3B1 schema contract covers every account self-service column, table, index, FK and constraint", () => {
    const contract = MIGRATION_SCHEMA_CONTRACT.find(
        (item) => item.migrationId === "009_account_self_service"
    );
    assert.ok(contract);

    const keys = new Set(
        contract.checks.map((check) => {
            if (check.kind === "table") return `table:${check.table}`;
            if (check.kind === "column") return `column:${check.table}.${check.column}`;
            if (check.kind === "index") return `index:${check.table}.${check.index}`;
            return `${check.kind}:${check.table}.${check.constraint}`;
        })
    );
    const expected = [
        "column:users.auth_version",
        "column:users.email_changed_at",
        "column:users.password_changed_at",
        "table:user_email_change_requests",
        "column:user_email_change_requests.token_hash",
        "column:user_email_change_requests.new_email_normalized",
        "index:user_email_change_requests.uq_user_email_change_requests_token_hash",
        "index:user_email_change_requests.uq_user_email_change_requests_public_id",
        "foreign_key:user_email_change_requests.fk_user_email_change_requests_user",
        "check_constraint:user_email_change_requests.chk_user_email_change_requests_status"
    ];
    for (const key of expected) assert.ok(keys.has(key), `missing schema check ${key}`);

    assert.equal(
        contract.checks.filter((check) => check.kind === "column" && check.table === "users").length,
        3
    );
    assert.equal(contract.checks.filter((check) => check.kind === "table").length, 1);
    assert.equal(
        contract.checks.filter((check) => check.kind === "column" && check.table === "user_email_change_requests").length,
        10
    );
    assert.equal(contract.checks.filter((check) => check.kind === "index").length, 4);
    assert.equal(contract.checks.filter((check) => check.kind === "foreign_key").length, 1);
    assert.equal(contract.checks.filter((check) => check.kind === "check_constraint").length, 1);
    assert.equal(contract.checks.length, 20);

    const deleteRules = Object.fromEntries(
        contract.checks
            .filter((check) => check.kind === "foreign_key")
            .map((check) => [check.constraint, check.deleteRule])
    );
    assert.equal(deleteRules.fk_user_email_change_requests_user, "CASCADE");

    assert.ok(
        contract.checks
            .filter((check) => check.kind !== "table")
            .every((check) => check.pendingMissingAllowed === false),
        "an already-applied Stage 3B1 column, index, FK or constraint must never be treated as optionally missing"
    );
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
            applied: 5,
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
