const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

const authenticateToken = require("../../middleware/authMiddleware");
const { createAuthenticateToken } = require("../../middleware/authMiddleware");
const { JWT_SECRET } = require("../../config/auth");

test("only an exact Bearer authorization scheme is accepted", () => {
    assert.equal(authenticateToken.extractBearerToken("Bearer abc.def.ghi"), "abc.def.ghi");
    assert.equal(authenticateToken.extractBearerToken("bearer abc.def.ghi"), "abc.def.ghi");
    assert.equal(authenticateToken.extractBearerToken("Basic abc.def.ghi"), null);
    assert.equal(authenticateToken.extractBearerToken("Bearer"), null);
    assert.equal(authenticateToken.extractBearerToken("Bearer one two"), null);
});

function fakeDatabase(rows) {
    return {
        promise() {
            return {
                async query() {
                    return [rows];
                }
            };
        }
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

test("Stage 3B1: a token whose authVersion matches the current users.auth_version is accepted", async () => {
    const middleware = createAuthenticateToken({ database: fakeDatabase([{ auth_version: 3 }]) });
    const token = signToken({ id: 42, authVersion: 3 });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const error = await run(middleware, req);
    assert.equal(error, undefined);
    assert.equal(req.user.id, 42);
    assert.equal(req.user.authVersion, 3);
});

test("Stage 3B1: a token whose authVersion no longer matches is rejected as AUTH_SESSION_INVALIDATED", async () => {
    const middleware = createAuthenticateToken({ database: fakeDatabase([{ auth_version: 4 }]) });
    const token = signToken({ id: 42, authVersion: 3 });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const error = await run(middleware, req);
    assert.equal(error?.code, "AUTH_SESSION_INVALIDATED");
    assert.equal(error?.status, 401);
});

test("Stage 3B1: a legacy token with no authVersion claim at all is rejected the same uniform way, without querying the database", async () => {
    let queried = false;
    const middleware = createAuthenticateToken({
        database: {
            promise() {
                return {
                    async query() {
                        queried = true;
                        return [[{ auth_version: 1 }]];
                    }
                };
            }
        }
    });
    const token = signToken({ id: 42 });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const error = await run(middleware, req);
    assert.equal(error?.code, "AUTH_SESSION_INVALIDATED");
    assert.equal(queried, false, "a token without a well-formed authVersion claim must be rejected before any database round trip");
});

test("Stage 3B1: a user that no longer exists is rejected as AUTH_SESSION_INVALIDATED, not a distinct not-found error", async () => {
    const middleware = createAuthenticateToken({ database: fakeDatabase([]) });
    const token = signToken({ id: 999, authVersion: 1 });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const error = await run(middleware, req);
    assert.equal(error?.code, "AUTH_SESSION_INVALIDATED");
});

test("Stage 3B1: a malformed/invalid signature is still rejected as the pre-existing generic AuthenticationError, distinct from AUTH_SESSION_INVALIDATED", async () => {
    const middleware = createAuthenticateToken({ database: fakeDatabase([{ auth_version: 1 }]) });
    const req = { headers: { authorization: "Bearer not-a-real-jwt" } };
    const error = await run(middleware, req);
    assert.equal(error?.code, "AUTHENTICATION_REQUIRED");
});

test("Stage 3B1: a missing Authorization header is rejected before any token parsing", async () => {
    const middleware = createAuthenticateToken({ database: fakeDatabase([{ auth_version: 1 }]) });
    const req = { headers: {} };
    const error = await run(middleware, req);
    assert.equal(error?.code, "AUTHENTICATION_REQUIRED");
});
