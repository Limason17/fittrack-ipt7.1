const crypto = require("node:crypto");
const { SESSION_CONFIG } = require("../config/sessionConfig");
const { AuthCsrfInvalidError } = require("../errors/SessionErrors");

const CSRF_HEADER_NAME = "x-csrf-token";

function timingSafeStringsEqual(a, b) {
    if (typeof a !== "string" || typeof b !== "string" || a.length === 0 || b.length === 0) {
        return false;
    }
    const bufferA = Buffer.from(a, "utf8");
    const bufferB = Buffer.from(b, "utf8");
    if (bufferA.length !== bufferB.length) {
        return false;
    }
    return crypto.timingSafeEqual(bufferA, bufferB);
}

// Classic double-submit-cookie check: the CSRF cookie is readable by the
// frontend's own JS (unlike the HttpOnly refresh cookie) specifically so it
// can echo the value back as this header. A cross-site attacker's forged
// request has the CSRF cookie auto-attached by the browser like any other
// cookie, but cannot read its value to also set a matching header (same-
// origin policy) - so header and cookie can only agree for a same-origin
// caller. This is layer one; the /refresh endpoint additionally binds the
// header's hash to the specific refresh-token row server-side (see
// services/sessionService.js's rotateRefreshToken), which this generic
// guard has no DB access to check.
function createCsrfGuard({ config = SESSION_CONFIG } = {}) {
    return function verifyCsrfDoubleSubmit(req, res, next) {
        const headerValue = req.headers[CSRF_HEADER_NAME];
        const cookieValue = req.cookies?.[config.csrfCookieName];
        if (!timingSafeStringsEqual(headerValue, cookieValue)) {
            next(new AuthCsrfInvalidError());
            return;
        }
        next();
    };
}

module.exports = { CSRF_HEADER_NAME, createCsrfGuard, timingSafeStringsEqual };
