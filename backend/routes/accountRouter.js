const express = require("express");

const db = require("../config/db");
const { noStoreCache } = require("../middleware/httpFoundation");
const authenticateToken = require("../middleware/authMiddleware");
const { createAccountService } = require("../services/accountService");
const {
    validateChangePasswordPayload,
    validateEmailChangeConfirmPayload,
    validateEmailChangeRequestPayload
} = require("../validation/userValidation");

function createAccountRouter({
    service = createAccountService({ database: db.promise() }),
    authenticate = authenticateToken,
    rateLimiters
} = {}) {
    if (!service || typeof service !== "object") {
        throw new TypeError("Account router requires an account service.");
    }
    if (typeof authenticate !== "function") {
        throw new TypeError("Account router requires authentication middleware.");
    }
    if (!rateLimiters || typeof rateLimiters.passwordChange !== "function" ||
        typeof rateLimiters.emailChangeRequest !== "function" || typeof rateLimiters.emailChangeConfirm !== "function") {
        throw new TypeError("Account router requires passwordChange/emailChangeRequest/emailChangeConfirm rate limiters.");
    }

    const router = express.Router();
    // Passwords, sessions, and pending e-mail changes - never cacheable.
    router.use(noStoreCache);

    router.post(
        "/change-password",
        rateLimiters.passwordChange,
        authenticate,
        async (req, res) => {
            const input = validateChangePasswordPayload(req.body);
            const result = await service.changePassword(req.user.id, input);
            res.json(result);
        }
    );

    router.post(
        "/email-change-requests",
        rateLimiters.emailChangeRequest,
        authenticate,
        async (req, res) => {
            const input = validateEmailChangeRequestPayload(req.body);
            const locale = req.body?.locale === "en" ? "en" : "de";
            const result = await service.requestEmailChange(req.user.id, input, {
                requestId: req.requestId,
                locale
            });
            res.status(201).json(result);
        }
    );

    router.get(
        "/email-change-requests/current",
        authenticate,
        async (req, res) => {
            const result = await service.getCurrentEmailChangeRequest(req.user.id);
            res.json(result);
        }
    );

    router.delete(
        "/email-change-requests/current",
        authenticate,
        async (req, res) => {
            const result = await service.revokeEmailChangeRequest(req.user.id);
            res.json(result);
        }
    );

    // Public and token-only, deliberately without `authenticate`: the
    // confirmation link is delivered to the new address, which may be
    // opened in a browser session that is not logged into FitTrack at all.
    // Possession of the 256-bit token is the sole proof of ownership
    // required, exactly as studio invitation tokens work.
    router.post(
        "/email-change-confirmations",
        rateLimiters.emailChangeConfirm,
        async (req, res) => {
            const input = validateEmailChangeConfirmPayload(req.body);
            const result = await service.confirmEmailChange(input.token);
            res.json(result);
        }
    );

    return router;
}

module.exports = { createAccountRouter };
