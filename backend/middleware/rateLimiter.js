const { RateLimitError } = require("../errors/AppError");

function createFixedWindowRateLimiter({
    windowMs,
    max,
    now = Date.now,
    keyGenerator = (req) => req.ip || req.socket?.remoteAddress || "unknown"
}) {
    if (!Number.isSafeInteger(windowMs) || windowMs <= 0 || !Number.isSafeInteger(max) || max <= 0) {
        throw new TypeError("windowMs and max must be positive integers");
    }

    const windows = new Map();
    let requestsSinceSweep = 0;

    return function fixedWindowRateLimiter(req, res, next) {
        const currentTime = now();
        const key = keyGenerator(req);
        const previous = windows.get(key);
        const state = !previous || previous.resetAt <= currentTime
            ? { count: 0, resetAt: currentTime + windowMs }
            : previous;

        state.count += 1;
        windows.set(key, state);

        const remaining = Math.max(0, max - state.count);
        res.setHeader("RateLimit-Limit", String(max));
        res.setHeader("RateLimit-Remaining", String(remaining));
        res.setHeader("RateLimit-Reset", String(Math.ceil(state.resetAt / 1000)));

        requestsSinceSweep += 1;
        if (requestsSinceSweep >= 1000) {
            for (const [storedKey, stored] of windows) {
                if (stored.resetAt <= currentTime) {
                    windows.delete(storedKey);
                }
            }
            requestsSinceSweep = 0;
        }

        if (state.count > max) {
            res.setHeader("Retry-After", String(Math.ceil((state.resetAt - currentTime) / 1000)));
            next(new RateLimitError());
            return;
        }

        next();
    };
}

module.exports = { createFixedWindowRateLimiter };
