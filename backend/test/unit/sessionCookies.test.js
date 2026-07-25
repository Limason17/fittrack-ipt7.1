const test = require("node:test");
const assert = require("node:assert/strict");

const {
    refreshCookieOptions,
    csrfCookieOptions,
    setSessionCookies,
    clearSessionCookies,
    AUTH_COOKIE_PATH
} = require("../../security/sessionCookies");

const config = {
    refreshCookieName: "fittrack_refresh",
    csrfCookieName: "fittrack_csrf",
    cookieSecure: true,
    cookieSameSite: "strict",
    refreshTokenTtlDays: 7
};

test("refresh cookie is HttpOnly and path-restricted to the auth endpoints", () => {
    const options = refreshCookieOptions(config);
    assert.equal(options.httpOnly, true);
    assert.equal(options.path, AUTH_COOKIE_PATH);
    assert.equal(options.secure, true);
    assert.equal(options.sameSite, "strict");
    assert.equal(options.maxAge, 7 * 24 * 60 * 60 * 1000);
});

test("CSRF cookie is NOT HttpOnly and readable from any path", () => {
    const options = csrfCookieOptions(config);
    assert.equal(options.httpOnly, false);
    assert.equal(options.path, "/");
    assert.equal(options.maxAge, 7 * 24 * 60 * 60 * 1000);
});

test("cookie secure/sameSite follow the injected config, not a hardcoded value", () => {
    const nonProdConfig = { ...config, cookieSecure: false, cookieSameSite: "lax" };
    assert.equal(refreshCookieOptions(nonProdConfig).secure, false);
    assert.equal(refreshCookieOptions(nonProdConfig).sameSite, "lax");
});

function fakeResponse() {
    const calls = [];
    return {
        calls,
        cookie(name, value, options) { calls.push({ op: "set", name, value, options }); },
        clearCookie(name, options) { calls.push({ op: "clear", name, options }); }
    };
}

test("setSessionCookies sets both cookies with their respective options", () => {
    const res = fakeResponse();
    setSessionCookies(res, { refreshToken: "rt-value", csrfToken: "csrf-value" }, config);
    assert.equal(res.calls.length, 2);
    const refreshCall = res.calls.find((c) => c.name === "fittrack_refresh");
    const csrfCall = res.calls.find((c) => c.name === "fittrack_csrf");
    assert.equal(refreshCall.value, "rt-value");
    assert.equal(refreshCall.options.httpOnly, true);
    assert.equal(csrfCall.value, "csrf-value");
    assert.equal(csrfCall.options.httpOnly, false);
});

test("clearSessionCookies clears both cookies with matching paths", () => {
    const res = fakeResponse();
    clearSessionCookies(res, config);
    assert.equal(res.calls.length, 2);
    assert.deepEqual(res.calls.map((c) => c.op), ["clear", "clear"]);
    const refreshClear = res.calls.find((c) => c.name === "fittrack_refresh");
    assert.equal(refreshClear.options.path, AUTH_COOKIE_PATH);
});
