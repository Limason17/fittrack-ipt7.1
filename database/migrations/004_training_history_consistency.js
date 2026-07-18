function migrationError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

async function addColumn(connection, helpers, table, column, definition) {
    if (!(await helpers.columnExists(table, column))) {
        await connection.query(
            `ALTER TABLE ${helpers.escapeId(table)} ADD COLUMN ${helpers.escapeId(column)} ${definition}`
        );
    }
}

async function addIndex(connection, helpers, table, name, definition) {
    if (!(await helpers.indexExists(table, name))) {
        await connection.query(
            `ALTER TABLE ${helpers.escapeId(table)} ADD ${definition}`
        );
    }
}

async function addCheck(connection, helpers, table, name, expression) {
    if (!(await helpers.checkConstraintExists(table, name))) {
        await connection.query(
            `ALTER TABLE ${helpers.escapeId(table)}
             ADD CONSTRAINT ${helpers.escapeId(name)} CHECK (${expression})`
        );
    }
}

async function count(connection, sql) {
    const [rows] = await connection.query(sql);
    return Number(rows[0]?.total || 0);
}

module.exports = {
    id: "004_training_history_consistency",
    description: "Link workout-derived progress and freeze historical exercise metadata",
    async up({ connection, helpers }) {
        const snapshotColumns = [
            ["exercise_name_snapshot", "VARCHAR(80) NULL"],
            ["exercise_category_snapshot", "VARCHAR(50) NULL"],
            ["exercise_muscle_group_snapshot", "VARCHAR(50) NULL"],
            ["exercise_image_url_snapshot", "VARCHAR(500) NULL"]
        ];

        for (const [column, definition] of snapshotColumns) {
            await addColumn(connection, helpers, "workout_exercises", column, definition);
            await addColumn(connection, helpers, "progress_entries", column, definition);
        }
        await addColumn(
            connection,
            helpers,
            "progress_entries",
            "source_type",
            "VARCHAR(16) NOT NULL DEFAULT 'manual'"
        );
        await addColumn(
            connection,
            helpers,
            "progress_entries",
            "workout_exercise_id",
            "INT NULL"
        );

        await connection.query(`
            UPDATE workout_exercises we
            INNER JOIN exercises e ON e.id = we.exercise_id
            SET
                we.exercise_name_snapshot = COALESCE(we.exercise_name_snapshot, e.name),
                we.exercise_category_snapshot = COALESCE(we.exercise_category_snapshot, e.category),
                we.exercise_muscle_group_snapshot = COALESCE(we.exercise_muscle_group_snapshot, e.muscle_group),
                we.exercise_image_url_snapshot = COALESCE(we.exercise_image_url_snapshot, e.image_url)
        `);
        await connection.query(`
            UPDATE progress_entries pe
            INNER JOIN exercises e ON e.id = pe.exercise_id
            SET
                pe.exercise_name_snapshot = COALESCE(pe.exercise_name_snapshot, e.name),
                pe.exercise_category_snapshot = COALESCE(pe.exercise_category_snapshot, e.category),
                pe.exercise_muscle_group_snapshot = COALESCE(pe.exercise_muscle_group_snapshot, e.muscle_group),
                pe.exercise_image_url_snapshot = COALESCE(pe.exercise_image_url_snapshot, e.image_url),
                pe.source_type = CASE WHEN pe.workout_id IS NULL THEN 'manual' ELSE 'workout' END
        `);

        await connection.query("DROP TEMPORARY TABLE IF EXISTS stage_progress_workout_links");
        await connection.query(`
            CREATE TEMPORARY TABLE stage_progress_workout_links (
                progress_entry_id INT NOT NULL PRIMARY KEY,
                workout_exercise_id INT NOT NULL UNIQUE
            ) ENGINE=InnoDB
            AS
            SELECT
                ranked_progress.id AS progress_entry_id,
                ranked_workout.id AS workout_exercise_id
            FROM (
                SELECT
                    id,
                    workout_id,
                    exercise_id,
                    ROW_NUMBER() OVER (
                        PARTITION BY workout_id, exercise_id ORDER BY id
                    ) AS occurrence
                FROM progress_entries
                WHERE workout_id IS NOT NULL
            ) ranked_progress
            INNER JOIN (
                SELECT
                    id,
                    workout_id,
                    exercise_id,
                    ROW_NUMBER() OVER (
                        PARTITION BY workout_id, exercise_id ORDER BY id
                    ) AS occurrence
                FROM workout_exercises
            ) ranked_workout
                ON ranked_workout.workout_id = ranked_progress.workout_id
               AND ranked_workout.exercise_id = ranked_progress.exercise_id
               AND ranked_workout.occurrence = ranked_progress.occurrence
        `);
        await connection.query(`
            UPDATE progress_entries pe
            INNER JOIN stage_progress_workout_links links
                ON links.progress_entry_id = pe.id
            SET pe.workout_exercise_id = links.workout_exercise_id
            WHERE pe.workout_id IS NOT NULL
        `);

        const unmatchedExisting = await count(
            connection,
            `SELECT COUNT(*) AS total
             FROM progress_entries
             WHERE workout_id IS NOT NULL AND workout_exercise_id IS NULL`
        );
        if (unmatchedExisting > 0) {
            throw migrationError(
                "UNMATCHED_LEGACY_PROGRESS",
                `${unmatchedExisting} workout-derived progress entries cannot be matched safely. No rows were deleted.`
            );
        }

        await connection.query(`
            INSERT INTO progress_entries (
                user_id, workout_id, workout_exercise_id, exercise_id,
                source_type, weight, reps, sets, duration_minutes,
                distance_km, intensity_level, entry_date,
                exercise_name_snapshot, exercise_category_snapshot,
                exercise_muscle_group_snapshot, exercise_image_url_snapshot
            )
            SELECT
                w.user_id, we.workout_id, we.id, we.exercise_id,
                'workout', we.weight, we.reps, we.sets, we.duration_minutes,
                we.distance_km, we.intensity_level, w.workout_date,
                we.exercise_name_snapshot, we.exercise_category_snapshot,
                we.exercise_muscle_group_snapshot, we.exercise_image_url_snapshot
            FROM workout_exercises we
            INNER JOIN workouts w ON w.id = we.workout_id
            LEFT JOIN progress_entries pe ON pe.workout_exercise_id = we.id
            WHERE pe.id IS NULL
        `);
        await connection.query("DROP TEMPORARY TABLE stage_progress_workout_links");

        const missingSnapshots = await count(
            connection,
            `SELECT (
                SELECT COUNT(*) FROM workout_exercises
                WHERE exercise_name_snapshot IS NULL
                   OR exercise_category_snapshot IS NULL
                   OR exercise_muscle_group_snapshot IS NULL
            ) + (
                SELECT COUNT(*) FROM progress_entries
                WHERE exercise_name_snapshot IS NULL
                   OR exercise_category_snapshot IS NULL
                   OR exercise_muscle_group_snapshot IS NULL
            ) AS total`
        );
        if (missingSnapshots > 0) {
            throw migrationError(
                "MISSING_EXERCISE_SNAPSHOT",
                "Historical exercise snapshots could not be populated safely."
            );
        }

        const invalidMetrics = await count(
            connection,
            `SELECT (
                SELECT COUNT(*) FROM workout_exercises
                WHERE (sets IS NOT NULL AND sets <= 0)
                   OR (reps IS NOT NULL AND reps <= 0)
                   OR (weight IS NOT NULL AND weight < 0)
                   OR (duration_minutes IS NOT NULL AND duration_minutes <= 0)
                   OR (distance_km IS NOT NULL AND distance_km < 0)
                   OR (intensity_level IS NOT NULL AND (intensity_level < 1 OR intensity_level > 10))
            ) + (
                SELECT COUNT(*) FROM progress_entries
                WHERE (sets IS NOT NULL AND sets <= 0)
                   OR (reps IS NOT NULL AND reps <= 0)
                   OR (weight IS NOT NULL AND weight < 0)
                   OR (duration_minutes IS NOT NULL AND duration_minutes <= 0)
                   OR (distance_km IS NOT NULL AND distance_km < 0)
                   OR (intensity_level IS NOT NULL AND (intensity_level < 1 OR intensity_level > 10))
            ) AS total`
        );
        if (invalidMetrics > 0) {
            throw migrationError(
                "INVALID_LEGACY_METRICS",
                `${invalidMetrics} historical metric rows violate the Stage 0A constraints. No rows were deleted.`
            );
        }

        for (const table of ["workout_exercises", "progress_entries"]) {
            await connection.query(`
                ALTER TABLE ${helpers.escapeId(table)}
                MODIFY COLUMN exercise_name_snapshot VARCHAR(80) NOT NULL,
                MODIFY COLUMN exercise_category_snapshot VARCHAR(50) NOT NULL,
                MODIFY COLUMN exercise_muscle_group_snapshot VARCHAR(50) NOT NULL,
                MODIFY COLUMN exercise_image_url_snapshot VARCHAR(500) NULL
            `);
        }

        await addIndex(
            connection,
            helpers,
            "workout_exercises",
            "uq_workout_exercise_workout",
            "UNIQUE INDEX uq_workout_exercise_workout (id, workout_id)"
        );
        await addIndex(
            connection,
            helpers,
            "progress_entries",
            "uq_progress_workout_exercise",
            "UNIQUE INDEX uq_progress_workout_exercise (workout_exercise_id)"
        );

        if (!(await helpers.foreignKeyExists("progress_entries", "fk_progress_workout_exercise"))) {
            await connection.query(`
                ALTER TABLE progress_entries
                ADD CONSTRAINT fk_progress_workout_exercise
                FOREIGN KEY (workout_exercise_id, workout_id)
                REFERENCES workout_exercises (id, workout_id)
                ON DELETE CASCADE
            `);
        }

        await addCheck(
            connection,
            helpers,
            "progress_entries",
            "chk_progress_source_link",
            `(source_type = 'manual' AND workout_id IS NULL AND workout_exercise_id IS NULL)
             OR (source_type = 'workout' AND workout_id IS NOT NULL AND workout_exercise_id IS NOT NULL)`
        );
        await addCheck(
            connection,
            helpers,
            "workout_exercises",
            "chk_workout_exercise_metric_ranges",
            `(sets IS NULL OR sets > 0)
             AND (reps IS NULL OR reps > 0)
             AND (weight IS NULL OR weight >= 0)
             AND (duration_minutes IS NULL OR duration_minutes > 0)
             AND (distance_km IS NULL OR distance_km >= 0)
             AND (intensity_level IS NULL OR intensity_level BETWEEN 1 AND 10)`
        );
        await addCheck(
            connection,
            helpers,
            "progress_entries",
            "chk_progress_metric_ranges",
            `(sets IS NULL OR sets > 0)
             AND (reps IS NULL OR reps > 0)
             AND (weight IS NULL OR weight >= 0)
             AND (duration_minutes IS NULL OR duration_minutes > 0)
             AND (distance_km IS NULL OR distance_km >= 0)
             AND (intensity_level IS NULL OR intensity_level BETWEEN 1 AND 10)`
        );
    }
};
