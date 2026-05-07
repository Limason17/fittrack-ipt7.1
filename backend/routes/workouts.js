const express = require("express");
const db = require("../config/db");
const authenticateToken = require("../middleware/authMiddleware");
const { normalizeText } = require("../utils/taxonomy");

const router = express.Router();

function cleanString(value) {
    return typeof value === "string" ? value.trim() : "";
}

function normalizeDate(value) {
    const dateValue = cleanString(value);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
        return null;
    }

    return dateValue;
}

function positiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
}

function nullableWeight(value) {
    if (value === "" || value === null || value === undefined) {
        return null;
    }

    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizeExerciseRows(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return null;
    }

    const normalizedRows = rows.map((row) => ({
        exercise_id: positiveInteger(row.exercise_id),
        sets: positiveInteger(row.sets),
        reps: positiveInteger(row.reps),
        weight: nullableWeight(row.weight)
    }));

    const hasInvalidRow = normalizedRows.some(
        (row) => !row.exercise_id || !row.sets || !row.reps
    );

    return hasInvalidRow ? null : normalizedRows;
}

function groupWorkoutRows(rows) {
    const workoutMap = new Map();

    rows.forEach((row) => {
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
                name: normalizeText(row.exercise_name),
                category: normalizeText(row.category),
                muscle_group: normalizeText(row.muscle_group),
                sets: row.sets,
                reps: row.reps,
                weight: row.weight
            });
        }
    });

    return Array.from(workoutMap.values());
}

async function ensureExercisesAreAvailable(connection, userId, rows) {
    const exerciseIds = [...new Set(rows.map((row) => row.exercise_id))];
    const placeholders = exerciseIds.map(() => "?").join(", ");

    const [availableExercises] = await connection.query(
        `SELECT id
         FROM exercises
         WHERE id IN (${placeholders}) AND (user_id = ? OR user_id IS NULL)`,
        [...exerciseIds, userId]
    );

    if (availableExercises.length !== exerciseIds.length) {
        const error = new Error("One or more exercises are not available");
        error.status = 400;
        throw error;
    }
}

async function insertWorkoutRows(connection, userId, workoutId, workoutDate, rows) {
    await ensureExercisesAreAvailable(connection, userId, rows);

    const workoutValues = rows.map((row) => [
        workoutId,
        row.exercise_id,
        row.sets,
        row.reps,
        row.weight
    ]);

    await connection.query(
        `INSERT INTO workout_exercises (workout_id, exercise_id, sets, reps, weight)
         VALUES ?`,
        [workoutValues]
    );

    const progressValues = rows.map((row) => [
        userId,
        workoutId,
        row.exercise_id,
        row.weight,
        row.reps,
        row.sets,
        workoutDate
    ]);

    await connection.query(
        `INSERT INTO progress_entries (user_id, workout_id, exercise_id, weight, reps, sets, entry_date)
         VALUES ?`,
        [progressValues]
    );
}

router.get("/", authenticateToken, async (req, res) => {
    try {
        const [rows] = await db.promise().query(
            `SELECT
                w.id,
                w.title,
                DATE_FORMAT(w.workout_date, '%Y-%m-%d') AS workout_date,
                w.notes,
                w.created_at,
                we.id AS workout_exercise_id,
                we.exercise_id,
                we.sets,
                we.reps,
                we.weight,
                e.name AS exercise_name,
                e.category,
                e.muscle_group
             FROM workouts w
             LEFT JOIN workout_exercises we ON we.workout_id = w.id
             LEFT JOIN exercises e ON e.id = we.exercise_id
             WHERE w.user_id = ?
             ORDER BY w.workout_date DESC, w.created_at DESC, we.id ASC`,
            [req.user.id]
        );

        res.json(groupWorkoutRows(rows));
    } catch (error) {
        res.status(500).json({ message: "Error loading workouts", error });
    }
});

router.post("/", authenticateToken, async (req, res) => {
    const title = cleanString(req.body.title);
    const workoutDate = normalizeDate(req.body.workout_date);
    const notes = cleanString(req.body.notes) || null;
    const exerciseRows = normalizeExerciseRows(req.body.exercises);

    if (!title || !workoutDate || !exerciseRows) {
        return res.status(400).json({
            message: "Title, workout_date and valid exercises are required"
        });
    }

    const connection = await db.promise().getConnection();

    try {
        await connection.beginTransaction();

        const [workoutResult] = await connection.query(
            `INSERT INTO workouts (user_id, title, workout_date, notes)
             VALUES (?, ?, ?, ?)`,
            [req.user.id, title, workoutDate, notes]
        );

        await insertWorkoutRows(
            connection,
            req.user.id,
            workoutResult.insertId,
            workoutDate,
            exerciseRows
        );

        await connection.commit();

        res.status(201).json({
            message: "Workout created successfully",
            workoutId: workoutResult.insertId
        });
    } catch (error) {
        await connection.rollback();
        res.status(error.status || 500).json({
            message: error.message || "Error creating workout",
            error
        });
    } finally {
        connection.release();
    }
});

router.put("/:id", authenticateToken, async (req, res) => {
    const workoutId = positiveInteger(req.params.id);
    const title = cleanString(req.body.title);
    const workoutDate = normalizeDate(req.body.workout_date);
    const notes = cleanString(req.body.notes) || null;
    const exerciseRows = normalizeExerciseRows(req.body.exercises);

    if (!workoutId || !title || !workoutDate || !exerciseRows) {
        return res.status(400).json({
            message: "Title, workout_date and valid exercises are required"
        });
    }

    const connection = await db.promise().getConnection();

    try {
        await connection.beginTransaction();

        const [ownedWorkouts] = await connection.query(
            "SELECT id FROM workouts WHERE id = ? AND user_id = ?",
            [workoutId, req.user.id]
        );

        if (ownedWorkouts.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: "Workout not found" });
        }

        await connection.query(
            `UPDATE workouts
             SET title = ?, workout_date = ?, notes = ?
             WHERE id = ? AND user_id = ?`,
            [title, workoutDate, notes, workoutId, req.user.id]
        );

        await connection.query(
            "DELETE FROM progress_entries WHERE workout_id = ? AND user_id = ?",
            [workoutId, req.user.id]
        );

        await connection.query(
            "DELETE FROM workout_exercises WHERE workout_id = ?",
            [workoutId]
        );

        await insertWorkoutRows(
            connection,
            req.user.id,
            workoutId,
            workoutDate,
            exerciseRows
        );

        await connection.commit();

        res.json({ message: "Workout updated successfully" });
    } catch (error) {
        await connection.rollback();
        res.status(error.status || 500).json({
            message: error.message || "Error updating workout",
            error
        });
    } finally {
        connection.release();
    }
});

router.delete("/:id", authenticateToken, async (req, res) => {
    const workoutId = positiveInteger(req.params.id);

    if (!workoutId) {
        return res.status(400).json({ message: "Invalid workout id" });
    }

    try {
        const [result] = await db.promise().query(
            "DELETE FROM workouts WHERE id = ? AND user_id = ?",
            [workoutId, req.user.id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Workout not found" });
        }

        res.json({ message: "Workout deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: "Error deleting workout", error });
    }
});

module.exports = router;
