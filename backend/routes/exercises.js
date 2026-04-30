const express = require("express");
const db = require("../config/db");
const authenticateToken = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/", authenticateToken, (req, res) => {
    const { category, muscle_group } = req.query;

    let sql = `
        SELECT id, user_id, name, description, category, muscle_group, image_url, created_at
        FROM exercises
        WHERE (user_id = ? OR user_id IS NULL)
    `;

    const queryParams = [req.user.id];

    if (category) {
        sql += ` AND category = ?`;
        queryParams.push(category);
    }

    if (muscle_group) {
        sql += ` AND muscle_group = ?`;
        queryParams.push(muscle_group);
    }

    sql += ` ORDER BY created_at DESC`;

    db.query(sql, queryParams, (err, results) => {
        if (err) {
            return res.status(500).json({
                message: "Error loading exercises",
                error: err
            });
        }

        res.json(results);
    });
});

// Neue Übung für eingeloggten User erstellen
router.post("/", authenticateToken, (req, res) => {
    const { name, description, category, muscle_group, image_url } = req.body;

    if (!name || !category || !muscle_group) {
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
            muscle_group,
            image_url || null
        ],
        (err, result) => {
            if (err) {
                return res.status(500).json({
                    message: "Error creating exercise",
                    error: err
                });
            }

            res.status(201).json({
                message: "Exercise created successfully",
                exerciseId: result.insertId
            });
        }
    );
});

module.exports = router;