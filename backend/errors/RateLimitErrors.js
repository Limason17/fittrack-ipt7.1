const { AppError } = require("./AppError");

// Internal-only signal thrown by a rate-limit store implementation (see
// rateLimiting/mysqlRateLimitStore.js) when it cannot determine whether a
// request should be allowed - e.g. the database is unreachable. Never sent
// to a client directly: middleware/rateLimiter.js catches this and converts
// it to RateLimitBackendUnavailableError below, which carries no internal
// SQL/driver detail.
class RateLimitStoreUnavailableError extends Error {
    constructor(message = "The rate limit store is unavailable.", { cause } = {}) {
        super(message, cause ? { cause } : undefined);
        this.name = "RateLimitStoreUnavailableError";
    }
}

// Fail-closed contract for Section 10: when the shared rate-limit store
// cannot be reached, security-critical endpoints refuse the request outright
// (503) rather than either silently allowing it (which would defeat the
// limiter) or falling back to an in-memory counter (which would defeat the
// whole point of a shared, multi-instance-safe store).
class RateLimitBackendUnavailableError extends AppError {
    constructor() {
        super({
            status: 503,
            code: "RATE_LIMIT_BACKEND_UNAVAILABLE",
            message: "The service is temporarily unable to process this request. Please try again shortly."
        });
    }
}

module.exports = {
    RateLimitBackendUnavailableError,
    RateLimitStoreUnavailableError
};
