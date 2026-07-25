const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

const { signAccessToken } = require("../../security/accessTokens");

const secret = "fittrack-access-token-unit-test-secret-32-chars";
const config = { accessTokenTtlMinutes: 15 };

test("signed access token carries exactly id, authVersion and sessionId as claims", () => {
    const token = signAccessToken(
        { id: 42, authVersion: 3, sessionId: "d995baf4-3bbf-47d4-8a1c-904cd21b3e31" },
        config,
        secret
    );
    const payload = jwt.verify(token, secret, { algorithms: ["HS256"] });
    assert.equal(payload.id, 42);
    assert.equal(payload.authVersion, 3);
    assert.equal(payload.sessionId, "d995baf4-3bbf-47d4-8a1c-904cd21b3e31");
    assert.equal(typeof payload.iat, "number");
    assert.equal(typeof payload.exp, "number");
});

test("access token expiry matches the configured TTL", () => {
    const token = signAccessToken({ id: 1, authVersion: 1, sessionId: "d995baf4-3bbf-47d4-8a1c-904cd21b3e31" }, config, secret);
    const payload = jwt.verify(token, secret, { algorithms: ["HS256"] });
    const ttlSeconds = payload.exp - payload.iat;
    assert.equal(ttlSeconds, 15 * 60);
});

test("a different TTL config produces a different expiry window", () => {
    const shortConfig = { accessTokenTtlMinutes: 5 };
    const token = signAccessToken({ id: 1, authVersion: 1, sessionId: "d995baf4-3bbf-47d4-8a1c-904cd21b3e31" }, shortConfig, secret);
    const payload = jwt.verify(token, secret, { algorithms: ["HS256"] });
    assert.equal(payload.exp - payload.iat, 5 * 60);
});

test("only HS256-signed, secret-verifiable tokens verify - wrong secret is rejected", () => {
    const token = signAccessToken({ id: 1, authVersion: 1, sessionId: "d995baf4-3bbf-47d4-8a1c-904cd21b3e31" }, config, secret);
    assert.throws(() => jwt.verify(token, "a-completely-different-secret-value", { algorithms: ["HS256"] }));
});
