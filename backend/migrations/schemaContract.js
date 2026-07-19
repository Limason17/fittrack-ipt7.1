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

const studioMigrationId = "005_studio_tenancy_and_rbac";
const studioExistingTableElement = { pendingMissingAllowed: false };

const studioTables = [
    "studios",
    "studio_memberships",
    "studio_invitations",
    "studio_audit_events"
].map((name) => table(studioMigrationId, name));

const studioColumns = [
    ["studios", "id", "int", false],
    ["studios", "public_id", "char(36)", false],
    ["studios", "name", "varchar(120)", false],
    ["studios", "slug", "varchar(80)", false],
    ["studios", "status", "varchar(16)", false],
    ["studios", "default_locale", "varchar(10)", false],
    ["studios", "default_timezone", "varchar(64)", false],
    ["studios", "default_weight_unit", "varchar(4)", false],
    ["studios", "created_by_user_id", "int", false],
    ["studios", "created_at", "timestamp(3)", false],
    ["studios", "updated_at", "timestamp(3)", false],

    ["studio_memberships", "id", "int", false],
    ["studio_memberships", "public_id", "char(36)", false],
    ["studio_memberships", "studio_id", "int", false],
    ["studio_memberships", "user_id", "int", false],
    ["studio_memberships", "role", "varchar(16)", false],
    ["studio_memberships", "status", "varchar(16)", false],
    ["studio_memberships", "invited_by_user_id", "int", true],
    ["studio_memberships", "joined_at", "timestamp(3)", true],
    ["studio_memberships", "created_at", "timestamp(3)", false],
    ["studio_memberships", "updated_at", "timestamp(3)", false],

    ["studio_invitations", "id", "int", false],
    ["studio_invitations", "public_id", "char(36)", false],
    ["studio_invitations", "studio_id", "int", false],
    ["studio_invitations", "email_normalized", "varchar(254)", false],
    ["studio_invitations", "role", "varchar(16)", false],
    ["studio_invitations", "token_hash", "binary(32)", false],
    ["studio_invitations", "status", "varchar(16)", false],
    ["studio_invitations", "expires_at", "timestamp(3)", false],
    ["studio_invitations", "invited_by_user_id", "int", true],
    ["studio_invitations", "accepted_by_user_id", "int", true],
    ["studio_invitations", "accepted_at", "timestamp(3)", true],
    ["studio_invitations", "created_at", "timestamp(3)", false],
    ["studio_invitations", "revoked_at", "timestamp(3)", true],

    ["studio_audit_events", "id", "bigint", false],
    ["studio_audit_events", "public_id", "char(36)", false],
    ["studio_audit_events", "studio_id", "int", false],
    ["studio_audit_events", "actor_user_id", "int", true],
    ["studio_audit_events", "event_type", "varchar(64)", false],
    ["studio_audit_events", "target_type", "varchar(32)", true],
    ["studio_audit_events", "target_public_id", "char(36)", true],
    ["studio_audit_events", "details_json", "json", true],
    ["studio_audit_events", "created_at", "timestamp(3)", false]
].map(([tableName, columnName, columnType, nullable]) =>
    column(
        studioMigrationId,
        tableName,
        columnName,
        columnType,
        nullable,
        studioExistingTableElement
    )
);

const studioIndexes = [
    ["studios", "PRIMARY", ["id"], true],
    ["studios", "uq_studios_public_id", ["public_id"], true],
    ["studios", "uq_studios_slug", ["slug"], true],
    ["studios", "idx_studios_created_by_user", ["created_by_user_id"], false],

    ["studio_memberships", "PRIMARY", ["id"], true],
    ["studio_memberships", "uq_studio_memberships_public_id", ["public_id"], true],
    [
        "studio_memberships",
        "uq_studio_memberships_studio_user",
        ["studio_id", "user_id"],
        true
    ],
    [
        "studio_memberships",
        "idx_studio_memberships_user_status",
        ["user_id", "status"],
        false
    ],
    [
        "studio_memberships",
        "idx_studio_memberships_studio_role_status",
        ["studio_id", "role", "status"],
        false
    ],
    [
        "studio_memberships",
        "idx_studio_memberships_invited_by_user",
        ["invited_by_user_id"],
        false
    ],

    ["studio_invitations", "PRIMARY", ["id"], true],
    ["studio_invitations", "uq_studio_invitations_public_id", ["public_id"], true],
    ["studio_invitations", "uq_studio_invitations_token_hash", ["token_hash"], true],
    [
        "studio_invitations",
        "idx_studio_invitations_studio_status_expires",
        ["studio_id", "status", "expires_at"],
        false
    ],
    [
        "studio_invitations",
        "idx_studio_invitations_email_status",
        ["email_normalized", "status"],
        false
    ],
    [
        "studio_invitations",
        "idx_studio_invitations_invited_by_user",
        ["invited_by_user_id"],
        false
    ],
    [
        "studio_invitations",
        "idx_studio_invitations_accepted_by_user",
        ["accepted_by_user_id"],
        false
    ],

    ["studio_audit_events", "PRIMARY", ["id"], true],
    ["studio_audit_events", "uq_studio_audit_events_public_id", ["public_id"], true],
    [
        "studio_audit_events",
        "idx_studio_audit_events_studio_created_id",
        ["studio_id", "created_at", "id"],
        false
    ],
    [
        "studio_audit_events",
        "idx_studio_audit_events_actor_created_id",
        ["actor_user_id", "created_at", "id"],
        false
    ]
].map(([tableName, indexName, columns, unique]) =>
    index(
        studioMigrationId,
        tableName,
        indexName,
        columns,
        unique,
        studioExistingTableElement
    )
);

const studioForeignKeys = [
    ["studios", "fk_studios_created_by_user", ["created_by_user_id"], "users", ["id"], "RESTRICT"],
    ["studio_memberships", "fk_studio_memberships_studio", ["studio_id"], "studios", ["id"], "CASCADE"],
    ["studio_memberships", "fk_studio_memberships_user", ["user_id"], "users", ["id"], "RESTRICT"],
    ["studio_memberships", "fk_studio_memberships_invited_by_user", ["invited_by_user_id"], "users", ["id"], "SET NULL"],
    ["studio_invitations", "fk_studio_invitations_studio", ["studio_id"], "studios", ["id"], "CASCADE"],
    ["studio_invitations", "fk_studio_invitations_invited_by_user", ["invited_by_user_id"], "users", ["id"], "SET NULL"],
    ["studio_invitations", "fk_studio_invitations_accepted_by_user", ["accepted_by_user_id"], "users", ["id"], "SET NULL"],
    ["studio_audit_events", "fk_studio_audit_events_studio", ["studio_id"], "studios", ["id"], "CASCADE"],
    ["studio_audit_events", "fk_studio_audit_events_actor_user", ["actor_user_id"], "users", ["id"], "SET NULL"]
].map(([
    tableName,
    constraintName,
    columns,
    referencedTable,
    referencedColumns,
    deleteRule
]) =>
    foreignKey(
        studioMigrationId,
        tableName,
        constraintName,
        columns,
        referencedTable,
        referencedColumns,
        deleteRule,
        studioExistingTableElement
    )
);

const studioChecks = [
    ["studios", "chk_studios_status"],
    ["studios", "chk_studios_default_weight_unit"],
    ["studio_memberships", "chk_studio_memberships_role"],
    ["studio_memberships", "chk_studio_memberships_status"],
    ["studio_invitations", "chk_studio_invitations_role"],
    ["studio_invitations", "chk_studio_invitations_status"]
].map(([tableName, constraintName]) =>
    checkConstraint(
        studioMigrationId,
        tableName,
        constraintName,
        studioExistingTableElement
    )
);

const trainingMigrationId = "006_coach_member_training";
const trainingExistingTableElement = { pendingMissingAllowed: false };

const trainingTables = [
    "studio_coaching_relationships",
    "studio_training_programs",
    "studio_training_program_versions",
    "studio_training_program_days",
    "studio_training_program_exercises",
    "studio_program_assignments"
].map((name) => table(trainingMigrationId, name));

const trainingColumns = [
    ["studio_coaching_relationships", "id", "int", false],
    ["studio_coaching_relationships", "public_id", "char(36)", false],
    ["studio_coaching_relationships", "studio_id", "int", false],
    ["studio_coaching_relationships", "coach_membership_id", "int", false],
    ["studio_coaching_relationships", "member_membership_id", "int", false],
    ["studio_coaching_relationships", "status", "varchar(16)", false],
    ["studio_coaching_relationships", "active_pair_marker", "tinyint", true],
    ["studio_coaching_relationships", "created_by_user_id", "int", false],
    ["studio_coaching_relationships", "started_at", "timestamp(3)", false],
    ["studio_coaching_relationships", "ended_at", "timestamp(3)", true],
    ["studio_coaching_relationships", "created_at", "timestamp(3)", false],
    ["studio_coaching_relationships", "updated_at", "timestamp(3)", false],

    ["studio_training_programs", "id", "int", false],
    ["studio_training_programs", "public_id", "char(36)", false],
    ["studio_training_programs", "studio_id", "int", false],
    ["studio_training_programs", "name", "varchar(120)", false],
    ["studio_training_programs", "description", "varchar(500)", true],
    ["studio_training_programs", "status", "varchar(16)", false],
    ["studio_training_programs", "created_by_user_id", "int", false],
    ["studio_training_programs", "created_at", "timestamp(3)", false],
    ["studio_training_programs", "updated_at", "timestamp(3)", false],

    ["studio_training_program_versions", "id", "int", false],
    ["studio_training_program_versions", "public_id", "char(36)", false],
    ["studio_training_program_versions", "program_id", "int", false],
    ["studio_training_program_versions", "version_number", "int", false],
    ["studio_training_program_versions", "status", "varchar(16)", false],
    ["studio_training_program_versions", "notes", "varchar(500)", true],
    ["studio_training_program_versions", "created_by_user_id", "int", false],
    ["studio_training_program_versions", "published_at", "timestamp(3)", true],
    ["studio_training_program_versions", "created_at", "timestamp(3)", false],

    ["studio_training_program_days", "id", "int", false],
    ["studio_training_program_days", "public_id", "char(36)", false],
    ["studio_training_program_days", "program_version_id", "int", false],
    ["studio_training_program_days", "position", "int", false],
    ["studio_training_program_days", "name", "varchar(120)", false],
    ["studio_training_program_days", "instructions", "varchar(1000)", true],
    ["studio_training_program_days", "created_at", "timestamp(3)", false],
    ["studio_training_program_days", "updated_at", "timestamp(3)", false],

    ["studio_training_program_exercises", "id", "int", false],
    ["studio_training_program_exercises", "public_id", "char(36)", false],
    ["studio_training_program_exercises", "program_day_id", "int", false],
    ["studio_training_program_exercises", "position", "int", false],
    ["studio_training_program_exercises", "exercise_name_snapshot", "varchar(80)", false],
    ["studio_training_program_exercises", "instructions", "varchar(500)", true],
    ["studio_training_program_exercises", "target_sets", "smallint", true],
    ["studio_training_program_exercises", "target_reps_min", "smallint", true],
    ["studio_training_program_exercises", "target_reps_max", "smallint", true],
    ["studio_training_program_exercises", "target_weight", "decimal(6,2)", true],
    ["studio_training_program_exercises", "target_duration_minutes", "smallint", true],
    ["studio_training_program_exercises", "target_distance_km", "decimal(7,2)", true],
    ["studio_training_program_exercises", "target_rpe", "decimal(3,1)", true],
    ["studio_training_program_exercises", "rest_seconds", "smallint", true],
    ["studio_training_program_exercises", "created_at", "timestamp(3)", false],
    ["studio_training_program_exercises", "updated_at", "timestamp(3)", false],

    ["studio_program_assignments", "id", "int", false],
    ["studio_program_assignments", "public_id", "char(36)", false],
    ["studio_program_assignments", "studio_id", "int", false],
    ["studio_program_assignments", "program_version_id", "int", false],
    ["studio_program_assignments", "member_membership_id", "int", false],
    ["studio_program_assignments", "assigned_by_user_id", "int", false],
    ["studio_program_assignments", "coaching_relationship_id", "int", false],
    ["studio_program_assignments", "status", "varchar(16)", false],
    ["studio_program_assignments", "starts_on", "date", true],
    ["studio_program_assignments", "ends_on", "date", true],
    ["studio_program_assignments", "assigned_at", "timestamp(3)", false],
    ["studio_program_assignments", "completed_at", "timestamp(3)", true],
    ["studio_program_assignments", "cancelled_at", "timestamp(3)", true],
    ["studio_program_assignments", "created_at", "timestamp(3)", false],
    ["studio_program_assignments", "updated_at", "timestamp(3)", false]
].map(([tableName, columnName, columnType, nullable]) =>
    column(
        trainingMigrationId,
        tableName,
        columnName,
        columnType,
        nullable,
        trainingExistingTableElement
    )
);

const trainingIndexes = [
    ["studio_coaching_relationships", "PRIMARY", ["id"], true],
    ["studio_coaching_relationships", "uq_coaching_relationships_public_id", ["public_id"], true],
    [
        "studio_coaching_relationships",
        "uq_coaching_relationships_active_pair",
        ["coach_membership_id", "member_membership_id", "active_pair_marker"],
        true
    ],
    [
        "studio_coaching_relationships",
        "idx_coaching_relationships_studio_status",
        ["studio_id", "status"],
        false
    ],
    [
        "studio_coaching_relationships",
        "idx_coaching_relationships_coach_status",
        ["coach_membership_id", "status"],
        false
    ],
    [
        "studio_coaching_relationships",
        "idx_coaching_relationships_member_status",
        ["member_membership_id", "status"],
        false
    ],

    ["studio_training_programs", "PRIMARY", ["id"], true],
    ["studio_training_programs", "uq_training_programs_public_id", ["public_id"], true],
    [
        "studio_training_programs",
        "idx_training_programs_studio_status",
        ["studio_id", "status"],
        false
    ],

    ["studio_training_program_versions", "PRIMARY", ["id"], true],
    ["studio_training_program_versions", "uq_program_versions_public_id", ["public_id"], true],
    [
        "studio_training_program_versions",
        "uq_program_versions_program_number",
        ["program_id", "version_number"],
        true
    ],
    [
        "studio_training_program_versions",
        "idx_program_versions_program_status",
        ["program_id", "status"],
        false
    ],

    ["studio_training_program_days", "PRIMARY", ["id"], true],
    ["studio_training_program_days", "uq_program_days_public_id", ["public_id"], true],
    [
        "studio_training_program_days",
        "uq_program_days_version_position",
        ["program_version_id", "position"],
        true
    ],

    ["studio_training_program_exercises", "PRIMARY", ["id"], true],
    ["studio_training_program_exercises", "uq_program_exercises_public_id", ["public_id"], true],
    [
        "studio_training_program_exercises",
        "uq_program_exercises_day_position",
        ["program_day_id", "position"],
        true
    ],

    ["studio_program_assignments", "PRIMARY", ["id"], true],
    ["studio_program_assignments", "uq_program_assignments_public_id", ["public_id"], true],
    [
        "studio_program_assignments",
        "idx_program_assignments_studio_status",
        ["studio_id", "status"],
        false
    ],
    [
        "studio_program_assignments",
        "idx_program_assignments_member_status",
        ["member_membership_id", "status"],
        false
    ],
    [
        "studio_program_assignments",
        "idx_program_assignments_version",
        ["program_version_id"],
        false
    ],
    [
        "studio_program_assignments",
        "idx_program_assignments_coaching_relationship",
        ["coaching_relationship_id"],
        false
    ]
].map(([tableName, indexName, columns, unique]) =>
    index(
        trainingMigrationId,
        tableName,
        indexName,
        columns,
        unique,
        trainingExistingTableElement
    )
);

const trainingForeignKeys = [
    ["studio_coaching_relationships", "fk_coaching_relationships_studio", ["studio_id"], "studios", ["id"], "CASCADE"],
    ["studio_coaching_relationships", "fk_coaching_relationships_coach_membership", ["coach_membership_id"], "studio_memberships", ["id"], "RESTRICT"],
    ["studio_coaching_relationships", "fk_coaching_relationships_member_membership", ["member_membership_id"], "studio_memberships", ["id"], "RESTRICT"],
    ["studio_coaching_relationships", "fk_coaching_relationships_created_by_user", ["created_by_user_id"], "users", ["id"], "RESTRICT"],
    ["studio_training_programs", "fk_training_programs_studio", ["studio_id"], "studios", ["id"], "CASCADE"],
    ["studio_training_programs", "fk_training_programs_created_by_user", ["created_by_user_id"], "users", ["id"], "RESTRICT"],
    ["studio_training_program_versions", "fk_program_versions_program", ["program_id"], "studio_training_programs", ["id"], "CASCADE"],
    ["studio_training_program_versions", "fk_program_versions_created_by_user", ["created_by_user_id"], "users", ["id"], "RESTRICT"],
    ["studio_training_program_days", "fk_program_days_version", ["program_version_id"], "studio_training_program_versions", ["id"], "CASCADE"],
    ["studio_training_program_exercises", "fk_program_exercises_day", ["program_day_id"], "studio_training_program_days", ["id"], "CASCADE"],
    ["studio_program_assignments", "fk_program_assignments_studio", ["studio_id"], "studios", ["id"], "CASCADE"],
    ["studio_program_assignments", "fk_program_assignments_version", ["program_version_id"], "studio_training_program_versions", ["id"], "CASCADE"],
    ["studio_program_assignments", "fk_program_assignments_member_membership", ["member_membership_id"], "studio_memberships", ["id"], "RESTRICT"],
    ["studio_program_assignments", "fk_program_assignments_assigned_by_user", ["assigned_by_user_id"], "users", ["id"], "RESTRICT"],
    ["studio_program_assignments", "fk_program_assignments_coaching_relationship", ["coaching_relationship_id"], "studio_coaching_relationships", ["id"], "CASCADE"]
].map(([
    tableName,
    constraintName,
    columns,
    referencedTable,
    referencedColumns,
    deleteRule
]) =>
    foreignKey(
        trainingMigrationId,
        tableName,
        constraintName,
        columns,
        referencedTable,
        referencedColumns,
        deleteRule,
        trainingExistingTableElement
    )
);

const trainingChecks = [
    ["studio_coaching_relationships", "chk_coaching_relationships_status"],
    ["studio_coaching_relationships", "chk_coaching_relationships_distinct_membership"],
    ["studio_training_programs", "chk_training_programs_status"],
    ["studio_training_program_versions", "chk_program_versions_status"],
    ["studio_training_program_versions", "chk_program_versions_number"],
    ["studio_training_program_days", "chk_program_days_position"],
    ["studio_training_program_exercises", "chk_program_exercises_position"],
    ["studio_training_program_exercises", "chk_program_exercises_sets"],
    ["studio_training_program_exercises", "chk_program_exercises_reps_min"],
    ["studio_training_program_exercises", "chk_program_exercises_reps_max"],
    ["studio_training_program_exercises", "chk_program_exercises_reps_range"],
    ["studio_training_program_exercises", "chk_program_exercises_weight"],
    ["studio_training_program_exercises", "chk_program_exercises_duration"],
    ["studio_training_program_exercises", "chk_program_exercises_distance"],
    ["studio_training_program_exercises", "chk_program_exercises_rpe"],
    ["studio_training_program_exercises", "chk_program_exercises_rest"],
    ["studio_program_assignments", "chk_program_assignments_status"],
    ["studio_program_assignments", "chk_program_assignments_dates"]
].map(([tableName, constraintName]) =>
    checkConstraint(
        trainingMigrationId,
        tableName,
        constraintName,
        trainingExistingTableElement
    )
);

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
    },
    {
        migrationId: studioMigrationId,
        checks: [
            ...studioTables,
            ...studioColumns,
            ...studioIndexes,
            ...studioForeignKeys,
            ...studioChecks
        ]
    },
    {
        migrationId: trainingMigrationId,
        checks: [
            ...trainingTables,
            ...trainingColumns,
            ...trainingIndexes,
            ...trainingForeignKeys,
            ...trainingChecks
        ]
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
