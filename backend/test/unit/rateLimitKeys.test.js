const test = require("node:test");
const assert = require("node:assert/strict");

const { hashRateLimitKey, normalizeEmail, normalizeIp } = require("../../rateLimiting/rateLimitKeys");

test("normalizeEmail trims and lowercases", () => {
    assert.equal(normalizeEmail("  User@Example.TEST  "), "user@example.test");
});

test("normalizeEmail returns an empty string for non-string input rather than throwing", () => {
    assert.equal(normalizeEmail(undefined), "");
    assert.equal(normalizeEmail(null), "");
    assert.equal(normalizeEmail(42), "");
});

test("re-exports the same normalizeIp as security/clientIp", () => {
    assert.equal(normalizeIp("::ffff:127.0.0.1"), "127.0.0.1");
});

test("hashRateLimitKey produces a 32-byte Buffer, suitable for BINARY(32)", () => {
    const hash = hashRateLimitKey("a".repeat(32), "login|user@example.test|127.0.0.1");
    assert.ok(Buffer.isBuffer(hash));
    assert.equal(hash.length, 32);
});

test("hashRateLimitKey is deterministic for the same secret and key", () => {
    const a = hashRateLimitKey("a".repeat(32), "same-key");
    const b = hashRateLimitKey("a".repeat(32), "same-key");
    assert.deepEqual(a, b);
});

test("hashRateLimitKey produces different output for different raw keys under the same secret", () => {
    const a = hashRateLimitKey("a".repeat(32), "key-one");
    const b = hashRateLimitKey("a".repeat(32), "key-two");
    assert.notDeepEqual(a, b);
});

test("hashRateLimitKey produces different output for the same raw key under different secrets (keyed, not a plain hash)", () => {
    const a = hashRateLimitKey("a".repeat(32), "same-key");
    const b = hashRateLimitKey("b".repeat(32), "same-key");
    assert.notDeepEqual(a, b, "a plain SHA-256 of a small IP/e-mail space would be brute-forceable; HMAC with a server secret must not be");
});

test("hashRateLimitKey rejects a missing/too-short secret and a missing raw key", () => {
    assert.throws(() => hashRateLimitKey("short", "key"), TypeError);
    assert.throws(() => hashRateLimitKey("a".repeat(32), ""), TypeError);
    assert.throws(() => hashRateLimitKey("a".repeat(32), undefined), TypeError);
});

test("the hash never trivially contains the raw key as a substring", () => {
    const rawKey = "login|attacker@example.test|203.0.113.7";
    const hash = hashRateLimitKey("a".repeat(32), rawKey);
    assert.equal(hash.toString("utf8").includes("attacker"), false);
    assert.equal(hash.toString("hex").includes(Buffer.from("attacker").toString("hex")), false);
});
