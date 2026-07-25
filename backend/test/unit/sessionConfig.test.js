const test = require("node:test");
const assert = require("node:assert/strict");

const { readSessionConfig } = require("../../config/sessionConfig");

function throwsWithCode(fn, code) {
    assert.throws(fn, (error) => error.code === code);
}

test("defaults are safe for a non-production environment", () => {
    const config = readSessionConfig({});
    assert.equal(config.accessTokenTtlMinutes, 15);
    assert.equal(config.refreshTokenTtlDays, 7);
    assert.equal(config.maxActiveSessions, 10);
    assert.equal(config.refreshCookieName, "fittrack_refresh");
    assert.equal(config.csrfCookieName, "fittrack_csrf");
    assert.equal(config.cookieSecure, false);
    assert.equal(config.cookieSameSite, "strict");
});

test("accessTokenTtlMinutes is bounded to 5-60", () => {
    throwsWithCode(() => readSessionConfig({ AUTH_ACCESS_TOKEN_TTL_MINUTES: "4" }), "INVALID_SESSION_CONFIG");
    throwsWithCode(() => readSessionConfig({ AUTH_ACCESS_TOKEN_TTL_MINUTES: "61" }), "INVALID_SESSION_CONFIG");
    assert.equal(readSessionConfig({ AUTH_ACCESS_TOKEN_TTL_MINUTES: "5" }).accessTokenTtlMinutes, 5);
    assert.equal(readSessionConfig({ AUTH_ACCESS_TOKEN_TTL_MINUTES: "60" }).accessTokenTtlMinutes, 60);
});

test("refreshTokenTtlDays is bounded to 1-30", () => {
    throwsWithCode(() => readSessionConfig({ AUTH_REFRESH_TOKEN_TTL_DAYS: "0" }), "INVALID_SESSION_CONFIG");
    throwsWithCode(() => readSessionConfig({ AUTH_REFRESH_TOKEN_TTL_DAYS: "31" }), "INVALID_SESSION_CONFIG");
    assert.equal(readSessionConfig({ AUTH_REFRESH_TOKEN_TTL_DAYS: "1" }).refreshTokenTtlDays, 1);
    assert.equal(readSessionConfig({ AUTH_REFRESH_TOKEN_TTL_DAYS: "30" }).refreshTokenTtlDays, 30);
});

test("maxActiveSessions is bounded to 1-100", () => {
    throwsWithCode(() => readSessionConfig({ AUTH_MAX_ACTIVE_SESSIONS: "0" }), "INVALID_SESSION_CONFIG");
    throwsWithCode(() => readSessionConfig({ AUTH_MAX_ACTIVE_SESSIONS: "101" }), "INVALID_SESSION_CONFIG");
});

test("known placeholder cookie names are rejected (case-insensitively)", () => {
    for (const placeholder of ["cookie", "token", "session", "COOKIE"]) {
        throwsWithCode(
            () => readSessionConfig({ AUTH_REFRESH_COOKIE_NAME: placeholder, AUTH_CSRF_COOKIE_NAME: "fittrack_csrf" }),
            "INVALID_SESSION_CONFIG"
        );
    }
    throwsWithCode(() => readSessionConfig({ AUTH_REFRESH_COOKIE_NAME: "has a space" }), "INVALID_SESSION_CONFIG");
    throwsWithCode(() => readSessionConfig({ AUTH_REFRESH_COOKIE_NAME: "x".repeat(65) }), "INVALID_SESSION_CONFIG");
});

test("an empty/unset cookie-name env var falls back to the safe default rather than being treated as a placeholder", () => {
    const config = readSessionConfig({ AUTH_REFRESH_COOKIE_NAME: "" });
    assert.equal(config.refreshCookieName, "fittrack_refresh");
});

test("refresh and CSRF cookie names must differ", () => {
    throwsWithCode(
        () => readSessionConfig({ AUTH_REFRESH_COOKIE_NAME: "same_name", AUTH_CSRF_COOKIE_NAME: "same_name" }),
        "INVALID_SESSION_CONFIG"
    );
});

test("production requires AUTH_COOKIE_SECURE to not be explicitly false", () => {
    throwsWithCode(
        () => readSessionConfig({ NODE_ENV: "production", AUTH_COOKIE_SECURE: "false" }),
        "INVALID_SESSION_CONFIG"
    );
    const config = readSessionConfig({ NODE_ENV: "production", AUTH_COOKIE_SECURE: "true" });
    assert.equal(config.cookieSecure, true);
});

test("production defaults cookieSecure to true without needing an explicit override", () => {
    const config = readSessionConfig({ NODE_ENV: "production" });
    assert.equal(config.cookieSecure, true);
});

test("AUTH_COOKIE_SECURE must be exactly \"true\" or \"false\" when set", () => {
    throwsWithCode(() => readSessionConfig({ AUTH_COOKIE_SECURE: "yes" }), "INVALID_SESSION_CONFIG");
});

test("AUTH_COOKIE_SAME_SITE must be one of strict/lax/none", () => {
    throwsWithCode(() => readSessionConfig({ AUTH_COOKIE_SAME_SITE: "loose" }), "INVALID_SESSION_CONFIG");
    assert.equal(readSessionConfig({ AUTH_COOKIE_SAME_SITE: "lax" }).cookieSameSite, "lax");
});

test("SameSite=none requires Secure=true", () => {
    throwsWithCode(
        () => readSessionConfig({ AUTH_COOKIE_SAME_SITE: "none", AUTH_COOKIE_SECURE: "false" }),
        "INVALID_SESSION_CONFIG"
    );
    const config = readSessionConfig({ AUTH_COOKIE_SAME_SITE: "none", AUTH_COOKIE_SECURE: "true" });
    assert.equal(config.cookieSameSite, "none");
    assert.equal(config.cookieSecure, true);
});

test("the returned config object is frozen", () => {
    const config = readSessionConfig({});
    assert.equal(Object.isFrozen(config), true);
});
