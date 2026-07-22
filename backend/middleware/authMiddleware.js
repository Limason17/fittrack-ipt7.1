const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../config/auth");
const { AuthenticationError } = require("../errors/AppError");
const { AuthSessionInvalidatedError } = require("../errors/AccountErrors");
const defaultDatabase = require("../config/db");

function extractBearerToken(authHeader) {
    if (typeof authHeader !== "string") {
        return null;
    }

    const match = /^Bearer\s+(\S+)$/i.exec(authHeader.trim());
    return match ? match[1] : null;
}

function verifyToken(token) {
    return new Promise((resolve, reject) => {
        jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] }, (error, payload) => {
            if (error) reject(error);
            else resolve(payload);
        });
    });
}

// Stage 3B1: every authenticated request now also confirms the JWT's
// authVersion claim still matches users.auth_version - one extra indexed
// primary-key lookup per request, traded for the ability to durably
// invalidate every token issued before a password change or a confirmed
// e-mail change, without a server-side session/refresh-token store. A
// token issued before this feature shipped carries no authVersion claim at
// all; that compares unequal to any real column value and is rejected the
// same uniform way as a genuine version bump - a clear, one-time
// re-authentication after deploying this migration is acceptable, not a
// bug. The rejection deliberately never distinguishes "your token predates
// this feature", "your password changed", "your e-mail changed" or "your
// account no longer exists" from one another - all four collapse into the
// same AuthSessionInvalidatedError, exactly as a malformed/expired
// signature collapses into the same AuthenticationError it always has.
function createAuthenticateToken({ database = defaultDatabase } = {}) {
    return async function authenticateToken(req, res, next) {
        const authHeader = req.headers["authorization"];
        const token = extractBearerToken(authHeader);

        if (!token) {
            next(new AuthenticationError("Access token missing or malformed."));
            return;
        }

        let payload;
        try {
            payload = await verifyToken(token);
        } catch {
            next(new AuthenticationError("Access token is invalid or expired."));
            return;
        }

        if (!Number.isSafeInteger(payload?.id) || payload.id <= 0) {
            next(new AuthenticationError("Access token is invalid or expired."));
            return;
        }

        if (!Number.isSafeInteger(payload.authVersion) || payload.authVersion <= 0) {
            next(new AuthSessionInvalidatedError());
            return;
        }

        try {
            const sql = typeof database.promise === "function" ? database.promise() : database;
            const [rows] = await sql.query(
                "SELECT auth_version FROM users WHERE id = ?",
                [payload.id]
            );
            if (rows.length === 0 || Number(rows[0].auth_version) !== payload.authVersion) {
                next(new AuthSessionInvalidatedError());
                return;
            }
        } catch (error) {
            next(error);
            return;
        }

        req.user = payload;
        next();
    };
}

const authenticateToken = createAuthenticateToken();

module.exports = authenticateToken;
module.exports.createAuthenticateToken = createAuthenticateToken;
module.exports.extractBearerToken = extractBearerToken;
