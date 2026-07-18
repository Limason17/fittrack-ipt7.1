const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const { JWT_SECRET } = require("../config/auth");
const authenticateToken = require("../middleware/authMiddleware");
const { createAuthRateLimiters } = require("../middleware/rateLimiter");
const {
    AuthenticationError,
    ConflictError,
    NotFoundError,
    ValidationError
} = require("../errors/AppError");
const {
    validateLoginPayload,
    validateRegistrationPayload
} = require("../validation/userValidation");

const router = express.Router();

const {
    login: loginRateLimiter,
    registration: registrationRateLimiter
} = createAuthRateLimiters();

function normalizeLanguage(value) {
    return value === "en" ? "en" : "de";
}

function normalizeWeightUnit(value) {
    return value === "lb" ? "lb" : "kg";
}

function normalizeDistanceUnit(value) {
    return value === "mi" ? "mi" : "km";
}

function publicUser(user) {
    return {
        id: user.id,
        username: user.username,
        email: user.email,
        language_preference: normalizeLanguage(user.language_preference),
        weight_unit: normalizeWeightUnit(user.weight_unit),
        distance_unit: normalizeDistanceUnit(user.distance_unit)
    };
}

router.post("/register", registrationRateLimiter, async (req, res) => {
    const input = validateRegistrationPayload(req.body);

    const [existingUsers] = await db.promise().query(
        "SELECT id FROM users WHERE email = ? OR username = ?",
        [input.email, input.username]
    );

    if (existingUsers.length > 0) {
        throw new ConflictError("User already exists.", "USER_ALREADY_EXISTS");
    }

    const hashedPassword = await bcrypt.hash(input.password, 10);

    try {
        const [result] = await db.promise().query(
            `INSERT INTO users (username, email, password_hash, language_preference, weight_unit, distance_unit)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                input.username,
                input.email,
                hashedPassword,
                input.language_preference,
                input.weight_unit,
                input.distance_unit
            ]
        );

        res.status(201).json({
            message: "User registered successfully",
            userId: result.insertId
        });
    } catch (error) {
        if (error.code === "ER_DUP_ENTRY") {
            throw new ConflictError("User already exists.", "USER_ALREADY_EXISTS");
        }
        throw error;
    }
});

router.post("/login", loginRateLimiter, async (req, res) => {
    const input = validateLoginPayload(req.body);
    const [users] = await db.promise().query(
        "SELECT * FROM users WHERE email = ?",
        [input.email]
    );

    if (users.length === 0) {
        throw new AuthenticationError("Invalid email or password.");
    }

    const user = users[0];
    const isMatch = await bcrypt.compare(input.password, user.password_hash);

    if (!isMatch) {
        throw new AuthenticationError("Invalid email or password.");
    }

    const token = jwt.sign(
        { id: user.id },
        JWT_SECRET,
        { algorithm: "HS256", expiresIn: "8h" }
    );

    res.json({
        message: "Login successful",
        token,
        user: publicUser(user)
    });
});

router.get("/me", authenticateToken, async (req, res) => {
    const [users] = await db.promise().query(
        "SELECT id, username, email, language_preference, weight_unit, distance_unit FROM users WHERE id = ?",
        [req.user.id]
    );

    if (users.length === 0) {
        throw new NotFoundError("User not found.");
    }

    res.json(publicUser(users[0]));
});

function validatePreference(value, field, allowed) {
    if (typeof value !== "string" || !allowed.includes(value)) {
        throw new ValidationError({
            [field]: `Allowed values are: ${allowed.join(", ")}.`
        });
    }
    return value;
}

router.put("/language", authenticateToken, async (req, res) => {
    const languagePreference = validatePreference(
        req.body.language_preference ?? req.body.language,
        "language_preference",
        ["de", "en"]
    );
    const [result] = await db.promise().query(
        "UPDATE users SET language_preference = ? WHERE id = ?",
        [languagePreference, req.user.id]
    );
    if (result.affectedRows === 0) throw new NotFoundError("User not found.");
    res.json({
        message: "Language updated successfully",
        language_preference: languagePreference
    });
});

router.put("/weight-unit", authenticateToken, async (req, res) => {
    const weightUnit = validatePreference(req.body.weight_unit, "weight_unit", ["kg", "lb"]);
    const [result] = await db.promise().query(
        "UPDATE users SET weight_unit = ? WHERE id = ?",
        [weightUnit, req.user.id]
    );
    if (result.affectedRows === 0) throw new NotFoundError("User not found.");
    res.json({
        message: "Weight unit updated successfully",
        weight_unit: weightUnit
    });
});

router.put("/distance-unit", authenticateToken, async (req, res) => {
    const distanceUnit = validatePreference(req.body.distance_unit, "distance_unit", ["km", "mi"]);
    const [result] = await db.promise().query(
        "UPDATE users SET distance_unit = ? WHERE id = ?",
        [distanceUnit, req.user.id]
    );
    if (result.affectedRows === 0) throw new NotFoundError("User not found.");
    res.json({
        message: "Distance unit updated successfully",
        distance_unit: distanceUnit
    });
});

module.exports = router;
