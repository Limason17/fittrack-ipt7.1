const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const { JWT_SECRET } = require("../config/auth");
const authenticateToken = require("../middleware/authMiddleware");

const router = express.Router();

function cleanString(value) {
    return typeof value === "string" ? value.trim() : "";
}

function normalizeLanguage(value) {
    return value === "en" ? "en" : "de";
}

function normalizeWeightUnit(value) {
    return value === "lb" ? "lb" : "kg";
}

function publicUser(user) {
    return {
        id: user.id,
        username: user.username,
        email: user.email,
        language_preference: normalizeLanguage(user.language_preference),
        weight_unit: normalizeWeightUnit(user.weight_unit)
    };
}

router.post("/register", async (req, res) => {
    const username = cleanString(req.body.username);
    const email = cleanString(req.body.email).toLowerCase();
    const password = req.body.password;
    const languagePreference = normalizeLanguage(
        req.body.language_preference || req.body.language
    );

    const weightUnit = normalizeWeightUnit(req.body.weight_unit);
    
    if (!username || !email || !password) {
        return res.status(400).json({ message: "Please fill in all fields" });
    }

    if (password.length < 6) {
        return res.status(400).json({
            message: "Password must be at least 6 characters long"
        });
    }

    try {
        const [existingUsers] = await db.promise().query(
            "SELECT id FROM users WHERE email = ? OR username = ?",
            [email, username]
        );

        if (existingUsers.length > 0) {
            return res.status(409).json({ message: "User already exists" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const [result] = await db.promise().query(
            `INSERT INTO users (username, email, password_hash, language_preference, weight_unit)
             VALUES (?, ?, ?, ?, ?)`,
            [username, email, hashedPassword, languagePreference, weightUnit]
        );

        res.status(201).json({
            message: "User registered successfully",
            userId: result.insertId
        });
    } catch (error) {
        res.status(500).json({ message: "Server error", error });
    }
});

router.post("/login", async (req, res) => {
    const email = cleanString(req.body.email).toLowerCase();
    const password = req.body.password;

    if (!email || !password) {
        return res.status(400).json({ message: "Please fill in all fields" });
    }

    try {
        const [users] = await db.promise().query(
            "SELECT * FROM users WHERE email = ?",
            [email]
        );

        if (users.length === 0) {
            return res.status(401).json({ message: "Invalid email or password" });
        }

        const user = users[0];
        const isMatch = await bcrypt.compare(password, user.password_hash);

        if (!isMatch) {
            return res.status(401).json({ message: "Invalid email or password" });
        }

        const token = jwt.sign(
            {
                id: user.id,
                username: user.username,
                email: user.email
            },
            JWT_SECRET,
            { expiresIn: "8h" }
        );

        res.json({
            message: "Login successful",
            token,
            user: publicUser(user)
        });
    } catch (error) {
        res.status(500).json({ message: "Server error", error });
    }
});

router.get("/me", authenticateToken, async (req, res) => {
    try {
        const [users] = await db.promise().query(
            "SELECT id, username, email, language_preference, weight_unit FROM users WHERE id = ?",
            [req.user.id]
        );

        if (users.length === 0) {
            return res.status(404).json({ message: "User not found" });
        }

        res.json(publicUser(users[0]));
    } catch (error) {
        res.status(500).json({ message: "Server error", error });
    }
});

router.put("/language", authenticateToken, async (req, res) => {
    const languagePreference = normalizeLanguage(
        req.body.language_preference || req.body.language
    );

    try {
        await db.promise().query(
            "UPDATE users SET language_preference = ? WHERE id = ?",
            [languagePreference, req.user.id]
        );

        res.json({
            message: "Language updated successfully",
            language_preference: languagePreference
        });
    } catch (error) {
        res.status(500).json({ message: "Server error", error });
    }
});

router.put("/weight-unit", authenticateToken, async (req, res) => {
    const weightUnit = normalizeWeightUnit(req.body.weight_unit);

    try {
        await db.promise().query(
            "UPDATE users SET weight_unit = ? WHERE id = ?",
            [weightUnit, req.user.id]
        );

        res.json({
            message: "Weight unit updated successfully",
            weight_unit: weightUnit
        });
    } catch (error) {
        res.status(500).json({ message: "Server error", error });
    }
});

module.exports = router;
