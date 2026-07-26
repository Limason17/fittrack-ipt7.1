// For ISOLATED UNIT TESTS ONLY - never wired into the running application.
// Section 5 of the Stage 3D task is explicit: the real app must always use
// MySqlRateLimitStore, with no silent in-memory fallback if it is
// unavailable (see errors/RateLimitErrors.js's RateLimitStoreUnavailableError
// and middleware/rateLimiter.js's handling of it). This store exists purely
// so unit tests that want to exercise policy/middleware wiring without a
// real database do not have to hand-roll their own fake store, and shares
// the exact same consume() contract as mysqlRateLimitStore.js so a test can
// swap between them without changing assertions.
function createMemoryRateLimitStore() {
    const buckets = new Map();

    function bucketKey(policyId, keyHash) {
        return `${policyId}:${keyHash.toString("hex")}`;
    }

    async function consume({ policyId, keyHash, windowMs, max, now }) {
        if (typeof policyId !== "string" || !policyId) {
            throw new TypeError("consume() requires a policyId.");
        }
        if (!Buffer.isBuffer(keyHash) || keyHash.length !== 32) {
            throw new TypeError("consume() requires a 32-byte keyHash Buffer.");
        }
        if (!Number.isSafeInteger(windowMs) || windowMs <= 0) {
            throw new TypeError("consume() requires a positive integer windowMs.");
        }
        if (!Number.isSafeInteger(max) || max <= 0) {
            throw new TypeError("consume() requires a positive integer max.");
        }
        const nowMs = now instanceof Date ? now.getTime() : Number(now);
        if (!Number.isFinite(nowMs)) {
            throw new TypeError("consume() requires a valid now.");
        }

        const key = bucketKey(policyId, keyHash);
        const existing = buckets.get(key);
        const expired = !existing || existing.windowStartedAt + windowMs <= nowMs;
        const bucket = expired
            ? { windowStartedAt: nowMs, requestCount: 1 }
            : { windowStartedAt: existing.windowStartedAt, requestCount: existing.requestCount + 1 };
        buckets.set(key, bucket);

        const resetAt = bucket.windowStartedAt + windowMs;
        const allowed = bucket.requestCount <= max;
        const retryAfterSeconds = allowed ? 0 : Math.max(1, Math.ceil((resetAt - nowMs) / 1000));

        return {
            allowed,
            remaining: Math.max(0, max - bucket.requestCount),
            retryAfterSeconds,
            resetAt
        };
    }

    return { consume, _buckets: buckets };
}

module.exports = { createMemoryRateLimitStore };
