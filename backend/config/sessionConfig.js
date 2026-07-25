// Mirrors config/auth.js's contract exactly: a pure function taking an
// injectable env (test seam), called once eagerly at module-require time so
// a bad configuration fails the process at startup, not on the first
// request. See that file's own comment history for why this "fail fast at
// composition time" convention exists.

const PLACEHOLDER_COOKIE_NAMES = new Set(["", "cookie", "token", "session"]);

function sessionConfigError(message) {
    const error = new Error(message);
    error.code = "INVALID_SESSION_CONFIG";
    return error;
}

function integerInRange(value, fallback, name, { min, max }) {
    if (value === undefined || value === null || value === "") {
        return fallback;
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        throw sessionConfigError(`${name} must be an integer between ${min} and ${max}.`);
    }
    return parsed;
}

function cookieName(value, fallback, name) {
    if (value === undefined || value === null || value === "") {
        return fallback;
    }
    const trimmed = String(value).trim();
    if (!/^[A-Za-z0-9_]{1,64}$/.test(trimmed) || PLACEHOLDER_COOKIE_NAMES.has(trimmed.toLowerCase())) {
        throw sessionConfigError(`${name} must be 1-64 letters/digits/underscore and not a placeholder value.`);
    }
    return trimmed;
}

function readSessionConfig(env = process.env) {
    const production = env.NODE_ENV === "production";

    const accessTokenTtlMinutes = integerInRange(
        env.AUTH_ACCESS_TOKEN_TTL_MINUTES, 15, "AUTH_ACCESS_TOKEN_TTL_MINUTES", { min: 5, max: 60 }
    );
    const refreshTokenTtlDays = integerInRange(
        env.AUTH_REFRESH_TOKEN_TTL_DAYS, 7, "AUTH_REFRESH_TOKEN_TTL_DAYS", { min: 1, max: 30 }
    );
    const maxActiveSessions = integerInRange(
        env.AUTH_MAX_ACTIVE_SESSIONS, 10, "AUTH_MAX_ACTIVE_SESSIONS", { min: 1, max: 100 }
    );

    const refreshCookieName = cookieName(
        env.AUTH_REFRESH_COOKIE_NAME, "fittrack_refresh", "AUTH_REFRESH_COOKIE_NAME"
    );
    const csrfCookieName = cookieName(
        env.AUTH_CSRF_COOKIE_NAME, "fittrack_csrf", "AUTH_CSRF_COOKIE_NAME"
    );
    if (refreshCookieName === csrfCookieName) {
        throw sessionConfigError("AUTH_REFRESH_COOKIE_NAME and AUTH_CSRF_COOKIE_NAME must be different.");
    }

    // Secure defaults to whether this is a production process, exactly like
    // every other prod/non-prod branch in this codebase - but production can
    // never override it to false: a real deployment forgetting to also set
    // AUTH_COOKIE_SECURE=true should fail to start, not silently ship an
    // insecure cookie. Non-production may still explicitly force secure=true
    // (e.g. to test an HTTPS-fronted local reverse proxy).
    let cookieSecure;
    if (env.AUTH_COOKIE_SECURE === undefined || env.AUTH_COOKIE_SECURE === "") {
        cookieSecure = production;
    } else if (env.AUTH_COOKIE_SECURE === "true") {
        cookieSecure = true;
    } else if (env.AUTH_COOKIE_SECURE === "false") {
        cookieSecure = false;
    } else {
        throw sessionConfigError("AUTH_COOKIE_SECURE must be exactly \"true\" or \"false\" when set.");
    }
    if (production && !cookieSecure) {
        throw sessionConfigError("AUTH_COOKIE_SECURE must not be \"false\" in production.");
    }

    const sameSite = env.AUTH_COOKIE_SAME_SITE || "strict";
    if (!["strict", "lax", "none"].includes(sameSite)) {
        throw sessionConfigError("AUTH_COOKIE_SAME_SITE must be one of: strict, lax, none.");
    }
    if (sameSite === "none" && !cookieSecure) {
        throw sessionConfigError("AUTH_COOKIE_SAME_SITE=none requires AUTH_COOKIE_SECURE=true.");
    }

    return Object.freeze({
        production,
        accessTokenTtlMinutes,
        refreshTokenTtlDays,
        maxActiveSessions,
        refreshCookieName,
        csrfCookieName,
        cookieSecure,
        cookieSameSite: sameSite
    });
}

const SESSION_CONFIG = readSessionConfig();

module.exports = {
    SESSION_CONFIG,
    readSessionConfig
};
