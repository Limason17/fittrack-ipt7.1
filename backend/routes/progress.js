const express = require("express");
const db = require("../config/db");
const authenticateToken = require("../middleware/authMiddleware");
const { normalizeProgressEntry } = require("../utils/taxonomy");

const router = express.Router();

function cleanString(value) {
    return typeof value === "string" ? value.trim() : "";
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

function normalizeDate(value) {
    const dateValue = cleanString(value);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
        return null;
    }

    return dateValue;
}

async function ensureExerciseIsAvailable(userId, exerciseId) {
    const [exercises] = await db.promise().query(
        `SELECT id
         FROM exercises
         WHERE id = ? AND (user_id = ? OR user_id IS NULL)`,
        [exerciseId, userId]
    );

    return exercises.length > 0;
}

router.get("/", authenticateToken, async (req, res) => {
    try {
        const [rows] = await db.promise().query(
            `SELECT
                pe.id,
                pe.workout_id,
                pe.exercise_id,
                pe.weight,
                pe.reps,
                pe.sets,
                DATE_FORMAT(pe.entry_date, '%Y-%m-%d') AS entry_date,
                e.name AS exercise_name,
                e.category,
                e.muscle_group,
                w.title AS workout_title
             FROM progress_entries pe
             INNER JOIN exercises e ON e.id = pe.exercise_id
             LEFT JOIN workouts w ON w.id = pe.workout_id
             WHERE pe.user_id = ?
             ORDER BY pe.entry_date DESC, pe.id DESC
             LIMIT 150`,
            [req.user.id]
        );

        res.json(rows.map(normalizeProgressEntry));
    } catch (error) {
        res.status(500).json({ message: "Error loading progress", error });
    }
});

router.get("/summary", authenticateToken, async (req, res) => {
    try {
        const [rows] = await db.promise().query(
            `SELECT
                e.id AS exercise_id,
                e.name AS exercise_name,
                e.category,
                e.muscle_group,
                COUNT(pe.id) AS total_entries,
                MAX(pe.weight) AS max_weight,
                MAX(pe.reps) AS max_reps,
                MAX(pe.sets) AS max_sets,
                MAX(COALESCE(pe.weight, 0) * pe.reps * pe.sets) AS max_volume,
                DATE_FORMAT(MAX(pe.entry_date), '%Y-%m-%d') AS latest_date
             FROM progress_entries pe
             INNER JOIN exercises e ON e.id = pe.exercise_id
             WHERE pe.user_id = ?
             GROUP BY e.id, e.name, e.category, e.muscle_group
             ORDER BY latest_date DESC, e.name ASC`,
            [req.user.id]
        );

        res.json(rows.map(normalizeProgressEntry));
    } catch (error) {
        res.status(500).json({ message: "Error loading progress summary", error });
    }
});

router.post("/", authenticateToken, async (req, res) => {
    const exerciseId = positiveInteger(req.body.exercise_id);
    const sets = positiveInteger(req.body.sets);
    const reps = positiveInteger(req.body.reps);
    const weight = nullableWeight(req.body.weight);
    const entryDate = normalizeDate(req.body.entry_date);

    if (!exerciseId || !sets || !reps || !entryDate) {
        return res.status(400).json({
            message: "Exercise, sets, reps and entry_date are required"
        });
    }

    try {
        const exerciseIsAvailable = await ensureExerciseIsAvailable(
            req.user.id,
            exerciseId
        );

        if (!exerciseIsAvailable) {
            return res.status(400).json({ message: "Exercise is not available" });
        }

        const [result] = await db.promise().query(
            `INSERT INTO progress_entries (user_id, exercise_id, weight, reps, sets, entry_date)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [req.user.id, exerciseId, weight, reps, sets, entryDate]
        );

        res.status(201).json({
            message: "Progress entry created successfully",
            progressId: result.insertId
        });
    } catch (error) {
        res.status(500).json({ message: "Error creating progress entry", error });
    }
});

router.delete("/:id", authenticateToken, async (req, res) => {
    const progressId = positiveInteger(req.params.id);

    if (!progressId) {
        return res.status(400).json({ message: "Invalid progress id" });
    }

    try {
        const [result] = await db.promise().query(
            "DELETE FROM progress_entries WHERE id = ? AND user_id = ?",
            [progressId, req.user.id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Progress entry not found" });
        }

        res.json({ message: "Progress entry deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: "Error deleting progress entry", error });
    }
});

module.exports = router;
