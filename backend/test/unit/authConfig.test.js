const test = require("node:test");
const assert = require("node:assert/strict");

const { readAuthConfig } = require("../../config/auth");

test("production rejects missing, short and placeholder JWT secrets", () => {
    for (const secret of [
        undefined,
        "short",
        "change-this-secret",
        "replace-with-a-random-secret-of-at-least-32-characters"
    ]) {
        assert.throws(
            () => readAuthConfig({ NODE_ENV: "production", JWT_SECRET: secret }),
            (error) => error.code === "INVALID_AUTH_CONFIG"
        );
    }
});

test("production accepts a sufficiently strong configured secret", () => {
    const result = readAuthConfig({
        NODE_ENV: "production",
        JWT_SECRET: "a-unique-production-secret-with-more-than-32-chars"
    });
    assert.equal(result.JWT_SECRET.length > 32, true);
});
