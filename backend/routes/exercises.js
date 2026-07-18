const express = require("express");
const db = require("../config/db");
const authenticateToken = require("../middleware/authMiddleware");
const { ConflictError, NotFoundError, ValidationError } = require("../errors/AppError");
const {
    normalizeExercise,
    normalizeText,
    taxonomyVariants
} = require("../utils/taxonomy");
const { validatePathId, validateString } = require("../validation/trainingValidation");

const router = express.Router();

function exerciseInput(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new ValidationError({ body: "A JSON object is required." });
    }

    return {
        name: normalizeText(validateString(body.name, {
            field: "name", required: true, maxLength: 80
        })),
        description: normalizeText(validateString(body.description, {
            field: "description", maxLength: 255
        })),
        category: normalizeText(validateString(body.category, {
            field: "category", required: true, maxLength: 50
        })),
        muscleGroup: normalizeText(validateString(body.muscle_group, {
            field: "muscle_group", required: true, maxLength: 50
        })),
        imageUrl: validateString(body.image_url, {
            field: "image_url", maxLength: 500
        })
    };
}

router.get("/", authenticateToken, async (req, res) => {
    const { category, muscle_group: muscleGroup } = req.query;
    let sql = `
        SELECT id, user_id, name, description, category, muscle_group, image_url, created_at
        FROM exercises
        WHERE (user_id = ? OR user_id IS NULL)
    `;
    const parameters = [req.user.id];

    if (category) {
        if (typeof category !== "string" || category.length > 50) {
            throw new ValidationError({ category: "Category filter is invalid." });
        }
        const variants = taxonomyVariants(category);
        sql += ` AND category IN (${variants.map(() => "?").join(", ")})`;
        parameters.push(...variants);
    }
    if (muscleGroup) {
        if (typeof muscleGroup !== "string" || muscleGroup.length > 50) {
            throw new ValidationError({ muscle_group: "Muscle group filter is invalid." });
        }
        const variants = taxonomyVariants(muscleGroup);
        sql += ` AND muscle_group IN (${variants.map(() => "?").join(", ")})`;
        parameters.push(...variants);
    }
    sql += " ORDER BY user_id IS NULL DESC, name ASC";

    const [rows] = await db.promise().query(sql, parameters);
    res.json(rows.map(normalizeExercise));
});

router.post("/", authenticateToken, async (req, res) => {
    const input = exerciseInput(req.body);
    const [result] = await db.promise().query(
        `INSERT INTO exercises (user_id, name, description, category, muscle_group, image_url)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
            req.user.id,
            input.name,
            input.description,
            input.category,
            input.muscleGroup,
            input.imageUrl
        ]
    );
    res.status(201).json({
        message: "Exercise created successfully",
        exerciseId: result.insertId
    });
});

router.put("/:id", authenticateToken, async (req, res) => {
    const exerciseId = validatePathId(req.params.id, "exerciseId");
    const input = exerciseInput(req.body);
    const [result] = await db.promise().query(
        `UPDATE exercises
         SET name = ?, description = ?, category = ?, muscle_group = ?, image_url = ?
         WHERE id = ? AND user_id = ?`,
        [
            input.name,
            input.description,
            input.category,
            input.muscleGroup,
            input.imageUrl,
            exerciseId,
            req.user.id
        ]
    );
    if (result.affectedRows === 0) {
        throw new NotFoundError("Exercise not found.");
    }
    res.json({ message: "Exercise updated successfully" });
});

router.delete("/:id", authenticateToken, async (req, res) => {
    const exerciseId = validatePathId(req.params.id, "exerciseId");
    try {
        const [result] = await db.promise().query(
            "DELETE FROM exercises WHERE id = ? AND user_id = ?",
            [exerciseId, req.user.id]
        );
        if (result.affectedRows === 0) {
            throw new NotFoundError("Exercise not found.");
        }
        res.json({ message: "Exercise deleted successfully" });
    } catch (error) {
        if (error.code === "ER_ROW_IS_REFERENCED_2") {
            throw new ConflictError(
                "Exercise is already used in workouts or progress entries.",
                "EXERCISE_IN_USE"
            );
        }
        throw error;
    }
});

module.exports = router;
