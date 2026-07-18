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

function createAuthRateLimiters(options = {}) {
    const env = options.env || process.env;
    const now = options.now || Date.now;
    const loginWindowMs = options.loginWindowMs ?? positiveInteger(
        env.AUTH_LOGIN_RATE_LIMIT_WINDOW_MS,
        15 * 60 * 1000,
        "AUTH_LOGIN_RATE_LIMIT_WINDOW_MS"
    );
    const loginMax = options.loginMax ?? positiveInteger(
        env.AUTH_LOGIN_RATE_LIMIT_MAX,
        10,
        "AUTH_LOGIN_RATE_LIMIT_MAX"
    );
    const registrationWindowMs = options.registrationWindowMs ?? positiveInteger(
        env.AUTH_REGISTRATION_RATE_LIMIT_WINDOW_MS,
        60 * 60 * 1000,
        "AUTH_REGISTRATION_RATE_LIMIT_WINDOW_MS"
    );
    const registrationMax = options.registrationMax ?? positiveInteger(
        env.AUTH_REGISTRATION_RATE_LIMIT_MAX,
        5,
        "AUTH_REGISTRATION_RATE_LIMIT_MAX"
    );

    return {
        login: createFixedWindowRateLimiter({ windowMs: loginWindowMs, max: loginMax, now }),
        registration: createFixedWindowRateLimiter({
            windowMs: registrationWindowMs,
            max: registrationMax,
            now
        })
    };
}

module.exports = {
    createAuthRateLimiters,
    createFixedWindowRateLimiter,
    positiveInteger
};
