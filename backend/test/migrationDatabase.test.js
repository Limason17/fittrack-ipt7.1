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
                    "005_studio_tenancy_and_rbac"
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
                "005_studio_tenancy_and_rbac"
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
                    "studio_invitations",
                    "studio_memberships",
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
            assert.equal(historyColumns.length, 10);

            const [ledgerSnapshot] = await pool.promise().query(
                `SELECT migration_id, checksum, status, started_at, applied_at
                 FROM schema_migrations
                 ORDER BY migration_id`
            );
            assert.equal(ledgerSnapshot.length, 5);
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
            assert.deepEqual(stage1Result.applied, ["005_studio_tenancy_and_rbac"]);
            const afterStudioMigration = await personalDataSnapshot(sql);
            assert.deepEqual(
                afterStudioMigration,
                beforeStudioMigration,
                "studio schema migration must not alter personal rows or links"
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
