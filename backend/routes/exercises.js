const express = require("express");
const db = require("../config/db");
const authenticateToken = require("../middleware/authMiddleware");
const {
    normalizeExercise,
    normalizeText,
    taxonomyVariants
} = require("../utils/taxonomy");

const router = express.Router();

function cleanString(value) {
    return typeof value === "string" ? value.trim() : "";
}

function positiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
}

router.get("/", authenticateToken, (req, res) => {
    const { category, muscle_group } = req.query;

    let sql = `
        SELECT id, user_id, name, description, category, muscle_group, image_url, created_at
        FROM exercises
        WHERE (user_id = ? OR user_id IS NULL)
    `;

    const queryParams = [req.user.id];

    if (category) {
        const variants = taxonomyVariants(category);
        sql += ` AND category IN (${variants.map(() => "?").join(", ")})`;
        queryParams.push(...variants);
    }

    if (muscle_group) {
        const variants = taxonomyVariants(muscle_group);
        sql += ` AND muscle_group IN (${variants.map(() => "?").join(", ")})`;
        queryParams.push(...variants);
    }

    sql += " ORDER BY user_id IS NULL DESC, name ASC";

    db.query(sql, queryParams, (err, results) => {
        if (err) {
            console.error("Loading exercises failed:", err.message);
            return res.status(500).json({
                message: "Error loading exercises"
            });
        }

        res.json(results.map(normalizeExercise));
    });
});

router.post("/", authenticateToken, (req, res) => {
    const name = cleanString(req.body.name);
    const description = normalizeText(cleanString(req.body.description));
    const category = normalizeText(cleanString(req.body.category));
    const muscleGroup = normalizeText(cleanString(req.body.muscle_group));
    const imageUrl = cleanString(req.body.image_url);

    if (!name || !category || !muscleGroup) {
        return res.status(400).json({
            message: "Name, category and muscle_group are required"
        });
    }

    const sql = `
        INSERT INTO exercises (user_id, name, description, category, muscle_group, image_url)
        VALUES (?, ?, ?, ?, ?, ?)
    `;

    db.query(
        sql,
        [
            req.user.id,
            name,
            description || null,
            category,
            muscleGroup,
            imageUrl || null
        ],
        (err, result) => {
            if (err) {
                console.error("Creating exercise failed:", err.message);
                return res.status(500).json({
                    message: "Error creating exercise"
                });
            }

            res.status(201).json({
                message: "Exercise created successfully",
                exerciseId: result.insertId
            });
        }
    );
});

router.put("/:id", authenticateToken, (req, res) => {
    const exerciseId = positiveInteger(req.params.id);
    const name = cleanString(req.body.name);
    const description = normalizeText(cleanString(req.body.description));
    const category = normalizeText(cleanString(req.body.category));
    const muscleGroup = normalizeText(cleanString(req.body.muscle_group));
    const imageUrl = cleanString(req.body.image_url);

    if (!exerciseId) {
        return res.status(400).json({ message: "Invalid exercise id" });
    }

    if (!name || !category || !muscleGroup) {
        return res.status(400).json({
            message: "Name, category and muscle_group are required"
        });
    }

    const sql = `
        UPDATE exercises
        SET name = ?, description = ?, category = ?, muscle_group = ?, image_url = ?
        WHERE id = ? AND user_id = ?
    `;

    db.query(
        sql,
        [
            name,
            description || null,
            category,
            muscleGroup,
            imageUrl || null,
            exerciseId,
            req.user.id
        ],
        (err, result) => {
            if (err) {
                console.error("Updating exercise failed:", err.message);
                return res.status(500).json({
                    message: "Error updating exercise"
                });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({ message: "Exercise not found" });
            }

            res.json({ message: "Exercise updated successfully" });
        }
    );
});

router.delete("/:id", authenticateToken, (req, res) => {
    const exerciseId = positiveInteger(req.params.id);

    if (!exerciseId) {
        return res.status(400).json({ message: "Invalid exercise id" });
    }

    db.query(
        "DELETE FROM exercises WHERE id = ? AND user_id = ?",
        [exerciseId, req.user.id],
        (err, result) => {
            if (err) {
                console.error("Deleting exercise failed:", err.message);
                return res.status(409).json({
                    message: "Exercise is already used in workouts or progress entries"
                });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({ message: "Exercise not found" });
            }

            res.json({ message: "Exercise deleted successfully" });
        }
    );
});

module.exports = router;
