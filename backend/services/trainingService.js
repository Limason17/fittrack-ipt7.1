const {
    ConflictError,
    NotFoundError,
    ValidationError
} = require("../errors/AppError");
const { normalizeProgressEntry, normalizeText } = require("../utils/taxonomy");
const { MAX_EPLEY_REPS } = require("../utils/trainingMetrics");
const { validateMetricsForExercise } = require("../validation/trainingValidation");

function groupWorkoutRows(rows) {
    const workoutMap = new Map();

    for (const row of rows) {
        if (!workoutMap.has(row.id)) {
            workoutMap.set(row.id, {
                id: row.id,
                title: row.title,
                workout_date: row.workout_date,
                notes: row.notes,
                created_at: row.created_at,
                exercises: []
            });
        }

        if (row.workout_exercise_id) {
            workoutMap.get(row.id).exercises.push({
                id: row.workout_exercise_id,
                exercise_id: row.exercise_id,
                name: normalizeText(row.exercise_name_snapshot),
                category: normalizeText(row.exercise_category_snapshot),
                muscle_group: normalizeText(row.exercise_muscle_group_snapshot),
                image_url: row.exercise_image_url_snapshot,
                sets: row.sets,
                reps: row.reps,
                weight: row.weight,
                duration_minutes: row.duration_minutes,
                distance_km: row.distance_km,
                intensity_level: row.intensity_level
            });
        }
    }

    return [...workoutMap.values()];
}

function exerciseSnapshot(exercise) {
    return {
        name: exercise.name,
        category: exercise.category,
        muscleGroup: exercise.muscle_group,
        imageUrl: exercise.image_url || null
    };
}

function snapshotsByWorkoutExerciseId(rows) {
    const snapshots = new Map();

    for (const row of rows) {
        snapshots.set(Number(row.workout_exercise_id), {
            exerciseId: Number(row.exercise_id),
            snapshot: {
                name: row.exercise_name_snapshot,
                category: row.exercise_category_snapshot,
                muscleGroup: row.exercise_muscle_group_snapshot,
                imageUrl: row.exercise_image_url_snapshot || null
            }
        });
    }

    return snapshots;
}

function consumePreservedSnapshot(row, index, availableSnapshots) {
    const identityProvided = Object.hasOwn(row, "workout_exercise_id");

    if (identityProvided && row.workout_exercise_id === null) {
        return null;
    }

    if (identityProvided) {
        const stored = availableSnapshots.get(row.workout_exercise_id);
        if (!stored || stored.exerciseId !== row.exercise_id) {
            throw new ValidationError({
                [`exercises.${index}.workout_exercise_id`]:
                    "The workout exercise identifier is invalid or was already used."
            });
        }
        availableSnapshots.delete(row.workout_exercise_id);
        return stored.snapshot;
    }

    const legacyMatches = [...availableSnapshots.entries()].filter(
        ([, stored]) => stored.exerciseId === row.exercise_id
    );
    if (legacyMatches.length > 1) {
        throw new ValidationError({
            [`exercises.${index}.workout_exercise_id`]:
                "A workout exercise identifier is required for ambiguous duplicate rows."
        });
    }
    if (legacyMatches.length === 1) {
        const [workoutExerciseId, stored] = legacyMatches[0];
        availableSnapshots.delete(workoutExerciseId);
        return stored.snapshot;
    }

    return null;
}

function createTrainingService(database) {
    async function availableExercisesById(connection, userId, rows) {
        const exerciseIds = [...new Set(rows.map((row) => row.exercise_id))];
        const placeholders = exerciseIds.map(() => "?").join(", ");
        const [availableExercises] = await connection.query(
            `SELECT id, name, category, muscle_group, image_url
             FROM exercises
             WHERE id IN (${placeholders}) AND (user_id = ? OR user_id IS NULL)`,
            [...exerciseIds, userId]
        );

        if (availableExercises.length !== exerciseIds.length) {
            throw new ValidationError({
                exercises: "One or more exercises are not available."
            });
        }

        return new Map(availableExercises.map((exercise) => [exercise.id, exercise]));
    }

    async function insertWorkoutRows(
        connection,
        userId,
        workoutId,
        workoutDate,
        rows,
        preservedSnapshots = new Map()
    ) {
        const exercisesById = await availableExercisesById(connection, userId, rows);

        for (let index = 0; index < rows.length; index += 1) {
            const row = rows[index];
            const exercise = exercisesById.get(row.exercise_id);
            const snapshot =
                consumePreservedSnapshot(row, index, preservedSnapshots) ||
                exerciseSnapshot(exercise);
            validateMetricsForExercise(
                row,
                { ...exercise, category: snapshot.category },
                `exercises.${index}`
            );

            const [workoutExerciseResult] = await connection.query(
                `INSERT INTO workout_exercises (
                    workout_id, exercise_id, sets, reps, weight,
                    duration_minutes, distance_km, intensity_level,
                    exercise_name_snapshot, exercise_category_snapshot,
                    exercise_muscle_group_snapshot, exercise_image_url_snapshot
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    workoutId,
                    row.exercise_id,
                    row.sets,
                    row.reps,
                    row.weight,
                    row.duration_minutes,
                    row.distance_km,
                    row.intensity_level,
                    snapshot.name,
                    snapshot.category,
                    snapshot.muscleGroup,
                    snapshot.imageUrl
                ]
            );

            await connection.query(
                `INSERT INTO progress_entries (
                    user_id, workout_id, workout_exercise_id, exercise_id,
                    source_type, weight, reps, sets, duration_minutes,
                    distance_km, intensity_level, entry_date,
                    exercise_name_snapshot, exercise_category_snapshot,
                    exercise_muscle_group_snapshot, exercise_image_url_snapshot
                 ) VALUES (?, ?, ?, ?, 'workout', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    userId,
                    workoutId,
                    workoutExerciseResult.insertId,
                    row.exercise_id,
                    row.weight,
                    row.reps,
                    row.sets,
                    row.duration_minutes,
                    row.distance_km,
                    row.intensity_level,
                    workoutDate,
                    snapshot.name,
                    snapshot.category,
                    snapshot.muscleGroup,
                    snapshot.imageUrl
                ]
            );
        }
    }

    async function listWorkouts(userId) {
        const [rows] = await database.query(
            `SELECT
                w.id, w.title,
                DATE_FORMAT(w.workout_date, '%Y-%m-%d') AS workout_date,
                w.notes, w.created_at,
                we.id AS workout_exercise_id, we.exercise_id,
                we.sets, we.reps, we.weight, we.duration_minutes,
                we.distance_km, we.intensity_level,
                we.exercise_name_snapshot,
                we.exercise_category_snapshot,
                we.exercise_muscle_group_snapshot,
                we.exercise_image_url_snapshot
             FROM workouts w
             LEFT JOIN workout_exercises we ON we.workout_id = w.id
             WHERE w.user_id = ?
             ORDER BY w.workout_date DESC, w.created_at DESC, we.id ASC`,
            [userId]
        );
        return groupWorkoutRows(rows);
    }

    async function createWorkout(userId, input) {
        const connection = await database.getConnection();
        let transactionStarted = false;
        try {
            await connection.beginTransaction();
            transactionStarted = true;
            const [result] = await connection.query(
                `INSERT INTO workouts (user_id, title, workout_date, notes)
                 VALUES (?, ?, ?, ?)`,
                [userId, input.title, input.workout_date, input.notes]
            );
            await insertWorkoutRows(
                connection,
                userId,
                result.insertId,
                input.workout_date,
                input.exercises
            );
            await connection.commit();
            return result.insertId;
        } catch (error) {
            if (transactionStarted) await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    async function updateWorkout(userId, workoutId, input) {
        const connection = await database.getConnection();
        let transactionStarted = false;
        try {
            await connection.beginTransaction();
            transactionStarted = true;
            const [owned] = await connection.query(
                "SELECT id FROM workouts WHERE id = ? AND user_id = ? FOR UPDATE",
                [workoutId, userId]
            );
            if (owned.length === 0) {
                throw new NotFoundError("Workout not found.");
            }

            const [historicalRows] = await connection.query(
                `SELECT
                    id AS workout_exercise_id, exercise_id, exercise_name_snapshot,
                    exercise_category_snapshot, exercise_muscle_group_snapshot,
                    exercise_image_url_snapshot
                 FROM workout_exercises
                 WHERE workout_id = ?
                 ORDER BY id
                 FOR UPDATE`,
                [workoutId]
            );
            const preservedSnapshots = snapshotsByWorkoutExerciseId(historicalRows);

            await connection.query(
                `UPDATE workouts SET title = ?, workout_date = ?, notes = ?
                 WHERE id = ? AND user_id = ?`,
                [input.title, input.workout_date, input.notes, workoutId, userId]
            );
            await connection.query(
                "DELETE FROM progress_entries WHERE workout_id = ? AND user_id = ? AND source_type = 'workout'",
                [workoutId, userId]
            );
            await connection.query(
                "DELETE FROM workout_exercises WHERE workout_id = ?",
                [workoutId]
            );
            await insertWorkoutRows(
                connection,
                userId,
                workoutId,
                input.workout_date,
                input.exercises,
                preservedSnapshots
            );
            await connection.commit();
        } catch (error) {
            if (transactionStarted) await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    async function deleteWorkout(userId, workoutId) {
        const [result] = await database.query(
            "DELETE FROM workouts WHERE id = ? AND user_id = ?",
            [workoutId, userId]
        );
        if (result.affectedRows === 0) {
            throw new NotFoundError("Workout not found.");
        }
    }

    async function listProgress(userId) {
        const [rows] = await database.query(
            `SELECT
                pe.id, pe.workout_id, pe.workout_exercise_id, pe.exercise_id,
                pe.source_type, pe.weight, pe.reps, pe.sets,
                pe.duration_minutes, pe.distance_km, pe.intensity_level,
                DATE_FORMAT(pe.entry_date, '%Y-%m-%d') AS entry_date,
                pe.exercise_name_snapshot AS exercise_name,
                pe.exercise_category_snapshot AS category,
                pe.exercise_muscle_group_snapshot AS muscle_group,
                pe.exercise_image_url_snapshot AS image_url,
                w.title AS workout_title
             FROM progress_entries pe
             LEFT JOIN workouts w ON w.id = pe.workout_id
             WHERE pe.user_id = ?
             ORDER BY pe.entry_date DESC, pe.id DESC
             LIMIT 150`,
            [userId]
        );
        return rows.map(normalizeProgressEntry);
    }

    async function getProgressSummary(userId) {
        const [rows] = await database.query(
            `SELECT
                pe.exercise_id,
                pe.exercise_name_snapshot AS exercise_name,
                pe.exercise_category_snapshot AS category,
                pe.exercise_muscle_group_snapshot AS muscle_group,
                pe.exercise_image_url_snapshot AS image_url,
                COUNT(pe.id) AS total_entries,
                MAX(CASE WHEN pe.exercise_category_snapshot <> 'Cardio' THEN pe.weight END) AS max_weight,
                MAX(CASE WHEN pe.exercise_category_snapshot <> 'Cardio' THEN pe.reps END) AS max_reps,
                MAX(CASE WHEN pe.exercise_category_snapshot <> 'Cardio' THEN pe.sets END) AS max_sets,
                MAX(CASE
                    WHEN pe.exercise_category_snapshot = 'Cardio' THEN NULL
                    WHEN pe.weight IS NULL OR pe.weight = 0 THEN pe.reps * pe.sets
                    ELSE pe.weight * pe.reps * pe.sets END) AS max_volume,
                MAX(CASE
                    WHEN pe.exercise_category_snapshot <> 'Cardio' AND pe.weight > 0
                         AND pe.reps BETWEEN 1 AND ${MAX_EPLEY_REPS}
                    THEN pe.weight * (1 + pe.reps / 30) ELSE NULL END) AS max_estimated_one_rep_max,
                MAX(CASE WHEN pe.exercise_category_snapshot = 'Cardio' THEN pe.duration_minutes END) AS max_duration_minutes,
                MAX(CASE WHEN pe.exercise_category_snapshot = 'Cardio' THEN pe.distance_km END) AS max_distance_km,
                MAX(CASE WHEN pe.exercise_category_snapshot = 'Cardio' THEN pe.intensity_level END) AS max_intensity_level,
                MAX(CASE
                    WHEN pe.exercise_category_snapshot = 'Cardio'
                         AND pe.duration_minutes > 0 AND pe.distance_km > 0
                    THEN pe.distance_km / pe.duration_minutes * 60 ELSE NULL END) AS max_speed_kmh,
                DATE_FORMAT(MAX(pe.entry_date), '%Y-%m-%d') AS latest_date
             FROM progress_entries pe
             WHERE pe.user_id = ?
             GROUP BY
                pe.exercise_id, pe.exercise_name_snapshot,
                pe.exercise_category_snapshot, pe.exercise_muscle_group_snapshot,
                pe.exercise_image_url_snapshot
             ORDER BY latest_date DESC, exercise_name ASC`,
            [userId]
        );
        return rows.map(normalizeProgressEntry);
    }

    async function createManualProgress(userId, input) {
        const [exercises] = await database.query(
            `SELECT id, name, category, muscle_group, image_url
             FROM exercises
             WHERE id = ? AND (user_id = ? OR user_id IS NULL)`,
            [input.exercise_id, userId]
        );
        const exercise = exercises[0];
        if (!exercise) {
            throw new ValidationError({ exercise_id: "Exercise is not available." });
        }
        validateMetricsForExercise(input, exercise);
        const snapshot = exerciseSnapshot(exercise);
        const [result] = await database.query(
            `INSERT INTO progress_entries (
                user_id, workout_id, workout_exercise_id, exercise_id,
                source_type, weight, reps, sets, duration_minutes,
                distance_km, intensity_level, entry_date,
                exercise_name_snapshot, exercise_category_snapshot,
                exercise_muscle_group_snapshot, exercise_image_url_snapshot
             ) VALUES (?, NULL, NULL, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                userId,
                input.exercise_id,
                input.weight,
                input.reps,
                input.sets,
                input.duration_minutes,
                input.distance_km,
                input.intensity_level,
                input.entry_date,
                snapshot.name,
                snapshot.category,
                snapshot.muscleGroup,
                snapshot.imageUrl
            ]
        );
        return result.insertId;
    }

    async function deleteProgress(userId, progressId) {
        const [entries] = await database.query(
            "SELECT id, source_type FROM progress_entries WHERE id = ? AND user_id = ?",
            [progressId, userId]
        );
        if (entries.length === 0) {
            throw new NotFoundError("Progress entry not found.");
        }
        if (entries[0].source_type === "workout") {
            throw new ConflictError(
                "Workout-derived progress can only be changed through its workout.",
                "DERIVED_PROGRESS_IMMUTABLE"
            );
        }
        await database.query(
            "DELETE FROM progress_entries WHERE id = ? AND user_id = ? AND source_type = 'manual'",
            [progressId, userId]
        );
    }

    return {
        createManualProgress,
        createWorkout,
        deleteProgress,
        deleteWorkout,
        getProgressSummary,
        listProgress,
        listWorkouts,
        updateWorkout
    };
}

module.exports = {
    consumePreservedSnapshot,
    createTrainingService,
    groupWorkoutRows,
    snapshotsByWorkoutExerciseId
};
