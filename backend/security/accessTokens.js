const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../config/auth");
const { SESSION_CONFIG } = require("../config/sessionConfig");

// Shared by the login route (routes/users.js) and the refresh endpoint
// (routes/authSessionRouter.js) so both mint access tokens with an
// identical claim/TTL contract - see middleware/authMiddleware.js for what
// verifies { id, authVersion, sessionId } on every protected request.
function signAccessToken({ id, authVersion, sessionId }, config = SESSION_CONFIG, secret = JWT_SECRET) {
    return jwt.sign(
        { id, authVersion, sessionId },
        secret,
        { algorithm: "HS256", expiresIn: `${config.accessTokenTtlMinutes}m` }
    );
}

module.exports = { signAccessToken };
