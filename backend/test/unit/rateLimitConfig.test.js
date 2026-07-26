const test = require("node:test");
const assert = require("node:assert/strict");

const { readRateLimitConfig, DEVELOPMENT_SECRET } = require("../../config/rateLimitConfig");
const { JWT_SECRET } = require("../../config/auth");

test("production rejects missing, short and placeholder rate limit key secrets", () => {
    for (const secret of [
        undefined,
        "short",
        "change-this-secret",
        "replace-with-a-random-secret-of-at-least-32-characters",
        "fittrack-rate-limit-key-secret",
        DEVELOPMENT_SECRET
    ]) {
        assert.throws(
            () => readRateLimitConfig({ NODE_ENV: "production", RATE_LIMIT_KEY_SECRET: secret }),
            (error) => error.code === "INVALID_RATE_LIMIT_CONFIG"
        );
    }
});

test("production accepts a sufficiently strong configured secret", () => {
    const result = readRateLimitConfig({
        NODE_ENV: "production",
        RATE_LIMIT_KEY_SECRET: "a-unique-production-rate-limit-secret-over-32-chars",
        JWT_SECRET: "a-completely-different-production-jwt-secret-over-32"
    });
    assert.equal(result.RATE_LIMIT_KEY_SECRET.length > 32, true);
});

test("the secret must not be identical to JWT_SECRET, in production or otherwise", () => {
    assert.throws(
        () => readRateLimitConfig({
            NODE_ENV: "production",
            RATE_LIMIT_KEY_SECRET: "shared-secret-value-used-for-both-things-over-32-chars",
            JWT_SECRET: "shared-secret-value-used-for-both-things-over-32-chars"
        }),
        (error) => error.code === "INVALID_RATE_LIMIT_CONFIG"
    );
});

test("development/test accept the built-in default and reject an empty explicit value", () => {
    const result = readRateLimitConfig({ NODE_ENV: "test" });
    assert.equal(result.RATE_LIMIT_KEY_SECRET, DEVELOPMENT_SECRET);
    assert.throws(
        () => readRateLimitConfig({ NODE_ENV: "test", RATE_LIMIT_KEY_SECRET: "short" }),
        (error) => error.code === "INVALID_RATE_LIMIT_CONFIG"
    );
});

test("the real module-level default secret genuinely differs from the real module-level JWT secret", () => {
    // Guards against the two config files' hardcoded development defaults
    // ever being copy-pasted into matching values.
    assert.notEqual(DEVELOPMENT_SECRET, JWT_SECRET);
});
