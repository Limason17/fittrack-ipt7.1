const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const { createOpaqueToken, hashOpaqueToken, timingSafeHashesEqual } = require("../../security/sessionTokens");

test("createOpaqueToken produces a 43-character base64url token and a 32-byte hash", () => {
    const { token, tokenHash } = createOpaqueToken();
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.isBuffer(tokenHash), true);
    assert.equal(tokenHash.length, 32);
});

test("createOpaqueToken never repeats across calls", () => {
    const seen = new Set();
    for (let i = 0; i < 200; i += 1) {
        const { token } = createOpaqueToken();
        assert.equal(seen.has(token), false);
        seen.add(token);
    }
});

test("hashOpaqueToken is deterministic for the same token", () => {
    const { token, tokenHash } = createOpaqueToken();
    assert.deepEqual(hashOpaqueToken(token), tokenHash);
});

test("hashOpaqueToken rejects malformed token shapes", () => {
    for (const bad of [undefined, null, 123, "", "too-short", "x".repeat(44), "has spaces in it padded to len 43!"]) {
        assert.throws(() => hashOpaqueToken(bad), (error) => error.code === "INVALID_OPAQUE_TOKEN");
    }
});

test("createOpaqueToken rejects an entropy source that does not return exactly 32 bytes", () => {
    assert.throws(() => createOpaqueToken(() => Buffer.alloc(16)), TypeError);
});

test("timingSafeHashesEqual is true only for identical buffers of the same length", () => {
    const a = crypto.randomBytes(32);
    const b = Buffer.from(a);
    const c = crypto.randomBytes(32);
    assert.equal(timingSafeHashesEqual(a, b), true);
    assert.equal(timingSafeHashesEqual(a, c), false);
});

test("timingSafeHashesEqual is false for mismatched lengths or non-buffer input, without throwing", () => {
    const a = crypto.randomBytes(32);
    assert.equal(timingSafeHashesEqual(a, crypto.randomBytes(16)), false);
    assert.equal(timingSafeHashesEqual(a, "not-a-buffer"), false);
    assert.equal(timingSafeHashesEqual(undefined, a), false);
    assert.equal(timingSafeHashesEqual(null, null), false);
});
