const test = require("node:test");
const assert = require("node:assert/strict");

const { validateStartupConfig } = require("../../config/startupConfig");

function validProductionEnv(overrides = {}) {
    return {
        NODE_ENV: "production",
        JWT_SECRET: "a-unique-production-jwt-secret-with-more-than-32-characters",
        RATE_LIMIT_KEY_SECRET: "a-unique-production-rate-limit-secret-with-32-plus-chars",
        AUTH_COOKIE_SECURE: "true",
        AUTH_COOKIE_SAME_SITE: "strict",
        CORS_ALLOWED_ORIGINS: "https://app.example.com",
        TRUST_PROXY_MODE: "disabled",
        DB_NAME: "fittrack",
        DB_HOST: "db.internal.example.com",
        DB_USER: "fittrack_app",
        DB_PASSWORD: "a-real-password",
        ...overrides
    };
}

test("a fully valid production configuration passes without throwing", () => {
    assert.doesNotThrow(() => validateStartupConfig(validProductionEnv()));
});

test("a development/test configuration with no explicit secrets passes using safe defaults", () => {
    assert.doesNotThrow(() => validateStartupConfig({ NODE_ENV: "test" }));
});

test("collects and reports every problem together, not just the first", () => {
    const badEnv = validProductionEnv({
        JWT_SECRET: "too-short",
        RATE_LIMIT_KEY_SECRET: "also-too-short",
        CORS_ALLOWED_ORIGINS: "http://insecure.example.com"
    });
    assert.throws(
        () => validateStartupConfig(badEnv),
        (error) => {
            assert.equal(error.code, "INVALID_STARTUP_CONFIG");
            assert.ok(error.problems.length >= 3, `expected at least 3 problems, got ${error.problems.length}`);
            assert.ok(error.problems.some((p) => p.startsWith("JWT_SECRET:")));
            assert.ok(error.problems.some((p) => p.startsWith("RATE_LIMIT_KEY_SECRET:")));
            assert.ok(error.problems.some((p) => p.startsWith("CORS configuration:")));
            return true;
        }
    );
});

test("never includes a secret's actual value in the aggregated error message", () => {
    const secretValue = "the-actual-secret-value-that-must-never-leak-anywhere";
    try {
        validateStartupConfig(validProductionEnv({ JWT_SECRET: secretValue, RATE_LIMIT_KEY_SECRET: secretValue }));
        assert.fail("expected validateStartupConfig to throw (JWT_SECRET must differ from RATE_LIMIT_KEY_SECRET)");
    } catch (error) {
        assert.equal(error.message.includes(secretValue), false);
    }
});

test("production requires RATE_LIMIT_KEY_SECRET and JWT_SECRET to be different", () => {
    const sharedSecret = "shared-secret-used-for-both-things-over-32-characters-long";
    assert.throws(
        () => validateStartupConfig(validProductionEnv({ JWT_SECRET: sharedSecret, RATE_LIMIT_KEY_SECRET: sharedSecret })),
        (error) => error.problems.some((p) => p.includes("must not be identical to JWT_SECRET"))
    );
});

test("production rejects an insecure CORS origin without touching unrelated, valid settings", () => {
    assert.throws(
        () => validateStartupConfig(validProductionEnv({ CORS_ALLOWED_ORIGINS: "http://app.example.com" })),
        (error) => error.problems.length === 1 && error.problems[0].startsWith("CORS configuration:")
    );
});

test("production requires an explicit trust proxy mode", () => {
    const env = validProductionEnv();
    delete env.TRUST_PROXY_MODE;
    assert.throws(
        () => validateStartupConfig(env),
        (error) => error.problems.some((p) => p.startsWith("trust proxy configuration:"))
    );
});
