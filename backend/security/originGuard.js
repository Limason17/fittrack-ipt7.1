const { allowedOrigins } = require("../config/corsOrigins");
const { AuthOriginNotAllowedError } = require("../errors/SessionErrors");

// Applied only to the three cookie-adjacent /api/auth/* mutating endpoints
// (refresh, logout, logout-all). A genuine browser fetch() call always sends
// an Origin header on state-changing (non-GET) requests, whether same-site
// or cross-site - so a MISSING Origin header means a controlled, non-browser
// caller (curl, a backend integration test), which is deliberately let
// through unchanged (documented exception, see docs/STAGE_3B2...). A
// PRESENT-but-not-allowlisted Origin always fails closed: that combination
// only happens for a real browser request from somewhere it shouldn't be.
function createOriginGuard({ getAllowedOrigins = allowedOrigins } = {}) {
    return function verifyOrigin(req, res, next) {
        const origin = req.headers.origin;
        if (!origin) {
            next();
            return;
        }

        let originHost;
        try {
            originHost = new URL(origin).host.toLowerCase();
        } catch {
            next(new AuthOriginNotAllowedError());
            return;
        }

        let allowed;
        try {
            allowed = getAllowedOrigins();
        } catch (error) {
            next(error);
            return;
        }

        const requestHost = req.headers.host?.toLowerCase();
        const isSameHost = Boolean(requestHost) && originHost === requestHost;
        if (!isSameHost && !allowed.includes(origin.toLowerCase())) {
            next(new AuthOriginNotAllowedError());
            return;
        }
        next();
    };
}

module.exports = { createOriginGuard };
