const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../config/auth");
const { AuthenticationError } = require("../errors/AppError");
const { AuthSessionInvalidatedError } = require("../errors/AccountErrors");
const defaultDatabase = require("../config/db");

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

// Stage 3B1 introduced the authVersion claim/check (see the comment this one
// extends, kept below). Stage 3B2 adds a second claim, sessionId, binding
// every access token to one specific, independently revocable
// user_auth_sessions row - this is what makes "log out this device" /
// "log out everywhere" / refresh-token-reuse-detection able to take effect
// immediately, even though the access token itself remains a short-lived,
// stateless-to-verify JWT in between refreshes. Both checks are folded into
// a single combined query (a LEFT JOIN, not two round trips) so adding
// session validation does not double the per-request database cost.
//
// Every rejection cause below - a legacy token with no sessionId claim at
// all, a session that belongs to a different user, a session that was
// revoked (logout, logout-all, password/e-mail change, reuse-detected
// compromise), a session that expired, or a session whose own snapshotted
// auth_version has fallen behind the user's current one - collapses into
// the exact same AuthSessionInvalidatedError as a plain authVersion
// mismatch. This is deliberate: distinguishing these causes to the client
// would leak which specific security event happened without giving an
// attacker (who does not hold the token in the first place) anything
// useful, while giving a legitimate but confused client no more than
// "please log in again" ever tells them anyway.
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

        if (typeof payload.sessionId !== "string" || !SESSION_ID_PATTERN.test(payload.sessionId)) {
            next(new AuthSessionInvalidatedError());
            return;
        }

        try {
            const sql = typeof database.promise === "function" ? database.promise() : database;
            const [rows] = await sql.query(
                `SELECT u.auth_version AS user_auth_version,
                        s.status AS session_status,
                        s.expires_at AS session_expires_at,
                        s.auth_version AS session_auth_version
                 FROM users u
                 LEFT JOIN user_auth_sessions s
                     ON s.public_id = ? AND s.user_id = u.id
                 WHERE u.id = ?`,
                [payload.sessionId, payload.id]
            );

            if (rows.length === 0) {
                next(new AuthSessionInvalidatedError());
                return;
            }

            const row = rows[0];
            const userAuthVersion = Number(row.user_auth_version);
            const sessionMissing = row.session_status === null;
            const sessionInactive = !sessionMissing && row.session_status !== "active";
            const sessionExpired = !sessionMissing && new Date(row.session_expires_at).getTime() <= Date.now();
            const sessionAuthVersionStale = !sessionMissing && Number(row.session_auth_version) !== userAuthVersion;

            if (
                userAuthVersion !== payload.authVersion ||
                sessionMissing ||
                sessionInactive ||
                sessionExpired ||
                sessionAuthVersionStale
            ) {
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
