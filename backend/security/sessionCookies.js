const { SESSION_CONFIG } = require("../config/sessionConfig");

const AUTH_COOKIE_PATH = "/api/auth";

// Refresh cookie: HttpOnly (never readable by frontend JS - this is the
// entire point, an XSS payload cannot exfiltrate it) and Path-restricted to
// only the auth endpoints that ever need to read it, so it is never sent
// along with unrelated API calls. CSRF cookie: deliberately NOT HttpOnly
// (the frontend must read it with document.cookie to echo it back as a
// header - see security/sessionTokens.js's csrf hash-binding) and Path=/ so
// it is readable regardless of which page issued the request.
function refreshCookieOptions(config = SESSION_CONFIG) {
    return {
        httpOnly: true,
        secure: config.cookieSecure,
        sameSite: config.cookieSameSite,
        path: AUTH_COOKIE_PATH,
        maxAge: config.refreshTokenTtlDays * 24 * 60 * 60 * 1000
    };
}

function csrfCookieOptions(config = SESSION_CONFIG) {
    return {
        httpOnly: false,
        secure: config.cookieSecure,
        sameSite: config.cookieSameSite,
        path: "/",
        maxAge: config.refreshTokenTtlDays * 24 * 60 * 60 * 1000
    };
}

function setSessionCookies(res, { refreshToken, csrfToken }, config = SESSION_CONFIG) {
    res.cookie(config.refreshCookieName, refreshToken, refreshCookieOptions(config));
    res.cookie(config.csrfCookieName, csrfToken, csrfCookieOptions(config));
}

function clearSessionCookies(res, config = SESSION_CONFIG) {
    res.clearCookie(config.refreshCookieName, { path: AUTH_COOKIE_PATH });
    res.clearCookie(config.csrfCookieName, { path: "/" });
}

module.exports = {
    AUTH_COOKIE_PATH,
    clearSessionCookies,
    csrfCookieOptions,
    refreshCookieOptions,
    setSessionCookies
};
