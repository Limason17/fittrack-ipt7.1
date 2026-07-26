const { normalizeEmail } = require("./rateLimitKeys");
const { resolveClientIp } = require("../security/clientIp");

// Central inventory (Section 9): every policy's identity, limit, window, key
// strategy and error code lives here, in one place, instead of scattered
// across each router. Each policy's `buildKey(req)` returns the RAW string
// identifier before HMAC hashing (see rateLimiting/rateLimitKeys.js's
// hashRateLimitKey) - never persisted or logged in this raw form.
//
// | Policy               | Limit | Window | Key strategy                          | Why
// |-----------------------|------|--------|----------------------------------------|----
// | auth.login             | 10   | 15 min | e-mail + client IP                     | bounds brute-force against one credential pair; keeping the existing default limit unchanged (see rateLimiter.test.js history) so it does not newly break login UX under normal retry behaviour
// | auth.registration       | 5    | 60 min | client IP                              | unchanged from Stage 1/3B behaviour
// | auth.refresh            | 30   | 5 min  | client IP                              | new - refresh had no limiter at all before Stage 3D; sized generously so the Stage 3C cross-tab lock's normal single-flight refreshes (including the accessibility suite's 17 sequential reloads and the two-tab race test's 20 repeats) never trip it
// | auth.logoutAll          | 10   | 15 min | authenticated user ID                  | new - logout-all had no limiter before; authenticated, low real abuse risk, limit only guards against a scripting mistake spamming it
// | account.passwordChange  | 5    | 60 min | authenticated user ID                  | unchanged
// | account.emailChangeRequest | 5 | 60 min | authenticated user ID                  | unchanged
// | account.emailChangeConfirm | 20| 15 min | client IP                              | unchanged; public token endpoint - keyed by IP, never by the token itself (Section 7)
// | invitation.create       | 50   | 60 min | actor user ID + studio ID               | new - invitation creation had no limiter before; generous enough for normal studio-admin bulk-inviting and existing integration test flows
// | invitation.resend       | 5    | 15 min | actor user ID + invitation ID           | unchanged (Stage 3C hardening kept this exact key strategy and limit)
// | invitation.accept       | 20   | 60 min | authenticated user ID                   | new - invitation acceptance had no limiter before; authenticated, generous
function positiveInteger(value, fallback, name) {
    if (value === undefined || value === null || value === "") {
        return fallback;
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new TypeError(`${name} must be a positive integer.`);
    }
    return parsed;
}

function envWindowMax(env, prefix, fallbackWindowMs, fallbackMax) {
    return {
        windowMs: positiveInteger(env[`${prefix}_WINDOW_MS`], fallbackWindowMs, `${prefix}_WINDOW_MS`),
        max: positiveInteger(env[`${prefix}_MAX`], fallbackMax, `${prefix}_MAX`)
    };
}

function loginKey(req) {
    const email = normalizeEmail(req.body?.email);
    return `login|${email}|${resolveClientIp(req)}`;
}

function registrationKey(req) {
    return `registration|${resolveClientIp(req)}`;
}

function refreshKey(req) {
    return `refresh|${resolveClientIp(req)}`;
}

function userKey(scope) {
    return (req) => `${scope}|user:${req.user?.id ?? "anon"}`;
}

function emailChangeConfirmKey(req) {
    return `email-change-confirm|${resolveClientIp(req)}`;
}

function invitationCreateKey(req) {
    return `invitation-create|actor:${req.user?.id ?? "anon"}|studio:${req.params?.studioId ?? ""}`;
}

function invitationResendKey(req) {
    return `invitation-resend|actor:${req.user?.id ?? "anon"}|invitation:${req.params?.invitationId ?? ""}`;
}

function invitationAcceptKey(req) {
    return `invitation-accept|actor:${req.user?.id ?? "anon"}`;
}

function createRateLimitPolicies(options = {}) {
    const env = options.env || process.env;

    const login = envWindowMax(env, "AUTH_LOGIN_RATE_LIMIT", 15 * 60 * 1000, 10);
    const registration = envWindowMax(env, "AUTH_REGISTRATION_RATE_LIMIT", 60 * 60 * 1000, 5);
    const refresh = envWindowMax(env, "AUTH_REFRESH_RATE_LIMIT", 5 * 60 * 1000, 30);
    const logoutAll = envWindowMax(env, "AUTH_LOGOUT_ALL_RATE_LIMIT", 15 * 60 * 1000, 10);
    const passwordChange = envWindowMax(env, "AUTH_PASSWORD_CHANGE_RATE_LIMIT", 60 * 60 * 1000, 5);
    const emailChangeRequest = envWindowMax(env, "AUTH_EMAIL_CHANGE_RATE_LIMIT", 60 * 60 * 1000, 5);
    const emailChangeConfirm = envWindowMax(env, "AUTH_EMAIL_CHANGE_CONFIRM_RATE_LIMIT", 15 * 60 * 1000, 20);
    const invitationCreate = envWindowMax(env, "INVITATION_CREATE_RATE_LIMIT", 60 * 60 * 1000, 50);
    const invitationResend = envWindowMax(env, "INVITATION_RESEND_RATE_LIMIT", 15 * 60 * 1000, 5);
    const invitationAccept = envWindowMax(env, "INVITATION_ACCEPT_RATE_LIMIT", 60 * 60 * 1000, 20);

    return {
        "auth.login": { id: "auth.login", ...login, code: "RATE_LIMIT_EXCEEDED", buildKey: loginKey },
        "auth.registration": { id: "auth.registration", ...registration, code: "RATE_LIMIT_EXCEEDED", buildKey: registrationKey },
        "auth.refresh": { id: "auth.refresh", ...refresh, code: "RATE_LIMIT_EXCEEDED", buildKey: refreshKey },
        "auth.logoutAll": { id: "auth.logoutAll", ...logoutAll, code: "RATE_LIMIT_EXCEEDED", buildKey: userKey("logout-all") },
        "account.passwordChange": { id: "account.passwordChange", ...passwordChange, code: "RATE_LIMIT_EXCEEDED", buildKey: userKey("password-change") },
        "account.emailChangeRequest": { id: "account.emailChangeRequest", ...emailChangeRequest, code: "RATE_LIMIT_EXCEEDED", buildKey: userKey("email-change-request") },
        "account.emailChangeConfirm": { id: "account.emailChangeConfirm", ...emailChangeConfirm, code: "RATE_LIMIT_EXCEEDED", buildKey: emailChangeConfirmKey },
        "invitation.create": { id: "invitation.create", ...invitationCreate, code: "RATE_LIMIT_EXCEEDED", buildKey: invitationCreateKey },
        "invitation.resend": { id: "invitation.resend", ...invitationResend, code: "INVITATION_RESEND_RATE_LIMITED", buildKey: invitationResendKey },
        "invitation.accept": { id: "invitation.accept", ...invitationAccept, code: "RATE_LIMIT_EXCEEDED", buildKey: invitationAcceptKey }
    };
}

module.exports = { createRateLimitPolicies, positiveInteger };
