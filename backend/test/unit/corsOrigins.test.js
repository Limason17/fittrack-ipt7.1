const test = require("node:test");
const assert = require("node:assert/strict");

const { allowedOrigins, isLoopbackHostname, readCorsConfig } = require("../../config/corsOrigins");

test("parses a comma-separated list of origins, trimming whitespace", () => {
    const origins = allowedOrigins({ CORS_ALLOWED_ORIGINS: " http://localhost:5173 , http://127.0.0.1:5173 " });
    assert.deepEqual(origins, ["http://localhost:5173", "http://127.0.0.1:5173"]);
});

test("empty/unset configuration yields an empty allowlist, not an error", () => {
    assert.deepEqual(allowedOrigins({}), []);
    assert.deepEqual(allowedOrigins({ CORS_ALLOWED_ORIGINS: "" }), []);
});

test("rejects an entry with a real path, query, fragment, or embedded credentials", () => {
    for (const bad of [
        "http://localhost:5173/app",
        "http://localhost:5173?x=1",
        "http://localhost:5173#frag",
        "http://user:pass@localhost:5173"
    ]) {
        assert.throws(
            () => allowedOrigins({ CORS_ALLOWED_ORIGINS: bad }),
            (error) => error.code === "INVALID_CORS_CONFIG"
        );
    }
});

test("a bare trailing slash is accepted as equivalent to no path at all", () => {
    assert.deepEqual(allowedOrigins({ CORS_ALLOWED_ORIGINS: "http://localhost:5173/" }), ["http://localhost:5173"]);
});

test("rejects a non-http(s) scheme and a malformed URL", () => {
    assert.throws(() => allowedOrigins({ CORS_ALLOWED_ORIGINS: "ftp://localhost:5173" }), (e) => e.code === "INVALID_CORS_CONFIG");
    assert.throws(() => allowedOrigins({ CORS_ALLOWED_ORIGINS: "not-a-url" }), (e) => e.code === "INVALID_CORS_CONFIG");
    assert.throws(() => allowedOrigins({ CORS_ALLOWED_ORIGINS: "*" }), (e) => e.code === "INVALID_CORS_CONFIG");
});

test("never treats a wildcard or a lookalike suffix domain as equivalent to a configured origin", () => {
    const origins = allowedOrigins({ CORS_ALLOWED_ORIGINS: "https://example.com" });
    assert.equal(origins.includes("https://example.com.evil.test"), false);
    assert.equal(origins.length, 1);
    assert.equal(origins[0], "https://example.com");
});

test("normalizes an explicit default port away and lowercases the host", () => {
    const origins = allowedOrigins({ CORS_ALLOWED_ORIGINS: "HTTPS://Example.COM:443" });
    assert.deepEqual(origins, ["https://example.com"]);
});

test("deduplicates identical normalized origins", () => {
    const origins = allowedOrigins({
        CORS_ALLOWED_ORIGINS: "https://example.com,https://EXAMPLE.com,https://example.com:443"
    });
    assert.deepEqual(origins, ["https://example.com"]);
});

test("production rejects an http origin", () => {
    assert.throws(
        () => allowedOrigins({ NODE_ENV: "production", CORS_ALLOWED_ORIGINS: "http://app.example.com" }),
        (error) => error.code === "INVALID_CORS_CONFIG"
    );
});

test("production rejects localhost/loopback origins outright", () => {
    for (const bad of ["https://localhost:5173", "https://127.0.0.1:5173", "https://[::1]:5173"]) {
        assert.throws(
            () => allowedOrigins({ NODE_ENV: "production", CORS_ALLOWED_ORIGINS: bad }),
            (error) => error.code === "INVALID_CORS_CONFIG"
        );
    }
});

test("production accepts a proper https origin", () => {
    const origins = allowedOrigins({ NODE_ENV: "production", CORS_ALLOWED_ORIGINS: "https://app.example.com" });
    assert.deepEqual(origins, ["https://app.example.com"]);
});

test("development/test freely allow localhost and 127.0.0.1", () => {
    const origins = allowedOrigins({ CORS_ALLOWED_ORIGINS: "http://localhost:5173,http://127.0.0.1:5173" });
    assert.deepEqual(origins, ["http://localhost:5173", "http://127.0.0.1:5173"]);
});

test("isLoopbackHostname recognizes localhost, 127.x.x.x, and ::1 only", () => {
    assert.equal(isLoopbackHostname("localhost"), true);
    assert.equal(isLoopbackHostname("127.0.0.1"), true);
    assert.equal(isLoopbackHostname("127.55.1.9"), true);
    assert.equal(isLoopbackHostname("::1"), true);
    assert.equal(isLoopbackHostname("example.com"), false);
    assert.equal(isLoopbackHostname("127.evil.test"), false);
});

test("readCorsConfig defaults CORS_ALLOW_CREDENTIALS to true and CORS_MAX_AGE_SECONDS to 600", () => {
    const config = readCorsConfig({ CORS_ALLOWED_ORIGINS: "http://localhost:5173" });
    assert.equal(config.allowCredentials, true);
    assert.equal(config.maxAgeSeconds, 600);
    assert.deepEqual(config.allowedOrigins, ["http://localhost:5173"]);
});

test("readCorsConfig honours explicit CORS_ALLOW_CREDENTIALS and CORS_MAX_AGE_SECONDS", () => {
    const config = readCorsConfig({ CORS_ALLOW_CREDENTIALS: "false", CORS_MAX_AGE_SECONDS: "120" });
    assert.equal(config.allowCredentials, false);
    assert.equal(config.maxAgeSeconds, 120);
});

test("readCorsConfig rejects a non-boolean CORS_ALLOW_CREDENTIALS and a negative CORS_MAX_AGE_SECONDS", () => {
    assert.throws(() => readCorsConfig({ CORS_ALLOW_CREDENTIALS: "yes" }), (e) => e.code === "INVALID_CORS_CONFIG");
    assert.throws(() => readCorsConfig({ CORS_MAX_AGE_SECONDS: "-1" }), (e) => e.code === "INVALID_CORS_CONFIG");
});
