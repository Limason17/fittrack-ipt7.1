function table(migrationId, tableName, options = {}) {
    return {
        migrationId,
        kind: "table",
        table: tableName,
        pendingMissingAllowed: true,
        ...options
    };
}

function column(
    migrationId,
    tableName,
    columnName,
    columnType,
    nullable,
    options = {}
) {
    return {
        migrationId,
        kind: "column",
        table: tableName,
        column: columnName,
        columnType,
        nullable,
        ...options
    };
}

function index(migrationId, tableName, indexName, columns, unique, options = {}) {
    return {
        migrationId,
        kind: "index",
        table: tableName,
        index: indexName,
        columns,
        unique,
        ...options
    };
}

function foreignKey(
    migrationId,
    tableName,
    constraintName,
    columns,
    referencedTable,
    referencedColumns,
    deleteRule,
    options = {}
) {
    return {
        migrationId,
        kind: "foreign_key",
        table: tableName,
        constraint: constraintName,
        columns,
        referencedTable,
        referencedColumns,
        deleteRule,
        ...options
    };
}

function checkConstraint(migrationId, tableName, constraintName, options = {}) {
    return {
        migrationId,
        kind: "check_constraint",
        table: tableName,
        constraint: constraintName,
        ...options
    };
}

const baseTables = [
    "users",
    "exercises",
    "workouts",
    "workout_exercises",
    "progress_entries"
].map((name) => table("001_initial_schema", name));

const baseColumns = [
    column("001_initial_schema", "users", "id", "int", false, {
        pendingMissingAllowed: false
    }),
    column("001_initial_schema", "users", "username", "varchar(50)", false, {
        pendingMissingAllowed: false
    }),
    column("001_initial_schema", "users", "email", "varchar(120)", false, {
        pendingMissingAllowed: false
    }),
    column("001_initial_schema", "users", "password_hash", "varchar(255)", false, {
        pendingMissingAllowed: false
    }),
    column("001_initial_schema", "users", "created_at", "timestamp", true, {
        pendingMissingAllowed: false
    }),

    column("001_initial_schema", "exercises", "id", "int", false, {
        pendingMissingAllowed: false
    }),
    column("001_initial_schema", "exercises", "user_id", "int", true, {
        pendingMissingAllowed: false
    }),
    column("001_initial_schema", "exercises", "name", "varchar(80)", false, {
        pendingMissingAllowed: false
    }),
    column("001_initial_schema", "exercises", "description", "varchar(255)", true, {
        pendingMissingAllowed: false
    }),
    column("001_initial_schema", "exercises", "category", "varchar(50)", false, {
        pendingMissingAllowed: false
    }),
    column("001_initial_schema", "exercises", "muscle_group", "varchar(50)", false, {
        pendingMissingAllowed: false
    }),
    column("001_initial_schema", "exercises", "image_url", "varchar(500)", true, {
        pendingMissingAllowed: false
    }),
    column("001_initial_schema", "exercises", "created_at", "timestamp", true, {
        pendingMissingAllowed: false
    }),

    column("001_initial_schema", "workouts", "id", "int", false, {
        pendingMissingAllowed: false
    }),
    column("001_initial_schema", "workouts", "user_id", "int", false, {
        pendingMissingAllowed: false
    }),
    column("001_initial_schema", "workouts", "title", "varchar(100)", false, {
        pendingMissingAllowed: false
    }),
    column("001_initial_schema", "workouts", "workout_date", "date", false, {
        pendingMissingAllowed: false
    }),
    column("001_initial_schema", "workouts", "notes", "varchar(255)", true, {
        pendingMissingAllowed: false
    }),
    column("001_initial_schema", "workouts", "created_at", "timestamp", true, {
        pendingMissingAllowed: false
    }),

    column("001_initial_schema", "workout_exercises", "id", "int", false, {
        pendingMissingAllowed: false
    }),
    column("001_initial_schema", "workout_exercises", "workout_id", "int", false, {
        pendingMissingAllowed: false
    }),
    column("001_initial_schema", "workout_exercises", "exercise_id", "int", false, {
        pendingMissingAllowed: false
    }),

    column("001_initial_schema", "progress_entries", "id", "int", false, {
        pendingMissingAllowed: false
    }),
    column("001_initial_schema", "progress_entries", "user_id", "int", false, {
        pendingMissingAllowed: false
    }),
    column("001_initial_schema", "progress_entries", "exercise_id", "int", false, {
        pendingMissingAllowed: false
    }),
    column("001_initial_schema", "progress_entries", "entry_date", "date", false, {
        pendingMissingAllowed: false
    })
];

const baseIndexes = [
    index("001_initial_schema", "users", "PRIMARY", ["id"], true, {
        pendingMissingAllowed: false
    }),
    index("001_initial_schema", "users", "username", ["username"], true, {
        pendingMissingAllowed: false
    }),
    index("001_initial_schema", "users", "email", ["email"], true, {
        pendingMissingAllowed: false
    }),
    index("001_initial_schema", "exercises", "PRIMARY", ["id"], true, {
        pendingMissingAllowed: false
    }),
    index("001_initial_schema", "workouts", "PRIMARY", ["id"], true, {
        pendingMissingAllowed: false
    }),
    index("001_initial_schema", "workout_exercises", "PRIMARY", ["id"], true, {
        pendingMissingAllowed: false
    }),
    index("001_initial_schema", "progress_entries", "PRIMARY", ["id"], true, {
        pendingMissingAllowed: false
    })
];

const legacyUpgradeColumns = [
    column("002_legacy_schema_upgrade", "users", "language_preference", "enum('de','en')", false),
    column("002_legacy_schema_upgrade", "users", "weight_unit", "enum('kg','lb')", false),
    column("002_legacy_schema_upgrade", "users", "distance_unit", "enum('km','mi')", false),

    column("002_legacy_schema_upgrade", "workout_exercises", "sets", "int", true, {
        repairableMismatch: true
    }),
    column("002_legacy_schema_upgrade", "workout_exercises", "reps", "int", true, {
        repairableMismatch: true
    }),
    column("002_legacy_schema_upgrade", "workout_exercises", "weight", "decimal(6,2)", true, {
        repairableMismatch: true
    }),
    column("002_legacy_schema_upgrade", "workout_exercises", "duration_minutes", "int", true),
    column("002_legacy_schema_upgrade", "workout_exercises", "distance_km", "decimal(7,2)", true),
    column("002_legacy_schema_upgrade", "workout_exercises", "intensity_level", "int", true),

    column("002_legacy_schema_upgrade", "progress_entries", "workout_id", "int", true),
    column("002_legacy_schema_upgrade", "progress_entries", "sets", "int", true, {
        repairableMismatch: true
    }),
    column("002_legacy_schema_upgrade", "progress_entries", "reps", "int", true, {
        repairableMismatch: true
    }),
    column("002_legacy_schema_upgrade", "progress_entries", "weight", "decimal(6,2)", true, {
        repairableMismatch: true
    }),
    column("002_legacy_schema_upgrade", "progress_entries", "duration_minutes", "int", true),
    column("002_legacy_schema_upgrade", "progress_entries", "distance_km", "decimal(7,2)", true),
    column("002_legacy_schema_upgrade", "progress_entries", "intensity_level", "int", true)
];

const legacyUpgradeIndexes = [
    index("002_legacy_schema_upgrade", "exercises", "idx_exercises_user", ["user_id"], false),
    index(
        "002_legacy_schema_upgrade",
        "workouts",
        "idx_workouts_user_date",
        ["user_id", "workout_date"],
        false
    ),
    index(
        "002_legacy_schema_upgrade",
        "progress_entries",
        "idx_progress_user_date",
        ["user_id", "entry_date"],
        false
    )
];

const legacyUpgradeForeignKeys = [
    foreignKey(
        "002_legacy_schema_upgrade",
        "exercises",
        "fk_exercises_user",
        ["user_id"],
        "users",
        ["id"],
        "SET NULL"
    ),
    foreignKey(
        "002_legacy_schema_upgrade",
        "workouts",
        "fk_workouts_user",
        ["user_id"],
        "users",
        ["id"],
        "CASCADE"
    ),
    foreignKey(
        "002_legacy_schema_upgrade",
        "workout_exercises",
        "fk_workout_exercises_workout",
        ["workout_id"],
        "workouts",
        ["id"],
        "CASCADE"
    ),
    foreignKey(
        "002_legacy_schema_upgrade",
        "workout_exercises",
        "fk_workout_exercises_exercise",
        ["exercise_id"],
        "exercises",
        ["id"],
        "NO ACTION"
    ),
    foreignKey(
        "002_legacy_schema_upgrade",
        "progress_entries",
        "fk_progress_user",
        ["user_id"],
        "users",
        ["id"],
        "CASCADE"
    ),
    foreignKey(
        "002_legacy_schema_upgrade",
        "progress_entries",
        "fk_progress_workout",
        ["workout_id"],
        "workouts",
        ["id"],
        "CASCADE"
    ),
    foreignKey(
        "002_legacy_schema_upgrade",
        "progress_entries",
        "fk_progress_exercise",
        ["exercise_id"],
        "exercises",
        ["id"],
        "NO ACTION"
    )
];

const historyColumns = [
    ["workout_exercises", "exercise_name_snapshot", "varchar(80)", false],
    ["workout_exercises", "exercise_category_snapshot", "varchar(50)", false],
    ["workout_exercises", "exercise_muscle_group_snapshot", "varchar(50)", false],
    ["workout_exercises", "exercise_image_url_snapshot", "varchar(500)", true],
    ["progress_entries", "exercise_name_snapshot", "varchar(80)", false],
    ["progress_entries", "exercise_category_snapshot", "varchar(50)", false],
    ["progress_entries", "exercise_muscle_group_snapshot", "varchar(50)", false],
    ["progress_entries", "exercise_image_url_snapshot", "varchar(500)", true],
    ["progress_entries", "source_type", "varchar(16)", false],
    ["progress_entries", "workout_exercise_id", "int", true]
].map(([tableName, columnName, columnType, nullable]) =>
    column(
        "004_training_history_consistency",
        tableName,
        columnName,
        columnType,
        nullable
    )
);

const historyIndexes = [
    index(
        "004_training_history_consistency",
        "workout_exercises",
        "uq_workout_exercise_workout",
        ["id", "workout_id"],
        true
    ),
    index(
        "004_training_history_consistency",
        "progress_entries",
        "uq_progress_workout_exercise",
        ["workout_exercise_id"],
        true
    )
];

const historyConstraints = [
    foreignKey(
        "004_training_history_consistency",
        "progress_entries",
        "fk_progress_workout_exercise",
        ["workout_exercise_id", "workout_id"],
        "workout_exercises",
        ["id", "workout_id"],
        "CASCADE"
    ),
    checkConstraint(
        "004_training_history_consistency",
        "progress_entries",
        "chk_progress_source_link"
    ),
    checkConstraint(
        "004_training_history_consistency",
        "workout_exercises",
        "chk_workout_exercise_metric_ranges"
    ),
    checkConstraint(
        "004_training_history_consistency",
        "progress_entries",
        "chk_progress_metric_ranges"
    )
];

const MIGRATION_SCHEMA_CONTRACT = Object.freeze([
    {
        migrationId: "001_initial_schema",
        checks: [...baseTables, ...baseColumns, ...baseIndexes]
    },
    {
        migrationId: "002_legacy_schema_upgrade",
        checks: [
            ...legacyUpgradeColumns,
            ...legacyUpgradeIndexes,
            ...legacyUpgradeForeignKeys
        ]
    },
    {
        migrationId: "003_seed_global_exercises",
        checks: [],
        ledgerOnly: true
    },
    {
        migrationId: "004_training_history_consistency",
        checks: [...historyColumns, ...historyIndexes, ...historyConstraints]
    }
]);

const LEDGER_SCHEMA_CONTRACT = Object.freeze([
    table(null, "schema_migrations"),
    column(null, "schema_migrations", "migration_id", "varchar(190)", false),
    column(null, "schema_migrations", "description", "varchar(255)", false),
    column(null, "schema_migrations", "checksum", "char(64)", false),
    column(null, "schema_migrations", "status", "varchar(16)", false),
    column(null, "schema_migrations", "started_at", "timestamp(6)", false),
    column(null, "schema_migrations", "applied_at", "timestamp(6)", true),
    column(null, "schema_migrations", "execution_ms", "int", true),
    column(null, "schema_migrations", "failure_code", "varchar(64)", true),
    index(null, "schema_migrations", "PRIMARY", ["migration_id"], true),
    checkConstraint(null, "schema_migrations", "chk_schema_migrations_status")
]);

module.exports = {
    LEDGER_SCHEMA_CONTRACT,
    MIGRATION_SCHEMA_CONTRACT,
    checkConstraint,
    column,
    foreignKey,
    index,
    table
};
