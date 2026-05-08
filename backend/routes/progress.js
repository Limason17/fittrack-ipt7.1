const express = require("express");
const db = require("../config/db");
const authenticateToken = require("../middleware/authMiddleware");
const { normalizeProgressEntry } = require("../utils/taxonomy");
const {
    normalizeRowForExercise,
    normalizeTrainingRow,
    positiveInteger
} = require("../utils/trainingMetrics");

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

async function availableExercise(userId, exerciseId) {
    const [exercises] = await db.promise().query(
        `SELECT id, category
         FROM exercises
         WHERE id = ? AND (user_id = ? OR user_id IS NULL)`,
        [exerciseId, userId]
    );

    return exercises[0] || null;
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
                pe.duration_minutes,
                pe.distance_km,
                pe.intensity_level,
                DATE_FORMAT(pe.entry_date, '%Y-%m-%d') AS entry_date,
                e.name AS exercise_name,
                e.category,
                e.muscle_group,
                e.image_url,
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
                e.image_url,
                COUNT(pe.id) AS total_entries,
                MAX(CASE WHEN e.category <> 'Cardio' THEN pe.weight END) AS max_weight,
                MAX(CASE WHEN e.category <> 'Cardio' THEN pe.reps END) AS max_reps,
                MAX(CASE WHEN e.category <> 'Cardio' THEN pe.sets END) AS max_sets,
                MAX(
                    CASE
                        WHEN e.category = 'Cardio' THEN NULL
                        WHEN pe.weight IS NULL OR pe.weight = 0 THEN pe.reps * pe.sets
                        ELSE pe.weight * pe.reps * pe.sets
                    END
                ) AS max_volume,
                MAX(
                    CASE
                        WHEN e.category <> 'Cardio' AND pe.weight > 0 THEN pe.weight * (1 + pe.reps / 30)
                        ELSE NULL
                    END
                ) AS max_estimated_one_rep_max,
                MAX(CASE WHEN e.category = 'Cardio' THEN pe.duration_minutes END) AS max_duration_minutes,
                MAX(CASE WHEN e.category = 'Cardio' THEN pe.distance_km END) AS max_distance_km,
                MAX(CASE WHEN e.category = 'Cardio' THEN pe.intensity_level END) AS max_intensity_level,
                MAX(
                    CASE
                        WHEN e.category = 'Cardio' AND pe.duration_minutes > 0 AND pe.distance_km > 0
                            THEN pe.distance_km / pe.duration_minutes * 60
                        ELSE NULL
                    END
                ) AS max_speed_kmh,
                DATE_FORMAT(MAX(pe.entry_date), '%Y-%m-%d') AS latest_date
             FROM progress_entries pe
             INNER JOIN exercises e ON e.id = pe.exercise_id
             WHERE pe.user_id = ?
             GROUP BY e.id, e.name, e.category, e.muscle_group, e.image_url
             ORDER BY latest_date DESC, e.name ASC`,
            [req.user.id]
        );

        res.json(rows.map(normalizeProgressEntry));
    } catch (error) {
        res.status(500).json({ message: "Error loading progress summary", error });
    }
});

router.post("/", authenticateToken, async (req, res) => {
    const trainingRow = normalizeTrainingRow(req.body);
    const entryDate = normalizeDate(req.body.entry_date);

    if (!trainingRow.exercise_id || !entryDate) {
        return res.status(400).json({
            message: "Exercise, entry_date and valid training data are required"
        });
    }

    try {
        const exercise = await availableExercise(
            req.user.id,
            trainingRow.exercise_id
        );

        if (!exercise) {
            return res.status(400).json({ message: "Exercise is not available" });
        }

        const validatedRow = normalizeRowForExercise(trainingRow, exercise);

        if (!validatedRow) {
            return res.status(400).json({
                message: "Complete strength or cardio data is required"
            });
        }

        const [result] = await db.promise().query(
            `INSERT INTO progress_entries (
                user_id,
                exercise_id,
                weight,
                reps,
                sets,
                duration_minutes,
                distance_km,
                intensity_level,
                entry_date
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                req.user.id,
                validatedRow.exercise_id,
                validatedRow.weight,
                validatedRow.reps,
                validatedRow.sets,
                validatedRow.duration_minutes,
                validatedRow.distance_km,
                validatedRow.intensity_level,
                entryDate
            ]
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
