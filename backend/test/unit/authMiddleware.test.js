const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

const authenticateToken = require("../../middleware/authMiddleware");
const { createAuthenticateToken } = require("../../middleware/authMiddleware");
const { JWT_SECRET } = require("../../config/auth");

const VALID_SESSION_ID = "d995baf4-3bbf-47d4-8a1c-904cd21b3e31";

test("only an exact Bearer authorization scheme is accepted", () => {
    assert.equal(authenticateToken.extractBearerToken("Bearer abc.def.ghi"), "abc.def.ghi");
    assert.equal(authenticateToken.extractBearerToken("bearer abc.def.ghi"), "abc.def.ghi");
    assert.equal(authenticateToken.extractBearerToken("Basic abc.def.ghi"), null);
    assert.equal(authenticateToken.extractBearerToken("Bearer"), null);
    assert.equal(authenticateToken.extractBearerToken("Bearer one two"), null);
});

function fakeDatabase(rows, { onQuery } = {}) {
    return {
        promise() {
            return {
                async query(...args) {
                    onQuery?.(...args);
                    return [rows];
                }
            };
        }
    };
}

// Shape returned by authMiddleware.js's combined
// `users LEFT JOIN user_auth_sessions` query.
function sessionRow({
    userAuthVersion = 1,
    sessionStatus = "active",
    sessionExpiresAt = new Date(Date.now() + 60_000),
    sessionAuthVersion = 1
} = {}) {
    return {
        user_auth_version: userAuthVersion,
        session_status: sessionStatus,
        session_expires_at: sessionExpiresAt,
        session_auth_version: sessionAuthVersion
    };
}

function signToken(payload, options = {}) {
    return jwt.sign(payload, JWT_SECRET, { algorithm: "HS256", ...options });
}

async function run(middleware, req) {
    let calledWith;
    await new Promise((resolve) => {
        middleware(req, {}, (error) => {
            calledWith = error;
            resolve();
        });
    });
    return calledWith;
}

test("Stage 3B2: a token with a valid session (matching authVersion, active, unexpired) is accepted via a single combined query", async () => {
    let queryCount = 0;
    const middleware = createAuthenticateToken({
        database: fakeDatabase([sessionRow()], { onQuery: () => { queryCount += 1; } })
    });
    const token = signToken({ id: 42, authVersion: 1, sessionId: VALID_SESSION_ID });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const error = await run(middleware, req);
    assert.equal(error, undefined);
    assert.equal(req.user.id, 42);
    assert.equal(req.user.sessionId, VALID_SESSION_ID);
    assert.equal(queryCount, 1, "session + user validation must be one round trip, not two");
});

test("Stage 3B1 (carried over): a legacy token with no authVersion claim at all is rejected without querying the database", async () => {
    let queried = false;
    const middleware = createAuthenticateToken({
        database: fakeDatabase([sessionRow()], { onQuery: () => { queried = true; } })
    });
    const token = signToken({ id: 42, sessionId: VALID_SESSION_ID });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const error = await run(middleware, req);
    assert.equal(error?.code, "AUTH_SESSION_INVALIDATED");
    assert.equal(queried, false);
});

test("Stage 3B2: a token with no sessionId claim at all (pre-3B2 token) is rejected without querying the database", async () => {
    let queried = false;
    const middleware = createAuthenticateToken({
        database: fakeDatabase([sessionRow()], { onQuery: () => { queried = true; } })
    });
    const token = signToken({ id: 42, authVersion: 1 });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const error = await run(middleware, req);
    assert.equal(error?.code, "AUTH_SESSION_INVALIDATED");
    assert.equal(queried, false, "a token without a well-formed sessionId claim must be rejected before any database round trip");
});

test("Stage 3B2: a malformed (non-UUID) sessionId claim is rejected without querying the database", async () => {
    let queried = false;
    const middleware = createAuthenticateToken({
        database: fakeDatabase([sessionRow()], { onQuery: () => { queried = true; } })
    });
    const token = signToken({ id: 42, authVersion: 1, sessionId: "not-a-uuid" });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const error = await run(middleware, req);
    assert.equal(error?.code, "AUTH_SESSION_INVALIDATED");
    assert.equal(queried, false);
});

test("Stage 3B2: a session that does not exist (LEFT JOIN found no matching row) is rejected as AUTH_SESSION_INVALIDATED", async () => {
    const middleware = createAuthenticateToken({
        database: fakeDatabase([sessionRow({ sessionStatus: null, sessionExpiresAt: null, sessionAuthVersion: null })])
    });
    const token = signToken({ id: 42, authVersion: 1, sessionId: VALID_SESSION_ID });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const error = await run(middleware, req);
    assert.equal(error?.code, "AUTH_SESSION_INVALIDATED");
    assert.equal(error?.status, 401);
});

test("Stage 3B2: a revoked session is rejected as AUTH_SESSION_INVALIDATED", async () => {
    const middleware = createAuthenticateToken({
        database: fakeDatabase([sessionRow({ sessionStatus: "revoked" })])
    });
    const token = signToken({ id: 42, authVersion: 1, sessionId: VALID_SESSION_ID });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const error = await run(middleware, req);
    assert.equal(error?.code, "AUTH_SESSION_INVALIDATED");
});

test("Stage 3B2: a compromised session (reuse-detected) is rejected as AUTH_SESSION_INVALIDATED", async () => {
    const middleware = createAuthenticateToken({
        database: fakeDatabase([sessionRow({ sessionStatus: "compromised" })])
    });
    const token = signToken({ id: 42, authVersion: 1, sessionId: VALID_SESSION_ID });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const error = await run(middleware, req);
    assert.equal(error?.code, "AUTH_SESSION_INVALIDATED");
});

test("Stage 3B2: an expired session is rejected as AUTH_SESSION_INVALIDATED", async () => {
    const middleware = createAuthenticateToken({
        database: fakeDatabase([sessionRow({ sessionExpiresAt: new Date(Date.now() - 1000) })])
    });
    const token = signToken({ id: 42, authVersion: 1, sessionId: VALID_SESSION_ID });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const error = await run(middleware, req);
    assert.equal(error?.code, "AUTH_SESSION_INVALIDATED");
});

test("Stage 3B2: a session whose own snapshotted auth_version has fallen behind the user's current one is rejected", async () => {
    const middleware = createAuthenticateToken({
        database: fakeDatabase([sessionRow({ userAuthVersion: 2, sessionAuthVersion: 1 })])
    });
    const token = signToken({ id: 42, authVersion: 2, sessionId: VALID_SESSION_ID });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const error = await run(middleware, req);
    assert.equal(error?.code, "AUTH_SESSION_INVALIDATED");
});

test("Stage 3B1 (carried over): a token whose authVersion no longer matches the user's current auth_version is rejected", async () => {
    const middleware = createAuthenticateToken({
        database: fakeDatabase([sessionRow({ userAuthVersion: 4, sessionAuthVersion: 4 })])
    });
    const token = signToken({ id: 42, authVersion: 3, sessionId: VALID_SESSION_ID });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const error = await run(middleware, req);
    assert.equal(error?.code, "AUTH_SESSION_INVALIDATED");
});

test("Stage 3B1 (carried over): a user that no longer exists is rejected as AUTH_SESSION_INVALIDATED, not a distinct not-found error", async () => {
    const middleware = createAuthenticateToken({ database: fakeDatabase([]) });
    const token = signToken({ id: 999, authVersion: 1, sessionId: VALID_SESSION_ID });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const error = await run(middleware, req);
    assert.equal(error?.code, "AUTH_SESSION_INVALIDATED");
});

test("a malformed/invalid signature is still rejected as the pre-existing generic AuthenticationError, distinct from AUTH_SESSION_INVALIDATED", async () => {
    const middleware = createAuthenticateToken({ database: fakeDatabase([sessionRow()]) });
    const req = { headers: { authorization: "Bearer not-a-real-jwt" } };
    const error = await run(middleware, req);
    assert.equal(error?.code, "AUTHENTICATION_REQUIRED");
});

test("a missing Authorization header is rejected before any token parsing", async () => {
    const middleware = createAuthenticateToken({ database: fakeDatabase([sessionRow()]) });
    const req = { headers: {} };
    const error = await run(middleware, req);
    assert.equal(error?.code, "AUTHENTICATION_REQUIRED");
});
