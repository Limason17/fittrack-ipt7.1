const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../config/db");
const authenticateToken = require("../middleware/authMiddleware");
const { createRateLimiters } = require("../middleware/rateLimiter");
const { createMySqlRateLimitStore } = require("../rateLimiting/mysqlRateLimitStore");
const { createSessionService } = require("../services/sessionService");
const { setSessionCookies } = require("../security/sessionCookies");
const { signAccessToken } = require("../security/accessTokens");
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
} = createRateLimiters({ store: createMySqlRateLimitStore({ database: db.promise() }) });

const sessionService = createSessionService({ database: db.promise() });

// Precomputed once at module load, never regenerated per request: this is
// what makes the login-timing hardening below actually hold. If the dummy
// hash were generated fresh on every "user not found" request, bcrypt's own
// per-hash random salt generation would still cost real (if tiny and
// non-password-dependent) time, but more importantly the intent here is a
// fixed comparison target - a stable value bcrypt.compare can be run
// against on the not-found path with the exact same cost factor as a real
// user's stored hash, so total request latency does not depend on whether
// the e-mail address exists.
const LOGIN_TIMING_DUMMY_HASH = bcrypt.hashSync(
    "fittrack-login-timing-hardening-dummy-password",
    10
);

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

    // Both branches always run one bcrypt.compare() at the exact same cost
    // factor (10) - an unknown e-mail address compares against the fixed
    // module-load-time dummy hash instead of skipping the check, so total
    // request latency does not leak whether the account exists. Both
    // failure paths also throw the exact same error with the exact same
    // message; only after this point does anything branch on `user` at all.
    const user = users[0];
    const isMatch = await bcrypt.compare(input.password, user ? user.password_hash : LOGIN_TIMING_DUMMY_HASH);

    if (!user || !isMatch) {
        throw new AuthenticationError("Invalid email or password.");
    }

    const session = await sessionService.startSession(user.id, { authVersion: user.auth_version });
    setSessionCookies(res, { refreshToken: session.refreshToken, csrfToken: session.csrfToken });
    const accessToken = signAccessToken({
        id: user.id,
        authVersion: user.auth_version,
        sessionId: session.sessionId
    });

    res.json({
        message: "Login successful",
        // Deliberately kept as `token`, not `accessToken`, even though this
        // is now a short-lived Stage 3B2 access token backed by a session -
        // renaming it would ripple into every existing backend integration
        // test and frontend caller that reads response.data.token for no
        // functional benefit. The new /api/auth/refresh endpoint has no
        // legacy readers, so its response uses the clearer `accessToken`
        // name instead; the frontend auth store normalizes both to the
        // same in-memory token on read.
        token: accessToken,
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
