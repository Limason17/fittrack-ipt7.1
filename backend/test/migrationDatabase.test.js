const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { after, before, test } = require("node:test");
const mysql = require("mysql2/promise");

const db = require("../config/db");
const { loadMigrations } = require("../migrations/loader");
const { createMigrationRunner, lockName } = require("../migrations/runner");

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

function testMigration(id, up) {
    return {
        id,
        description: id,
        checksum: crypto.createHash("sha256").update(id).digest("hex"),
        up
    };
}

async function personalDataSnapshot(sql) {
    const [counts] = await sql.query(`
        SELECT
            (SELECT COUNT(*) FROM users) AS users,
            (SELECT COUNT(*) FROM exercises) AS exercises,
            (SELECT COUNT(*) FROM workouts) AS workouts,
            (SELECT COUNT(*) FROM workout_exercises) AS workout_exercises,
            (SELECT COUNT(*) FROM progress_entries) AS progress_entries
    `);
    const [links] = await sql.query(`
        SELECT
            pe.id AS progress_id,
            pe.user_id,
            pe.workout_id,
            pe.workout_exercise_id,
            pe.exercise_id,
            pe.source_type,
            we.workout_id AS linked_workout_id,
            we.exercise_id AS linked_exercise_id
        FROM progress_entries pe
        LEFT JOIN workout_exercises we ON we.id = pe.workout_exercise_id
        ORDER BY pe.id
    `);
    return {
        counts: Object.fromEntries(
            Object.entries(counts[0]).map(([name, value]) => [name, Number(value)])
        ),
        links
    };
}

async function expectMysqlError(promise, code) {
    await assert.rejects(promise, (error) => error.code === code);
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
    "Migrationen erstellen eine leere DB vollständig und der zweite Lauf ist ein No-op",
    { skip: !RUN_INTEGRATION },
    async () => {
        const database = await createDisposableDatabase();
        const pool = createTestPool(database);
        const runner = createMigrationRunner({ pool, logger: silentLogger() });

        try {
            const beforeStatus = await runner.status();
            assert.deepEqual(
                beforeStatus.pending.map((migration) => migration.id),
                [
                    "001_initial_schema",
                    "002_legacy_schema_upgrade",
                    "003_seed_global_exercises",
                    "004_training_history_consistency",
                    "005_studio_tenancy_and_rbac",
                    "006_coach_member_training",
                    "007_studio_workout_execution",
                    "008_studio_workout_session_feedback"
                ]
            );

            const [ledgerBefore] = await pool.promise().query(
                `SELECT COUNT(*) AS total
                 FROM information_schema.TABLES
                 WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'schema_migrations'`,
                [database]
            );
            assert.equal(Number(ledgerBefore[0].total), 0, "status must not create ledger DDL");

            const firstRun = await runner.migrate();
            assert.deepEqual(firstRun.applied, [
                "001_initial_schema",
                "002_legacy_schema_upgrade",
                "003_seed_global_exercises",
                "004_training_history_consistency",
                "005_studio_tenancy_and_rbac",
                "006_coach_member_training",
                "007_studio_workout_execution",
                "008_studio_workout_session_feedback"
            ]);

            const [tables] = await pool.promise().query(
                `SELECT TABLE_NAME AS table_name
                 FROM information_schema.TABLES
                 WHERE TABLE_SCHEMA = ?
                 ORDER BY TABLE_NAME`,
                [database]
            );
            assert.deepEqual(
                tables.map((row) => row.table_name),
                [
                    "exercises",
                    "progress_entries",
                    "schema_migrations",
                    "studio_audit_events",
                    "studio_coaching_relationships",
                    "studio_invitations",
                    "studio_memberships",
                    "studio_program_assignments",
                    "studio_training_program_days",
                    "studio_training_program_exercises",
                    "studio_training_program_versions",
                    "studio_training_programs",
                    "studio_workout_session_exercises",
                    "studio_workout_session_feedback",
                    "studio_workout_session_sets",
                    "studio_workout_sessions",
                    "studios",
                    "users",
                    "workout_exercises",
                    "workouts"
                ]
            );

            const [seedRows] = await pool.promise().query(
                "SELECT COUNT(*) AS total FROM exercises WHERE user_id IS NULL"
            );
            assert.equal(Number(seedRows[0].total), 14);

            const [historyColumns] = await pool.promise().query(
                `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name
                 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = ?
                   AND COLUMN_NAME IN (
                       'source_type', 'workout_exercise_id',
                       'exercise_name_snapshot', 'exercise_category_snapshot',
                       'exercise_muscle_group_snapshot', 'exercise_image_url_snapshot'
                   )
                 ORDER BY TABLE_NAME, COLUMN_NAME`,
                [database]
            );
            assert.equal(
                historyColumns.length,
                12,
                "includes the personal-schema snapshot columns plus studio_training_program_exercises.exercise_name_snapshot " +
                "and studio_workout_session_exercises.exercise_name_snapshot, which both reuse the same snapshot naming pattern"
            );

            const [ledgerSnapshot] = await pool.promise().query(
                `SELECT migration_id, checksum, status, started_at, applied_at
                 FROM schema_migrations
                 ORDER BY migration_id`
            );
            assert.equal(ledgerSnapshot.length, 8);
            assert.ok(ledgerSnapshot.every((row) => row.status === "applied"));

            const secondRun = await runner.migrate();
            assert.deepEqual(secondRun.applied, []);

            const [ledgerAfter] = await pool.promise().query(
                `SELECT migration_id, checksum, status, started_at, applied_at
                 FROM schema_migrations
                 ORDER BY migration_id`
            );
            assert.deepEqual(ledgerAfter, ledgerSnapshot);
        } finally {
            await db.closePool(pool);
        }
    }
);

test(
    "unversionierte Bestandsdaten werden additiv migriert und unverändert verknüpft",
    { skip: !RUN_INTEGRATION },
    async () => {
        const database = await createDisposableDatabase();
        const pool = createTestPool(database);
        const sql = pool.promise();

        try {
            await sql.query(`
                CREATE TABLE users (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    username VARCHAR(50) NOT NULL UNIQUE,
                    email VARCHAR(120) NOT NULL UNIQUE,
                    password_hash VARCHAR(255) NOT NULL,
                    language_preference ENUM('de','en') NOT NULL DEFAULT 'de',
                    weight_unit ENUM('kg','lb') NOT NULL DEFAULT 'kg',
                    distance_unit ENUM('km','mi') NOT NULL DEFAULT 'km',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);
            await sql.query(`
                CREATE TABLE exercises (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NULL,
                    name VARCHAR(80) NOT NULL,
                    description VARCHAR(255) NULL,
                    category VARCHAR(50) NOT NULL,
                    muscle_group VARCHAR(50) NOT NULL,
                    image_url VARCHAR(500) NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);
            await sql.query(`
                CREATE TABLE workouts (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL,
                    title VARCHAR(100) NOT NULL,
                    workout_date DATE NOT NULL,
                    notes VARCHAR(255) NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);
            await sql.query(`
                CREATE TABLE workout_exercises (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    workout_id INT NOT NULL,
                    exercise_id INT NOT NULL,
                    sets INT NULL,
                    reps INT NULL,
                    weight DECIMAL(6,2) NULL,
                    duration_minutes INT NULL,
                    distance_km DECIMAL(7,2) NULL,
                    intensity_level INT NULL
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);
            await sql.query(`
                CREATE TABLE progress_entries (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL,
                    workout_id INT NULL,
                    exercise_id INT NOT NULL,
                    weight DECIMAL(6,2) NULL,
                    reps INT NULL,
                    sets INT NULL,
                    duration_minutes INT NULL,
                    distance_km DECIMAL(7,2) NULL,
                    intensity_level INT NULL,
                    entry_date DATE NOT NULL
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            `);

            const [userResult] = await sql.query(
                `INSERT INTO users (username, email, password_hash)
                 VALUES ('legacy-user', 'legacy@example.test', 'hash')`
            );
            const [exerciseResult] = await sql.query(
                `INSERT INTO exercises (user_id, name, description, category, muscle_group)
                 VALUES (?, 'Legacy Lift', 'Keep me', 'Brust', 'Brustmitte')`,
                [userResult.insertId]
            );
            const [workoutResult] = await sql.query(
                `INSERT INTO workouts (user_id, title, workout_date, notes)
                 VALUES (?, 'Legacy Workout', '2026-01-15', 'unchanged')`,
                [userResult.insertId]
            );
            const [workoutExerciseResult] = await sql.query(
                `INSERT INTO workout_exercises (
                    workout_id, exercise_id, sets, reps, weight
                 ) VALUES (?, ?, 3, 8, 50.00)`,
                [workoutResult.insertId, exerciseResult.insertId]
            );
            const [progressResult] = await sql.query(
                `INSERT INTO progress_entries (
                    user_id, workout_id, exercise_id, sets, reps, weight, entry_date
                 ) VALUES (?, ?, ?, 3, 8, 50.00, '2026-01-15')`,
                [userResult.insertId, workoutResult.insertId, exerciseResult.insertId]
            );

            const migrations = loadMigrations();
            const stage0Runner = createMigrationRunner({
                pool,
                migrations: migrations.slice(0, 4),
                logger: silentLogger()
            });
            const stage0Result = await stage0Runner.migrate();
            assert.deepEqual(stage0Result.applied, [
                "001_initial_schema",
                "002_legacy_schema_upgrade",
                "003_seed_global_exercises",
                "004_training_history_consistency"
            ]);

            const [users] = await sql.query(
                "SELECT username, email FROM users WHERE id = ?",
                [userResult.insertId]
            );
            assert.deepEqual(users, [
                { username: "legacy-user", email: "legacy@example.test" }
            ]);

            const [workouts] = await sql.query(
                "SELECT title, notes FROM workouts WHERE id = ?",
                [workoutResult.insertId]
            );
            assert.deepEqual(workouts, [
                { title: "Legacy Workout", notes: "unchanged" }
            ]);

            const [progress] = await sql.query(
                `SELECT
                    id,
                    source_type,
                    workout_exercise_id,
                    exercise_name_snapshot,
                    exercise_category_snapshot,
                    exercise_muscle_group_snapshot
                 FROM progress_entries
                 WHERE id = ?`,
                [progressResult.insertId]
            );
            assert.equal(progress.length, 1);
            assert.equal(progress[0].source_type, "workout");
            assert.equal(progress[0].workout_exercise_id, workoutExerciseResult.insertId);
            assert.equal(progress[0].exercise_name_snapshot, "Legacy Lift");
            assert.equal(progress[0].exercise_category_snapshot, "Brust");
            assert.equal(progress[0].exercise_muscle_group_snapshot, "Brustmitte");

            const beforeStudioMigration = await personalDataSnapshot(sql);
            const stage1Runner = createMigrationRunner({
                pool,
                migrations,
                logger: silentLogger()
            });
            const stage1Result = await stage1Runner.migrate();
            assert.deepEqual(stage1Result.applied, [
                "005_studio_tenancy_and_rbac",
                "006_coach_member_training",
                "007_studio_workout_execution",
                "008_studio_workout_session_feedback"
            ]);
            const afterStudioMigration = await personalDataSnapshot(sql);
            assert.deepEqual(
                afterStudioMigration,
                beforeStudioMigration,
                "studio and training schema migrations must not alter personal rows or links"
            );

            const secondRun = await stage1Runner.migrate();
            assert.deepEqual(secondRun.applied, []);
        } finally {
            await db.closePool(pool);
        }
    }
);

test(
    "Studio-Schema erzwingt Unique-, FK-, Check- und Löschregeln",
    { skip: !RUN_INTEGRATION },
    async () => {
        const database = await createDisposableDatabase();
        const pool = createTestPool(database);
        const sql = pool.promise();

        try {
            const runner = createMigrationRunner({ pool, logger: silentLogger() });
            await runner.migrate();

            async function createUser(username) {
                const [result] = await sql.query(
                    `INSERT INTO users (username, email, password_hash)
                     VALUES (?, ?, 'test-hash')`,
                    [username, `${username}@example.test`]
                );
                return result.insertId;
            }

            const creatorId = await createUser("studio-creator");
            const memberId = await createUser("studio-member");
            const actorId = await createUser("studio-actor");
            const studioPublicId = "10000000-0000-4000-8000-000000000001";
            const [studioResult] = await sql.query(
                `INSERT INTO studios (
                    public_id, name, slug, status, default_locale,
                    default_timezone, default_weight_unit, created_by_user_id
                 ) VALUES (?, 'Stage 1A Studio', 'stage-1a-studio', 'active',
                           'de', 'Europe/Zurich', 'kg', ?)`,
                [studioPublicId, creatorId]
            );
            const studioId = studioResult.insertId;

            const [membershipResult] = await sql.query(
                `INSERT INTO studio_memberships (
                    public_id, studio_id, user_id, role, status,
                    invited_by_user_id, joined_at
                 ) VALUES (
                    '20000000-0000-4000-8000-000000000001', ?, ?,
                    'owner', 'active', ?, CURRENT_TIMESTAMP(3)
                 )`,
                [studioId, creatorId, actorId]
            );
            const tokenHash = Buffer.alloc(32, 1);
            const [invitationResult] = await sql.query(
                `INSERT INTO studio_invitations (
                    public_id, studio_id, email_normalized, role, token_hash,
                    status, expires_at, invited_by_user_id,
                    accepted_by_user_id, accepted_at
                 ) VALUES (
                    '30000000-0000-4000-8000-000000000001', ?,
                    'invitee@example.test', 'trainer', ?, 'accepted',
                    DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 7 DAY), ?, ?,
                    CURRENT_TIMESTAMP(3)
                 )`,
                [studioId, tokenHash, actorId, actorId]
            );
            const [auditResult] = await sql.query(
                `INSERT INTO studio_audit_events (
                    public_id, studio_id, actor_user_id, event_type,
                    target_type, target_public_id, details_json
                 ) VALUES (
                    '40000000-0000-4000-8000-000000000001', ?, ?,
                    'studio.created', 'studio', ?, JSON_OBJECT('source', 'migration-test')
                 )`,
                [studioId, actorId, studioPublicId]
            );

            await expectMysqlError(
                sql.query(
                    `INSERT INTO studios (public_id, name, slug, created_by_user_id)
                     VALUES (?, 'Duplicate public id', 'duplicate-public-id', ?)`,
                    [studioPublicId, creatorId]
                ),
                "ER_DUP_ENTRY"
            );
            await expectMysqlError(
                sql.query(
                    `INSERT INTO studios (public_id, name, slug, created_by_user_id)
                     VALUES ('10000000-0000-4000-8000-000000000002',
                             'Duplicate slug', 'stage-1a-studio', ?)`,
                    [creatorId]
                ),
                "ER_DUP_ENTRY"
            );
            await expectMysqlError(
                sql.query(
                    `INSERT INTO studios (
                        public_id, name, slug, status, created_by_user_id
                     ) VALUES (
                        '10000000-0000-4000-8000-000000000003',
                        'Invalid status', 'invalid-status', 'deleted', ?
                     )`,
                    [creatorId]
                ),
                "ER_CHECK_CONSTRAINT_VIOLATED"
            );
            await expectMysqlError(
                sql.query(
                    `INSERT INTO studios (
                        public_id, name, slug, default_weight_unit, created_by_user_id
                     ) VALUES (
                        '10000000-0000-4000-8000-000000000004',
                        'Invalid unit', 'invalid-unit', 'oz', ?
                     )`,
                    [creatorId]
                ),
                "ER_CHECK_CONSTRAINT_VIOLATED"
            );
            await expectMysqlError(
                sql.query(
                    `INSERT INTO studios (public_id, name, slug, created_by_user_id)
                     VALUES ('10000000-0000-4000-8000-000000000005',
                             'Orphan studio', 'orphan-studio', 2147483647)`
                ),
                "ER_NO_REFERENCED_ROW_2"
            );

            await expectMysqlError(
                sql.query(
                    `INSERT INTO studio_memberships (
                        public_id, studio_id, user_id, role, status
                     ) VALUES (
                        '20000000-0000-4000-8000-000000000002',
                        ?, ?, 'owner', 'active'
                     )`,
                    [studioId, creatorId]
                ),
                "ER_DUP_ENTRY"
            );
            await expectMysqlError(
                sql.query(
                    `INSERT INTO studio_memberships (
                        public_id, studio_id, user_id, role, status
                     ) VALUES (
                        '20000000-0000-4000-8000-000000000003',
                        ?, ?, 'viewer', 'active'
                     )`,
                    [studioId, memberId]
                ),
                "ER_CHECK_CONSTRAINT_VIOLATED"
            );
            await expectMysqlError(
                sql.query(
                    `INSERT INTO studio_memberships (
                        public_id, studio_id, user_id, role, status
                     ) VALUES (
                        '20000000-0000-4000-8000-000000000004',
                        ?, ?, 'member', 'deleted'
                     )`,
                    [studioId, memberId]
                ),
                "ER_CHECK_CONSTRAINT_VIOLATED"
            );
            await expectMysqlError(
                sql.query(
                    `INSERT INTO studio_memberships (
                        public_id, studio_id, user_id, role, status
                     ) VALUES (
                        '20000000-0000-4000-8000-000000000005',
                        2147483647, ?, 'member', 'active'
                     )`,
                    [memberId]
                ),
                "ER_NO_REFERENCED_ROW_2"
            );

            await expectMysqlError(
                sql.query(
                    `INSERT INTO studio_invitations (
                        public_id, studio_id, email_normalized, role,
                        token_hash, status, expires_at
                     ) VALUES (
                        '30000000-0000-4000-8000-000000000002', ?,
                        'duplicate-token@example.test', 'member', ?, 'pending',
                        DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 7 DAY)
                     )`,
                    [studioId, tokenHash]
                ),
                "ER_DUP_ENTRY"
            );
            await expectMysqlError(
                sql.query(
                    `INSERT INTO studio_invitations (
                        public_id, studio_id, email_normalized, role,
                        token_hash, status, expires_at
                     ) VALUES (
                        '30000000-0000-4000-8000-000000000003', ?,
                        'invalid-role@example.test', 'owner', ?, 'pending',
                        DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 7 DAY)
                     )`,
                    [studioId, Buffer.alloc(32, 2)]
                ),
                "ER_CHECK_CONSTRAINT_VIOLATED"
            );
            await expectMysqlError(
                sql.query(
                    `INSERT INTO studio_invitations (
                        public_id, studio_id, email_normalized, role,
                        token_hash, status, expires_at
                     ) VALUES (
                        '30000000-0000-4000-8000-000000000004', ?,
                        'invalid-status@example.test', 'member', ?, 'deleted',
                        DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 7 DAY)
                     )`,
                    [studioId, Buffer.alloc(32, 3)]
                ),
                "ER_CHECK_CONSTRAINT_VIOLATED"
            );
            await expectMysqlError(
                sql.query(
                    `INSERT INTO studio_audit_events (
                        public_id, studio_id, actor_user_id, event_type
                     ) VALUES (
                        '40000000-0000-4000-8000-000000000002', ?,
                        2147483647, 'invalid.actor'
                     )`,
                    [studioId]
                ),
                "ER_NO_REFERENCED_ROW_2"
            );

            await expectMysqlError(
                sql.query("DELETE FROM users WHERE id = ?", [creatorId]),
                "ER_ROW_IS_REFERENCED_2"
            );

            await sql.query("DELETE FROM users WHERE id = ?", [actorId]);
            const [membershipAfterActorDelete] = await sql.query(
                `SELECT invited_by_user_id
                 FROM studio_memberships WHERE id = ?`,
                [membershipResult.insertId]
            );
            const [invitationAfterActorDelete] = await sql.query(
                `SELECT invited_by_user_id, accepted_by_user_id
                 FROM studio_invitations WHERE id = ?`,
                [invitationResult.insertId]
            );
            const [auditAfterActorDelete] = await sql.query(
                "SELECT actor_user_id FROM studio_audit_events WHERE id = ?",
                [auditResult.insertId]
            );
            assert.equal(membershipAfterActorDelete[0].invited_by_user_id, null);
            assert.equal(invitationAfterActorDelete[0].invited_by_user_id, null);
            assert.equal(invitationAfterActorDelete[0].accepted_by_user_id, null);
            assert.equal(auditAfterActorDelete[0].actor_user_id, null);

            await sql.query("DELETE FROM studios WHERE id = ?", [studioId]);
            const [childCounts] = await sql.query(`
                SELECT
                    (SELECT COUNT(*) FROM studio_memberships) AS memberships,
                    (SELECT COUNT(*) FROM studio_invitations) AS invitations,
                    (SELECT COUNT(*) FROM studio_audit_events) AS audit_events
            `);
            assert.deepEqual(
                Object.fromEntries(
                    Object.entries(childCounts[0]).map(([name, value]) => [name, Number(value)])
                ),
                { memberships: 0, invitations: 0, audit_events: 0 }
            );
        } finally {
            await db.closePool(pool);
        }
    }
);

test(
    "Coaching- und Trainingsprogramm-Schema erzwingt Unique-, FK-, Check- und Löschregeln",
    { skip: !RUN_INTEGRATION },
    async () => {
        const database = await createDisposableDatabase();
        const pool = createTestPool(database);
        const sql = pool.promise();

        try {
            const runner = createMigrationRunner({ pool, logger: silentLogger() });
            await runner.migrate();

            async function createUser(username) {
                const [result] = await sql.query(
                    `INSERT INTO users (username, email, password_hash)
                     VALUES (?, ?, 'test-hash')`,
                    [username, `${username}@example.test`]
                );
                return result.insertId;
            }

            const ownerId = await createUser("training-owner");
            const coachId = await createUser("training-coach");
            const memberId = await createUser("training-member");

            const [studioResult] = await sql.query(
                `INSERT INTO studios (public_id, name, slug, created_by_user_id)
                 VALUES ('11000000-0000-4000-8000-000000000001',
                         'Training Studio', 'training-studio', ?)`,
                [ownerId]
            );
            const studioId = studioResult.insertId;

            async function createMembership(publicId, userId, role) {
                const [result] = await sql.query(
                    `INSERT INTO studio_memberships (
                        public_id, studio_id, user_id, role, status, joined_at
                     ) VALUES (?, ?, ?, ?, 'active', CURRENT_TIMESTAMP(3))`,
                    [publicId, studioId, userId, role]
                );
                return result.insertId;
            }

            const coachMembershipId = await createMembership(
                "12000000-0000-4000-8000-000000000001", coachId, "trainer"
            );
            const memberMembershipId = await createMembership(
                "12000000-0000-4000-8000-000000000002", memberId, "member"
            );

            // --- coaching relationships: uniqueness, distinctness, FKs ---
            const [relationshipResult] = await sql.query(
                `INSERT INTO studio_coaching_relationships (
                    public_id, studio_id, coach_membership_id, member_membership_id,
                    created_by_user_id
                 ) VALUES ('13000000-0000-4000-8000-000000000001', ?, ?, ?, ?)`,
                [studioId, coachMembershipId, memberMembershipId, ownerId]
            );
            const relationshipId = relationshipResult.insertId;

            await expectMysqlError(
                sql.query(
                    `INSERT INTO studio_coaching_relationships (
                        public_id, studio_id, coach_membership_id, member_membership_id,
                        created_by_user_id
                     ) VALUES ('13000000-0000-4000-8000-000000000002', ?, ?, ?, ?)`,
                    [studioId, coachMembershipId, memberMembershipId, ownerId]
                ),
                "ER_DUP_ENTRY"
            );
            await expectMysqlError(
                sql.query(
                    `INSERT INTO studio_coaching_relationships (
                        public_id, studio_id, coach_membership_id, member_membership_id,
                        created_by_user_id
                     ) VALUES ('13000000-0000-4000-8000-000000000003', ?, ?, ?, ?)`,
                    [studioId, coachMembershipId, coachMembershipId, ownerId]
                ),
                "ER_CHECK_CONSTRAINT_VIOLATED"
            );
            await expectMysqlError(
                sql.query(
                    `INSERT INTO studio_coaching_relationships (
                        public_id, studio_id, coach_membership_id, member_membership_id,
                        status, created_by_user_id
                     ) VALUES ('13000000-0000-4000-8000-000000000004', ?, ?, ?, 'pending', ?)`,
                    [studioId, coachMembershipId, memberMembershipId, ownerId]
                ),
                "ER_CHECK_CONSTRAINT_VIOLATED"
            );
            await expectMysqlError(
                sql.query(
                    `INSERT INTO studio_coaching_relationships (
                        public_id, studio_id, coach_membership_id, member_membership_id,
                        created_by_user_id
                     ) VALUES ('13000000-0000-4000-8000-000000000005', 2147483647, ?, ?, ?)`,
                    [memberMembershipId, coachMembershipId, ownerId]
                ),
                "ER_NO_REFERENCED_ROW_2"
            );

            // ending the relationship must free the (coach, member) pair for a fresh one
            await sql.query(
                `UPDATE studio_coaching_relationships
                 SET status = 'ended', ended_at = CURRENT_TIMESTAMP(3)
                 WHERE id = ?`,
                [relationshipId]
            );
            const [reRelationshipResult] = await sql.query(
                `INSERT INTO studio_coaching_relationships (
                    public_id, studio_id, coach_membership_id, member_membership_id,
                    created_by_user_id
                 ) VALUES ('13000000-0000-4000-8000-000000000006', ?, ?, ?, ?)`,
                [studioId, coachMembershipId, memberMembershipId, ownerId]
            );
            const activeRelationshipId = reRelationshipResult.insertId;
            const [pairRows] = await sql.query(
                `SELECT status, active_pair_marker
                 FROM studio_coaching_relationships
                 WHERE coach_membership_id = ? AND member_membership_id = ?
                 ORDER BY id`,
                [coachMembershipId, memberMembershipId]
            );
            assert.deepEqual(pairRows, [
                { status: "ended", active_pair_marker: null },
                { status: "active", active_pair_marker: 1 }
            ]);

            // --- training programs ---
            const [programResult] = await sql.query(
                `INSERT INTO studio_training_programs (
                    public_id, studio_id, name, created_by_user_id
                 ) VALUES ('14000000-0000-4000-8000-000000000001', ?, 'Beginner Strength', ?)`,
                [studioId, coachId]
            );
            const programId = programResult.insertId;

            await expectMysqlError(
                sql.query(
                    `INSERT INTO studio_training_programs (
                        public_id, studio_id, name, status, created_by_user_id
                     ) VALUES ('14000000-0000-4000-8000-000000000002', ?, 'Invalid', 'live', ?)`,
                    [studioId, coachId]
                ),
                "ER_CHECK_CONSTRAINT_VIOLATED"
            );
            await expectMysqlError(
                sql.query(
                    `INSERT INTO studio_training_programs (
                        public_id, studio_id, name, created_by_user_id
                     ) VALUES ('14000000-0000-4000-8000-000000000003', 2147483647, 'Orphan', ?)`,
                    [coachId]
                ),
                "ER_NO_REFERENCED_ROW_2"
            );

            // --- program versions: uniqueness, positivity, status ---
            const [versionResult] = await sql.query(
                `INSERT INTO studio_training_program_versions (
                    public_id, program_id, version_number, created_by_user_id
                 ) VALUES ('15000000-0000-4000-8000-000000000001', ?, 1, ?)`,
                [programId, coachId]
            );
            const versionId = versionResult.insertId;

            await expectMysqlError(
                sql.query(
                    `INSERT INTO studio_training_program_versions (
                        public_id, program_id, version_number, created_by_user_id
                     ) VALUES ('15000000-0000-4000-8000-000000000002', ?, 1, ?)`,
                    [programId, coachId]
                ),
                "ER_DUP_ENTRY"
            );
            await expectMysqlError(
                sql.query(
                    `INSERT INTO studio_training_program_versions (
                        public_id, program_id, version_number, created_by_user_id
                     ) VALUES ('15000000-0000-4000-8000-000000000003', ?, 0, ?)`,
                    [programId, coachId]
                ),
                "ER_CHECK_CONSTRAINT_VIOLATED"
            );
            await expectMysqlError(
                sql.query(
                    `INSERT INTO studio_training_program_versions (
                        public_id, program_id, version_number, status, created_by_user_id
                     ) VALUES ('15000000-0000-4000-8000-000000000004', ?, 2, 'live', ?)`,
                    [programId, coachId]
                ),
                "ER_CHECK_CONSTRAINT_VIOLATED"
            );

            // --- program days: uniqueness and positivity ---
            const [dayResult] = await sql.query(
                `INSERT INTO studio_training_program_days (
                    public_id, program_version_id, position, name
                 ) VALUES ('16000000-0000-4000-8000-000000000001', ?, 1, 'Day 1')`,
                [versionId]
            );
            const dayId = dayResult.insertId;

            await expectMysqlError(
                sql.query(
                    `INSERT INTO studio_training_program_days (
                        public_id, program_version_id, position, name
                     ) VALUES ('16000000-0000-4000-8000-000000000002', ?, 1, 'Duplicate position')`,
                    [versionId]
                ),
                "ER_DUP_ENTRY"
            );
            await expectMysqlError(
                sql.query(
                    `INSERT INTO studio_training_program_days (
                        public_id, program_version_id, position, name
                     ) VALUES ('16000000-0000-4000-8000-000000000003', ?, 0, 'Zero position')`,
                    [versionId]
                ),
                "ER_CHECK_CONSTRAINT_VIOLATED"
            );

            // --- program exercises: uniqueness and metric range checks ---
            await sql.query(
                `INSERT INTO studio_training_program_exercises (
                    public_id, program_day_id, position, exercise_name_snapshot,
                    target_sets, target_reps_min, target_reps_max, target_rpe, rest_seconds
                 ) VALUES (
                    '17000000-0000-4000-8000-000000000001', ?, 1, 'Bench Press',
                    4, 6, 10, 8.5, 90
                 )`,
                [dayId]
            );
            await expectMysqlError(
                sql.query(
                    `INSERT INTO studio_training_program_exercises (
                        public_id, program_day_id, position, exercise_name_snapshot
                     ) VALUES ('17000000-0000-4000-8000-000000000002', ?, 1, 'Duplicate position')`,
                    [dayId]
                ),
                "ER_DUP_ENTRY"
            );
            await expectMysqlError(
                sql.query(
                    `INSERT INTO studio_training_program_exercises (
                        public_id, program_day_id, position, exercise_name_snapshot, target_sets
                     ) VALUES ('17000000-0000-4000-8000-000000000003', ?, 2, 'Too many sets', 25)`,
                    [dayId]
                ),
                "ER_CHECK_CONSTRAINT_VIOLATED"
            );
            await expectMysqlError(
                sql.query(
                    `INSERT INTO studio_training_program_exercises (
                        public_id, program_day_id, position, exercise_name_snapshot,
                        target_reps_min, target_reps_max
                     ) VALUES ('17000000-0000-4000-8000-000000000004', ?, 3, 'Inverted reps range', 12, 8)`,
                    [dayId]
                ),
                "ER_CHECK_CONSTRAINT_VIOLATED"
            );
            await expectMysqlError(
                sql.query(
                    `INSERT INTO studio_training_program_exercises (
                        public_id, program_day_id, position, exercise_name_snapshot, target_rpe
                     ) VALUES ('17000000-0000-4000-8000-000000000005', ?, 4, 'RPE too high', 12.0)`,
                    [dayId]
                ),
                "ER_CHECK_CONSTRAINT_VIOLATED"
            );
            await expectMysqlError(
                sql.query(
                    `INSERT INTO studio_training_program_exercises (
                        public_id, program_day_id, position, exercise_name_snapshot, target_weight
                     ) VALUES ('17000000-0000-4000-8000-000000000006', ?, 5, 'Negative weight', -1)`,
                    [dayId]
                ),
                "ER_CHECK_CONSTRAINT_VIOLATED"
            );

            // --- publish the version, then assign it ---
            await sql.query(
                `UPDATE studio_training_program_versions
                 SET status = 'published', published_at = CURRENT_TIMESTAMP(3)
                 WHERE id = ?`,
                [versionId]
            );
            const [assignmentResult] = await sql.query(
                `INSERT INTO studio_program_assignments (
                    public_id, studio_id, program_version_id, member_membership_id,
                    assigned_by_user_id, coaching_relationship_id, starts_on, ends_on
                 ) VALUES (
                    '18000000-0000-4000-8000-000000000001', ?, ?, ?, ?, ?,
                    '2026-01-01', '2026-02-01'
                 )`,
                [studioId, versionId, memberMembershipId, coachId, activeRelationshipId]
            );
            const assignmentId = assignmentResult.insertId;

            await expectMysqlError(
                sql.query(
                    `INSERT INTO studio_program_assignments (
                        public_id, studio_id, program_version_id, member_membership_id,
                        assigned_by_user_id, coaching_relationship_id, starts_on, ends_on
                     ) VALUES (
                        '18000000-0000-4000-8000-000000000002', ?, ?, ?, ?, ?,
                        '2026-02-01', '2026-01-01'
                     )`,
                    [studioId, versionId, memberMembershipId, coachId, activeRelationshipId]
                ),
                "ER_CHECK_CONSTRAINT_VIOLATED"
            );
            await expectMysqlError(
                sql.query(
                    `INSERT INTO studio_program_assignments (
                        public_id, studio_id, program_version_id, member_membership_id,
                        assigned_by_user_id, coaching_relationship_id, status
                     ) VALUES (
                        '18000000-0000-4000-8000-000000000003', ?, ?, ?, ?, ?, 'paused'
                     )`,
                    [studioId, versionId, memberMembershipId, coachId, activeRelationshipId]
                ),
                "ER_CHECK_CONSTRAINT_VIOLATED"
            );
            await expectMysqlError(
                sql.query(
                    `INSERT INTO studio_program_assignments (
                        public_id, studio_id, program_version_id, member_membership_id,
                        assigned_by_user_id, coaching_relationship_id
                     ) VALUES (
                        '18000000-0000-4000-8000-000000000004', ?, 2147483647, ?, ?, ?
                     )`,
                    [studioId, memberMembershipId, coachId, activeRelationshipId]
                ),
                "ER_NO_REFERENCED_ROW_2"
            );

            // a day cannot be removed from under a version without cascading its exercises,
            // and deleting it must not orphan any exercise row
            await sql.query("DELETE FROM studio_training_program_days WHERE id = ?", [dayId]);
            const [orphanExercises] = await sql.query(
                "SELECT COUNT(*) AS total FROM studio_training_program_exercises WHERE program_day_id = ?",
                [dayId]
            );
            assert.equal(Number(orphanExercises[0].total), 0);

            // deleting a whole studio must cascade through every Stage 1B.1 table with zero orphans,
            // exactly like the existing Stage 1A studio cascade guarantee
            await sql.query("DELETE FROM studios WHERE id = ?", [studioId]);
            const [trainingCounts] = await sql.query(`
                SELECT
                    (SELECT COUNT(*) FROM studio_coaching_relationships) AS relationships,
                    (SELECT COUNT(*) FROM studio_training_programs) AS programs,
                    (SELECT COUNT(*) FROM studio_training_program_versions) AS versions,
                    (SELECT COUNT(*) FROM studio_training_program_days) AS days,
                    (SELECT COUNT(*) FROM studio_training_program_exercises) AS exercises,
                    (SELECT COUNT(*) FROM studio_program_assignments) AS assignments
            `);
            assert.deepEqual(
                Object.fromEntries(
                    Object.entries(trainingCounts[0]).map(([name, value]) => [name, Number(value)])
                ),
                {
                    relationships: 0,
                    programs: 0,
                    versions: 0,
                    days: 0,
                    exercises: 0,
                    assignments: 0
                }
            );
            assert.ok(assignmentId > 0, "sanity check that the assignment insert above actually ran");
        } finally {
            await db.closePool(pool);
        }
    }
);

test(
    "Workout-Ausführungs-Schema erzwingt Unique-, FK-, Check- und Löschregeln",
    { skip: !RUN_INTEGRATION },
    async () => {
        const database = await createDisposableDatabase();
        const pool = createTestPool(database);
        const sql = pool.promise();

        try {
            const runner = createMigrationRunner({ pool, logger: silentLogger() });
            await runner.migrate();

            async function createUser(username) {
                const [result] = await sql.query(
                    `INSERT INTO users (username, email, password_hash)
                     VALUES (?, ?, 'test-hash')`,
                    [username, `${username}@example.test`]
                );
                return result.insertId;
            }

            const ownerId = await createUser("workout-owner");
            const coachId = await createUser("workout-coach");
            const memberId = await createUser("workout-member");

            const [studioResult] = await sql.query(
                `INSERT INTO studios (public_id, name, slug, created_by_user_id)
                 VALUES ('19000000-0000-4000-8000-000000000001',
                         'Workout Studio', 'workout-studio', ?)`,
                [ownerId]
            );
            const studioId = studioResult.insertId;

            async function createMembership(publicId, userId, role) {
                const [result] = await sql.query(
                    `INSERT INTO studio_memberships (
                        public_id, studio_id, user_id, role, status, joined_at
                     ) VALUES (?, ?, ?, ?, 'active', CURRENT_TIMESTAMP(3))`,
                    [publicId, studioId, userId, role]
                );
                return result.insertId;
            }

            const coachMembershipId = await createMembership(
                "19100000-0000-4000-8000-000000000001", coachId, "trainer"
            );
            const memberMembershipId = await createMembership(
                "19100000-0000-4000-8000-000000000002", memberId, "member"
            );

            const [relationshipResult] = await sql.query(
                `INSERT INTO studio_coaching_relationships (
                    public_id, studio_id, coach_membership_id, member_membership_id,
                    created_by_user_id
                 ) VALUES ('19200000-0000-4000-8000-000000000001', ?, ?, ?, ?)`,
                [studioId, coachMembershipId, memberMembershipId, ownerId]
            );
            const relationshipId = relationshipResult.insertId;

            const [programResult] = await sql.query(
                `INSERT INTO studio_training_programs (
                    public_id, studio_id, name, created_by_user_id
                 ) VALUES ('19300000-0000-4000-8000-000000000001', ?, 'Workout Program', ?)`,
                [studioId, coachId]
            );
            const [versionResult] = await sql.query(
                `INSERT INTO studio_training_program_versions (
                    public_id, program_id, version_number, status, published_at, created_by_user_id
                 ) VALUES ('19400000-0000-4000-8000-000000000001', ?, 1, 'published', CURRENT_TIMESTAMP(3), ?)`,
                [programResult.insertId, coachId]
            );
            const versionId = versionResult.insertId;
            const [dayResult] = await sql.query(
                `INSERT INTO studio_training_program_days (
                    public_id, program_version_id, position, name
                 ) VALUES ('19500000-0000-4000-8000-000000000001', ?, 1, 'Day 1')`,
                [versionId]
            );
            const dayId = dayResult.insertId;
            const [programExerciseResult] = await sql.query(
                `INSERT INTO studio_training_program_exercises (
                    public_id, program_day_id, position, exercise_name_snapshot, target_sets
                 ) VALUES ('19600000-0000-4000-8000-000000000001', ?, 1, 'Bench Press', 4)`,
                [dayId]
            );
            const programExerciseId = programExerciseResult.insertId;

            const [assignmentResult] = await sql.query(
                `INSERT INTO studio_program_assignments (
                    public_id, studio_id, program_version_id, member_membership_id,
                    assigned_by_user_id, coaching_relationship_id, starts_on
                 ) VALUES (
                    '19700000-0000-4000-8000-000000000001', ?, ?, ?, ?, ?, '2026-01-01'
                 )`,
                [studioId, versionId, memberMembershipId, coachId, relationshipId]
            );
            const assignmentId = assignmentResult.insertId;

            // --- workout sessions: uniqueness, idempotency key scope, FKs, status/date checks ---
            async function insertSession(publicId, overrides = {}) {
                const [result] = await sql.query(
                    `INSERT INTO studio_workout_sessions (
                        public_id, studio_id, assignment_id, member_membership_id,
                        program_version_id, program_day_id, coaching_relationship_id,
                        status, client_start_key, revision, completed_at, aborted_at
                     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        publicId,
                        overrides.studioId ?? studioId,
                        overrides.assignmentId ?? assignmentId,
                        overrides.memberMembershipId ?? memberMembershipId,
                        overrides.programVersionId ?? versionId,
                        overrides.programDayId ?? dayId,
                        overrides.coachingRelationshipId ?? relationshipId,
                        overrides.status ?? "in_progress",
                        overrides.clientStartKey ?? "device-key-1",
                        overrides.revision ?? 0,
                        overrides.completedAt ?? null,
                        overrides.abortedAt ?? null
                    ]
                );
                return result.insertId;
            }

            const sessionId = await insertSession("19800000-0000-4000-8000-000000000001");

            await expectMysqlError(
                insertSession("19800000-0000-4000-8000-000000000001"),
                "ER_DUP_ENTRY"
            );
            await expectMysqlError(
                insertSession("19800000-0000-4000-8000-000000000002"),
                "ER_DUP_ENTRY",
                "the compound (member, assignment, client_start_key) key must reject a same-assignment retry"
            );
            await expectMysqlError(
                insertSession("19800000-0000-4000-8000-000000000003", { status: "cancelled" }),
                "ER_CHECK_CONSTRAINT_VIOLATED"
            );
            await expectMysqlError(
                insertSession("19800000-0000-4000-8000-000000000004", {
                    clientStartKey: "device-key-2", revision: -1
                }),
                "ER_CHECK_CONSTRAINT_VIOLATED"
            );
            await expectMysqlError(
                insertSession("19800000-0000-4000-8000-000000000005", { clientStartKey: "" }),
                "ER_CHECK_CONSTRAINT_VIOLATED"
            );
            await expectMysqlError(
                insertSession("19800000-0000-4000-8000-000000000006", {
                    status: "completed", clientStartKey: "device-key-3"
                }),
                "ER_CHECK_CONSTRAINT_VIOLATED",
                "status=completed requires completed_at to be set"
            );
            await expectMysqlError(
                insertSession("19800000-0000-4000-8000-000000000007", {
                    clientStartKey: "device-key-4", completedAt: new Date()
                }),
                "ER_CHECK_CONSTRAINT_VIOLATED",
                "status=in_progress forbids completed_at from being set"
            );
            await expectMysqlError(
                insertSession("19800000-0000-4000-8000-000000000008", {
                    status: "aborted", clientStartKey: "device-key-5"
                }),
                "ER_CHECK_CONSTRAINT_VIOLATED",
                "status=aborted requires aborted_at to be set"
            );
            await expectMysqlError(
                insertSession("19800000-0000-4000-8000-000000000009", {
                    studioId: 2147483647, clientStartKey: "device-key-6"
                }),
                "ER_NO_REFERENCED_ROW_2"
            );
            await expectMysqlError(
                insertSession("19800000-0000-4000-8000-000000000010", {
                    coachingRelationshipId: 2147483647, clientStartKey: "device-key-7"
                }),
                "ER_NO_REFERENCED_ROW_2"
            );

            // a different assignment reusing the same key is allowed at the DB layer
            // (the service layer adds the cross-assignment idempotency guard on top)
            const [secondAssignmentResult] = await sql.query(
                `INSERT INTO studio_program_assignments (
                    public_id, studio_id, program_version_id, member_membership_id,
                    assigned_by_user_id, coaching_relationship_id, starts_on
                 ) VALUES (
                    '19700000-0000-4000-8000-000000000002', ?, ?, ?, ?, ?, '2026-01-01'
                 )`,
                [studioId, versionId, memberMembershipId, coachId, relationshipId]
            );
            const secondSessionId = await insertSession("19800000-0000-4000-8000-000000000011", {
                assignmentId: secondAssignmentResult.insertId
            });
            assert.ok(secondSessionId > 0);

            // --- session exercises: uniqueness, ranges, source FK with SET NULL ---
            async function insertSessionExercise(publicId, overrides = {}) {
                const [result] = await sql.query(
                    `INSERT INTO studio_workout_session_exercises (
                        public_id, workout_session_id, source_program_exercise_id, position,
                        exercise_name_snapshot, target_sets, target_reps_min, target_reps_max,
                        target_weight, target_duration_minutes, target_distance_km,
                        target_rpe, rest_seconds, status, revision
                     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        publicId,
                        overrides.workoutSessionId ?? sessionId,
                        overrides.sourceProgramExerciseId === undefined
                            ? programExerciseId : overrides.sourceProgramExerciseId,
                        overrides.position ?? 1,
                        overrides.exerciseNameSnapshot ?? "Bench Press",
                        overrides.targetSets ?? null,
                        overrides.targetRepsMin ?? null,
                        overrides.targetRepsMax ?? null,
                        overrides.targetWeight ?? null,
                        overrides.targetDurationMinutes ?? null,
                        overrides.targetDistanceKm ?? null,
                        overrides.targetRpe ?? null,
                        overrides.restSeconds ?? null,
                        overrides.status ?? "pending",
                        overrides.revision ?? 0
                    ]
                );
                return result.insertId;
            }

            const sessionExerciseId = await insertSessionExercise("1a000000-0000-4000-8000-000000000001");

            await expectMysqlError(
                insertSessionExercise("1a000000-0000-4000-8000-000000000001"),
                "ER_DUP_ENTRY"
            );
            await expectMysqlError(
                insertSessionExercise("1a000000-0000-4000-8000-000000000002"),
                "ER_DUP_ENTRY",
                "duplicate position within the same session must be rejected"
            );
            await expectMysqlError(
                insertSessionExercise("1a000000-0000-4000-8000-000000000003", { position: 0 }),
                "ER_CHECK_CONSTRAINT_VIOLATED"
            );
            await expectMysqlError(
                insertSessionExercise("1a000000-0000-4000-8000-000000000004", { position: 2, targetSets: 25 }),
                "ER_CHECK_CONSTRAINT_VIOLATED"
            );
            await expectMysqlError(
                insertSessionExercise("1a000000-0000-4000-8000-000000000005", {
                    position: 3, targetRepsMin: 12, targetRepsMax: 8
                }),
                "ER_CHECK_CONSTRAINT_VIOLATED",
                "inverted reps range must be rejected exactly like the program-exercise template"
            );
            await expectMysqlError(
                insertSessionExercise("1a000000-0000-4000-8000-000000000006", { position: 4, targetRpe: 12.0 }),
                "ER_CHECK_CONSTRAINT_VIOLATED"
            );
            await expectMysqlError(
                insertSessionExercise("1a000000-0000-4000-8000-000000000007", { position: 5, targetWeight: -1 }),
                "ER_CHECK_CONSTRAINT_VIOLATED"
            );
            await expectMysqlError(
                insertSessionExercise("1a000000-0000-4000-8000-000000000008", {
                    position: 6, workoutSessionId: 2147483647
                }),
                "ER_NO_REFERENCED_ROW_2"
            );

            // deleting the source program exercise must detach the snapshot, not delete it
            await sql.query(
                "DELETE FROM studio_training_program_exercises WHERE id = ?",
                [programExerciseId]
            );
            const [detached] = await sql.query(
                "SELECT source_program_exercise_id FROM studio_workout_session_exercises WHERE id = ?",
                [sessionExerciseId]
            );
            assert.equal(detached[0].source_program_exercise_id, null);

            // --- session sets: uniqueness, ranges, completion consistency, cascade from exercise ---
            async function insertSessionSet(publicId, overrides = {}) {
                const [result] = await sql.query(
                    `INSERT INTO studio_workout_session_sets (
                        public_id, session_exercise_id, position, status,
                        actual_reps, actual_weight, actual_duration_minutes,
                        actual_distance_km, actual_rpe, revision, completed_at
                     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        publicId,
                        overrides.sessionExerciseId ?? sessionExerciseId,
                        overrides.position ?? 1,
                        overrides.status ?? "pending",
                        overrides.actualReps ?? null,
                        overrides.actualWeight ?? null,
                        overrides.actualDurationMinutes ?? null,
                        overrides.actualDistanceKm ?? null,
                        overrides.actualRpe ?? null,
                        overrides.revision ?? 0,
                        overrides.completedAt ?? null
                    ]
                );
                return result.insertId;
            }

            const sessionSetId = await insertSessionSet("1b000000-0000-4000-8000-000000000001");

            await expectMysqlError(
                insertSessionSet("1b000000-0000-4000-8000-000000000001"),
                "ER_DUP_ENTRY"
            );
            await expectMysqlError(
                insertSessionSet("1b000000-0000-4000-8000-000000000002"),
                "ER_DUP_ENTRY",
                "duplicate position within the same session exercise must be rejected"
            );
            await expectMysqlError(
                insertSessionSet("1b000000-0000-4000-8000-000000000003", { position: 0 }),
                "ER_CHECK_CONSTRAINT_VIOLATED"
            );
            await expectMysqlError(
                insertSessionSet("1b000000-0000-4000-8000-000000000004", { position: 2, actualReps: 101 }),
                "ER_CHECK_CONSTRAINT_VIOLATED"
            );
            await expectMysqlError(
                insertSessionSet("1b000000-0000-4000-8000-000000000005", { position: 3, actualWeight: -1 }),
                "ER_CHECK_CONSTRAINT_VIOLATED"
            );
            await expectMysqlError(
                insertSessionSet("1b000000-0000-4000-8000-000000000006", { position: 4, actualRpe: 10.5 }),
                "ER_CHECK_CONSTRAINT_VIOLATED"
            );
            await expectMysqlError(
                insertSessionSet("1b000000-0000-4000-8000-000000000007", {
                    position: 5, status: "completed"
                }),
                "ER_CHECK_CONSTRAINT_VIOLATED",
                "status=completed requires completed_at to be set"
            );
            await expectMysqlError(
                insertSessionSet("1b000000-0000-4000-8000-000000000008", {
                    position: 6, completedAt: new Date()
                }),
                "ER_CHECK_CONSTRAINT_VIOLATED",
                "status=pending forbids completed_at from being set"
            );
            await expectMysqlError(
                insertSessionSet("1b000000-0000-4000-8000-000000000009", {
                    position: 7, sessionExerciseId: 2147483647
                }),
                "ER_NO_REFERENCED_ROW_2"
            );

            // deleting the session exercise must cascade its sets, never orphan them
            await sql.query(
                "DELETE FROM studio_workout_session_exercises WHERE id = ?",
                [sessionExerciseId]
            );
            const [orphanSets] = await sql.query(
                "SELECT COUNT(*) AS total FROM studio_workout_session_sets WHERE session_exercise_id = ?",
                [sessionExerciseId]
            );
            assert.equal(Number(orphanSets[0].total), 0);
            assert.ok(sessionSetId > 0, "sanity check that the set insert above actually ran");

            // --- session feedback: idempotency uniqueness, FKs, body-not-empty check ---
            async function insertFeedback(publicId, overrides = {}) {
                const [result] = await sql.query(
                    `INSERT INTO studio_workout_session_feedback (
                        public_id, studio_id, workout_session_id, coaching_relationship_id,
                        coach_membership_id, author_user_id, client_feedback_key, body
                     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        publicId,
                        overrides.studioId ?? studioId,
                        overrides.workoutSessionId ?? sessionId,
                        overrides.coachingRelationshipId ?? relationshipId,
                        overrides.coachMembershipId ?? coachMembershipId,
                        overrides.authorUserId ?? coachId,
                        overrides.clientFeedbackKey ?? "29900000-0000-4000-8000-000000000001",
                        overrides.body ?? "Great effort today, keep it up."
                    ]
                );
                return result.insertId;
            }

            const feedbackId = await insertFeedback("29800000-0000-4000-8000-000000000001");
            assert.ok(feedbackId > 0);

            await expectMysqlError(
                insertFeedback("29800000-0000-4000-8000-000000000001"),
                "ER_DUP_ENTRY"
            );
            await expectMysqlError(
                insertFeedback("29800000-0000-4000-8000-000000000002"),
                "ER_DUP_ENTRY",
                "the compound (session, coach, client_feedback_key) key must reject a retry with the same key"
            );

            const secondFeedbackId = await insertFeedback("29800000-0000-4000-8000-000000000003", {
                clientFeedbackKey: "29900000-0000-4000-8000-000000000002",
                body: "Follow-up note after reviewing the session."
            });
            assert.ok(secondFeedbackId > feedbackId, "multiple feedback entries per session must be allowed");

            await expectMysqlError(
                insertFeedback("29800000-0000-4000-8000-000000000004", {
                    clientFeedbackKey: "29900000-0000-4000-8000-000000000003", body: ""
                }),
                "ER_CHECK_CONSTRAINT_VIOLATED",
                "an empty body must be rejected"
            );
            await expectMysqlError(
                insertFeedback("29800000-0000-4000-8000-000000000005", {
                    clientFeedbackKey: "29900000-0000-4000-8000-000000000004",
                    workoutSessionId: 2147483647
                }),
                "ER_NO_REFERENCED_ROW_2"
            );
            await expectMysqlError(
                insertFeedback("29800000-0000-4000-8000-000000000006", {
                    clientFeedbackKey: "29900000-0000-4000-8000-000000000005",
                    authorUserId: 2147483647
                }),
                "ER_NO_REFERENCED_ROW_2"
            );

            // author_user_id uses ON DELETE RESTRICT (matching every other *_user_id FK in this
            // schema): a user who authored feedback can never be hard-deleted out from under it.
            await expectMysqlError(
                sql.query("DELETE FROM users WHERE id = ?", [coachId]),
                "ER_ROW_IS_REFERENCED_2"
            );

            // deleting a whole studio must cascade through the full workout-execution chain,
            // together with the pre-existing Stage 1A/1B.1 tables, with zero orphans anywhere
            await sql.query("DELETE FROM studios WHERE id = ?", [studioId]);
            const [workoutCounts] = await sql.query(`
                SELECT
                    (SELECT COUNT(*) FROM studio_workout_sessions) AS sessions,
                    (SELECT COUNT(*) FROM studio_workout_session_exercises) AS session_exercises,
                    (SELECT COUNT(*) FROM studio_workout_session_sets) AS session_sets,
                    (SELECT COUNT(*) FROM studio_workout_session_feedback) AS session_feedback,
                    (SELECT COUNT(*) FROM studio_coaching_relationships) AS relationships,
                    (SELECT COUNT(*) FROM studio_program_assignments) AS assignments
            `);
            assert.deepEqual(
                Object.fromEntries(
                    Object.entries(workoutCounts[0]).map(([name, value]) => [name, Number(value)])
                ),
                {
                    sessions: 0,
                    session_exercises: 0,
                    session_sets: 0,
                    session_feedback: 0,
                    relationships: 0,
                    assignments: 0
                }
            );
        } finally {
            await db.closePool(pool);
        }
    }
);

test(
    "fehlgeschlagene DDL-Migration bleibt dirty, stoppt Folgemigrationen und gibt den Lock frei",
    { skip: !RUN_INTEGRATION },
    async () => {
        const database = await createDisposableDatabase();
        const pool = createTestPool(database);
        const migrations = [
            testMigration("001_create_marker", async ({ connection }) => {
                await connection.query("CREATE TABLE marker_one (id INT PRIMARY KEY)");
            }),
            testMigration("002_fail_safely", async () => {
                const error = new Error("intentional integration failure");
                error.code = "INTENTIONAL_FAILURE";
                throw error;
            }),
            testMigration("003_must_not_run", async ({ connection }) => {
                await connection.query("CREATE TABLE marker_three (id INT PRIMARY KEY)");
            })
        ];
        const runner = createMigrationRunner({ pool, migrations, logger: silentLogger() });

        try {
            await assert.rejects(
                runner.migrate(),
                (error) =>
                    error.code === "MIGRATION_FAILED" &&
                    error.migrationId === "002_fail_safely"
            );

            const [ledger] = await pool.promise().query(
                `SELECT migration_id, status, failure_code
                 FROM schema_migrations
                 ORDER BY migration_id`
            );
            assert.deepEqual(ledger, [
                {
                    migration_id: "001_create_marker",
                    status: "applied",
                    failure_code: null
                },
                {
                    migration_id: "002_fail_safely",
                    status: "failed",
                    failure_code: "INTENTIONAL_FAILURE"
                }
            ]);

            const [markers] = await pool.promise().query(
                `SELECT TABLE_NAME AS table_name
                 FROM information_schema.TABLES
                 WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('marker_one', 'marker_three')
                 ORDER BY TABLE_NAME`,
                [database]
            );
            assert.deepEqual(markers.map((row) => row.table_name), ["marker_one"]);

            const [locks] = await pool.promise().query(
                "SELECT IS_USED_LOCK(?) AS owner",
                [lockName(database)]
            );
            assert.equal(locks[0].owner, null);

            await assert.rejects(
                runner.migrate(),
                (error) => error.code === "MIGRATION_STATE_INVALID"
            );
        } finally {
            await db.closePool(pool);
        }
    }
);
