const { RateLimitError } = require("../errors/AppError");
const { RateLimitBackendUnavailableError, RateLimitStoreUnavailableError } = require("../errors/RateLimitErrors");
const { RATE_LIMIT_KEY_SECRET } = require("../config/rateLimitConfig");
const { hashRateLimitKey } = require("../rateLimiting/rateLimitKeys");
const { createRateLimitPolicies } = require("../rateLimiting/rateLimitPolicies");

// Builds one Express middleware for exactly one policy against exactly one
// store. The store is always injected - there is no default here, and
// deliberately no fallback if the given store throws
// RateLimitStoreUnavailableError: Section 10's contract is fail-closed, not
// "try memory instead". `now` is injectable for deterministic tests; the
// real app always uses Date.now (the default).
function createRateLimitMiddleware({ policy, store, keySecret = RATE_LIMIT_KEY_SECRET, now = Date.now }) {
    if (!policy || typeof policy.buildKey !== "function" || typeof policy.id !== "string") {
        throw new TypeError("createRateLimitMiddleware requires a policy with an id and buildKey().");
    }
    if (!store || typeof store.consume !== "function") {
        throw new TypeError("createRateLimitMiddleware requires a rate limit store with consume().");
    }

    return async function rateLimitMiddleware(req, res, next) {
        let outcome;
        try {
            const rawKey = policy.buildKey(req);
            const keyHash = hashRateLimitKey(keySecret, rawKey);
            outcome = await store.consume({
                policyId: policy.id,
                keyHash,
                windowMs: policy.windowMs,
                max: policy.max,
                now: now()
            });
        } catch (error) {
            if (error instanceof RateLimitStoreUnavailableError) {
                // Section 18: policy ID, outcome and request ID only - never
                // the raw key, the SQL error text, or any request body.
                const logger = req.app?.locals?.logger;
                logger?.error?.("rate_limit_store_unavailable", {
                    requestId: req.requestId,
                    policyId: policy.id
                });
                next(new RateLimitBackendUnavailableError());
                return;
            }
            next(error);
            return;
        }

        res.setHeader("RateLimit-Limit", String(policy.max));
        res.setHeader("RateLimit-Remaining", String(outcome.remaining));
        res.setHeader("RateLimit-Reset", String(Math.ceil(outcome.resetAt / 1000)));

        if (!outcome.allowed) {
            res.setHeader("Retry-After", String(outcome.retryAfterSeconds));
            const logger = req.app?.locals?.logger;
            // Section 18: an expected 429 is not a warning-worthy anomaly on
            // its own (it is the limiter working as designed) - logged at
            // info, not warn/error, to avoid alert/log spam for expected
            // traffic shaping.
            logger?.info?.("rate_limit_exceeded", {
                requestId: req.requestId,
                policyId: policy.id,
                retryAfterSeconds: outcome.retryAfterSeconds
            });
            next(new RateLimitError(undefined, policy.code));
            return;
        }
        next();
    };
}

// Builds the complete set of rate-limit middleware the application needs,
// all sharing one store instance (see rateLimiting/mysqlRateLimitStore.js in
// the real app, rateLimiting/memoryRateLimitStore.js in isolated unit
// tests - see that file's own header comment for why the real app must
// never use it). `store` is required: there is no parameterless default,
// so every caller (the composition root, every test) is explicit about
// which store backs its rate limiting - see docs/STAGE_3D_SECURITY_HARDENING.md.
function createRateLimiters({ store, env = process.env, keySecret = RATE_LIMIT_KEY_SECRET, now = Date.now, policies } = {}) {
    if (!store || typeof store.consume !== "function") {
        throw new TypeError("createRateLimiters requires a rate limit store with consume().");
    }
    const resolvedPolicies = policies || createRateLimitPolicies({ env });
    const middlewareFor = (policyId) => createRateLimitMiddleware({
        policy: resolvedPolicies[policyId],
        store,
        keySecret,
        now
    });

    return {
        login: middlewareFor("auth.login"),
        registration: middlewareFor("auth.registration"),
        refresh: middlewareFor("auth.refresh"),
        logoutAll: middlewareFor("auth.logoutAll"),
        passwordChange: middlewareFor("account.passwordChange"),
        emailChangeRequest: middlewareFor("account.emailChangeRequest"),
        emailChangeConfirm: middlewareFor("account.emailChangeConfirm"),
        invitationCreate: middlewareFor("invitation.create"),
        invitationResend: middlewareFor("invitation.resend"),
        invitationAccept: middlewareFor("invitation.accept"),
        policies: resolvedPolicies
    };
}

module.exports = {
    createRateLimitMiddleware,
    createRateLimiters
};
