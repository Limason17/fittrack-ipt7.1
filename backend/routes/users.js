const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("../config/db");

const router = express.Router();

// REGISTER
router.post("/register", async (req, res) => {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
        return res.status(400).json({ message: "Please fill in all fields" });
    }

    const checkSql = "SELECT * FROM users WHERE email = ? OR username = ?";

    db.query(checkSql, [email, username], async (err, results) => {
        if (err) {
            return res.status(500).json({ message: "Database error", error: err });
        }

        if (results.length > 0) {
            return res.status(409).json({ message: "User already exists" });
        }

        try {
            const hashedPassword = await bcrypt.hash(password, 10);

            const insertSql =
                "INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)";

            db.query(insertSql, [username, email, hashedPassword], (err, result) => {
                if (err) {
                    return res.status(500).json({ message: "Error creating user", error: err });
                }

                res.status(201).json({
                    message: "User registered successfully",
                    userId: result.insertId
                });
            });
        } catch (error) {
            return res.status(500).json({ message: "Server error", error });
        }
    });
});
