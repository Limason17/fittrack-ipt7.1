const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../config/auth");
const { AuthenticationError } = require("../errors/AppError");

function extractBearerToken(authHeader) {
    if (typeof authHeader !== "string") {
        return null;
    }

    const match = /^Bearer\s+(\S+)$/i.exec(authHeader.trim());
    return match ? match[1] : null;
}

function authenticateToken(req, res, next) {
    const authHeader = req.headers["authorization"];
    const token = extractBearerToken(authHeader);

    if (!token) {
        next(new AuthenticationError("Access token missing or malformed."));
        return;
    }

    jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] }, (error, user) => {
        if (error || !Number.isSafeInteger(user?.id) || user.id <= 0) {
            next(new AuthenticationError("Access token is invalid or expired."));
            return;
        }

        req.user = user;
        next();
    });
}

module.exports = authenticateToken;
module.exports.extractBearerToken = extractBearerToken;
