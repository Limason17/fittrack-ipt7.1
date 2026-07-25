const express = require("express");

const authenticateToken = require("../middleware/authMiddleware");
const { createOriginGuard } = require("../security/originGuard");
const { createCsrfGuard } = require("../security/csrfGuard");
const { setSessionCookies, clearSessionCookies } = require("../security/sessionCookies");
const { signAccessToken } = require("../security/accessTokens");
const { SESSION_CONFIG } = require("../config/sessionConfig");
const {
    AuthCsrfInvalidError,
    AuthRefreshReuseDetectedError,
    AuthRefreshTokenExpiredError,
    AuthRefreshTokenInvalidError
} = require("../errors/SessionErrors");

// Errors that mean the presented refresh cookie can never be used again -
// the cookies are cleared before the error is forwarded to the client, so a
// browser retry cannot loop on a dead cookie.
const REFRESH_TERMINAL_ERRORS = [
    AuthRefreshTokenInvalidError,
    AuthRefreshTokenExpiredError,
    AuthRefreshReuseDetectedError
];

function createAuthSessionRouter({
    sessionService,
    authenticate = authenticateToken,
    config = SESSION_CONFIG,
    verifyOrigin = createOriginGuard(),
    verifyCsrf = createCsrfGuard({ config })
} = {}) {
    if (!sessionService || typeof sessionService.rotateRefreshToken !== "function") {
        throw new TypeError("Auth session router requires a session service.");
    }

    const router = express.Router();

    router.post("/refresh", verifyOrigin, verifyCsrf, async (req, res, next) => {
        const refreshToken = req.cookies?.[config.refreshCookieName];
        const csrfHeaderToken = req.headers["x-csrf-token"];

        if (typeof refreshToken !== "string" || !refreshToken) {
            next(new AuthRefreshTokenInvalidError());
            return;
        }
        if (typeof csrfHeaderToken !== "string" || !csrfHeaderToken) {
            next(new AuthCsrfInvalidError());
            return;
        }

        try {
            const rotated = await sessionService.rotateRefreshToken(refreshToken, csrfHeaderToken);
            setSessionCookies(res, { refreshToken: rotated.refreshToken, csrfToken: rotated.csrfToken }, config);
            const accessToken = signAccessToken(
                { id: rotated.userId, authVersion: rotated.authVersion, sessionId: rotated.sessionId },
                config
            );
            res.json({ accessToken });
        } catch (error) {
            if (REFRESH_TERMINAL_ERRORS.some((ErrorClass) => error instanceof ErrorClass)) {
                clearSessionCookies(res, config);
            }
            next(error);
        }
    });

    router.post("/logout", authenticate, verifyOrigin, verifyCsrf, async (req, res) => {
        // Idempotent by construction: revokeSession only updates rows whose
        // status is still 'active', so a repeated call after the session
        // was already revoked (by this same call, or by logout-all, or a
        // password/e-mail change in the meantime) simply matches zero rows
        // and still reports success - there is no "already logged out"
        // error state to document beyond "logout always succeeds".
        await sessionService.revokeSession(req.user.sessionId, req.user.id, "logout");
        clearSessionCookies(res, config);
        res.json({ message: "Logged out." });
    });

    router.post("/logout-all", authenticate, verifyOrigin, verifyCsrf, async (req, res) => {
        await sessionService.logoutAll(req.user.id, "logout_all");
        clearSessionCookies(res, config);
        res.json({ message: "Logged out of all devices." });
    });

    return router;
}

module.exports = { createAuthSessionRouter };
