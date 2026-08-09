const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mysql = require("mysql2/promise");

// Route-level regression coverage for a real, pre-existing defect found
// while building the Stage 5C2 frontend (account deletion UI): three
// account.js routes register their per-user rate limiter BEFORE
// `authenticate` runs, so the limiter's key (`userKey`, reads
// `req.user?.id`) always sees `req.user` as undefined at the real route -
// every caller, authenticated or not, collapses into one shared
// "<scope>|user:anon" bucket instead of being isolated per user. This file
// exercises the actual, fully wired app (`createApp()`, real HTTP, real
// middleware order) rather than an isolated unit test of the limiter
// function - a unit test that pre-sets `req.user` before invoking the
// limiter (see rateLimiter.test.js) cannot see this class of bug at all,
// since it never observes the real route's middleware order.
const TEST_DATABASE = `fittrack_api_test_ratelimit_iso_${process.pid}_${Date.now()}`;
if (!/^fittrack_api_test_ratelimit_iso_[A-Za-z0-9_]+$/.test(TEST_DATABASE)) {
    throw new Error("Refusing to use an unsafe rate-limit isolation test database name.");
}

process.env.NODE_ENV = "test";
process.env.DB_NAME = TEST_DATABASE;
process.env.JWT_SECRET = "fittrack-ratelimit-iso-test-secret-with-at-least-32-characters";
process.env.RATE_LIMIT_KEY_SECRET = "fittrack-ratelimit-iso-test-rate-limit-secret-32-chars";
// Generous for every policy not under test in this file - only the three
// policies below are deliberately set low, so a handful of real HTTP
// requests is enough to reach 429 without a slow test.
process.env.AUTH_LOGIN_RATE_LIMIT_MAX = "500";
process.env.AUTH_REGISTRATION_RATE_LIMIT_MAX = "500";
process.env.AUTH_REFRESH_RATE_LIMIT_MAX = "500";
process.env.AUTH_LOGOUT_ALL_RATE_LIMIT_MAX = "500";
process.env.AUTH_EMAIL_CHANGE_CONFIRM_RATE_LIMIT_MAX = "500";
process.env.INVITATION_EMAIL_PROVIDER = "";

process.env.ACCOUNT_DELETE_RATE_LIMIT_MAX = "2";
process.env.AUTH_PASSWORD_CHANGE_RATE_LIMIT_MAX = "2";
process.env.AUTH_EMAIL_CHANGE_RATE_LIMIT_MAX = "2";

const db = require("../../config/db");
const { createMigrationRunner } = require("../../migrations/runner");
const { createApp } = require("../../startup/app");

const logger = { info() {}, warn() {}, error() {} };
const runId = crypto.randomBytes(5).toString("hex");
let adminConnection;
let pool;
let server;
let baseUrl;
let counter = 0;

function fixture(name) {
    counter += 1;
    return {
        username: `rl-iso-${name}-${counter}-${runId}`.slice(0, 50),
        email: `rl-iso-${name}-${counter}-${runId}@example.test`,
        password: "correct horse battery staple rl-iso"
    };
}

async function api(path, { method = "GET", token, body } = {}) {
    const headers = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { response, data: await response.json() };
}

async function registerAndLogin(name) {
    const user = fixture(name);
    const registered = await api("/api/users/register", {
        method: "POST",
        body: {
            username: user.username,
            email: user.email,
            password: user.password,
            language_preference: "de",
            weight_unit: "kg",
            distance_unit: "km"
        }
    });
    assert.equal(registered.response.status, 201, JSON.stringify(registered.data));
    const loggedIn = await api("/api/users/login", {
        method: "POST",
        body: { email: user.email, password: user.password }
    });
    assert.equal(loggedIn.response.status, 200, JSON.stringify(loggedIn.data));
    return { ...user, id: loggedIn.data.user.id, token: loggedIn.data.token };
}

before(async () => {
    adminConnection = await mysql.createConnection(
        db.readDatabaseConfig(process.env, { includeDatabase: false })
    );
    await adminConnection.query(`CREATE DATABASE \`${TEST_DATABASE}\` CHARACTER SET utf8mb4`);
    const runner = createMigrationRunner({ pool: db, logger });
    await runner.migrate({ expectedDatabase: TEST_DATABASE });
    pool = db.promise();

    const app = createApp({
        readiness: { check: async () => ({ ready: true }) },
        logger
    });
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.closePool(db);
    if (adminConnection) {
        assert.match(TEST_DATABASE, /^fittrack_api_test_ratelimit_iso_[A-Za-z0-9_]+$/);
        await adminConnection.query(`DROP DATABASE IF EXISTS \`${TEST_DATABASE}\``);
        await adminConnection.end();
    }
});

// ---- account.deleteRequest (POST /api/account/deletion-request, max 2) ----

// A deliberately wrong current password is used throughout: the rate
// limiter runs before any password check either way, so every attempt -
// right or wrong - consumes exactly one bucket slot, and a wrong password
// safely never mutates or deletes anything (Section 4: "Verwende keinen
// echten Account-Delete-Erfolg, wenn das für diesen Test nicht notwendig
// ist").
function deletionAttempt(user) {
    return api("/api/account/deletion-request", {
        method: "POST",
        token: user.token,
        body: { currentPassword: "definitely-the-wrong-password", confirmationPhrase: user.username }
    });
}

test("account deletion: user A exhausting their own rate-limit bucket never blocks user B's first attempt", async () => {
    const userA = await registerAndLogin("del-a");
    const userB = await registerAndLogin("del-b");

    const a1 = await deletionAttempt(userA);
    assert.equal(a1.response.status, 401, JSON.stringify(a1.data));
    assert.equal(a1.data.error.code, "CURRENT_PASSWORD_INVALID");
    const a2 = await deletionAttempt(userA);
    assert.equal(a2.response.status, 401, JSON.stringify(a2.data));
    const a3 = await deletionAttempt(userA);
    assert.equal(a3.response.status, 429, JSON.stringify(a3.data), "user A's own bucket (max 2) must now be exhausted");

    const b1 = await deletionAttempt(userB);
    assert.equal(
        b1.response.status,
        401,
        `DEFECT: user B's very first attempt was rejected (${JSON.stringify(b1.data)}) because it shares user A's bucket`
    );
    assert.equal(b1.data.error.code, "CURRENT_PASSWORD_INVALID");
});

test("account deletion: the same user remains correctly limited after their own repeated attempts", async () => {
    const user = await registerAndLogin("del-same");
    assert.equal((await deletionAttempt(user)).response.status, 401);
    assert.equal((await deletionAttempt(user)).response.status, 401);
    const third = await deletionAttempt(user);
    assert.equal(third.response.status, 429);
    assert.equal(third.data.error.code, "RATE_LIMIT_EXCEEDED");
    assert.ok(third.response.headers.get("Retry-After"), "429 must still carry Retry-After");
    assert.ok(third.response.headers.get("RateLimit-Remaining") !== null, "429 must still carry the existing RateLimit-* headers");
});

test("account deletion: an unauthenticated caller always gets 401, never 429, and never consumes a real user's bucket", async () => {
    const unauthenticated = () => api("/api/account/deletion-request", {
        method: "POST",
        body: { currentPassword: "x", confirmationPhrase: "y" }
    });

    // Sent MORE times than the low max (2) configured for this file: before
    // the fix, an unauthenticated caller's requests key identically to a
    // real user's ("...|user:anon" either way) and would exhaust the same
    // shared bucket - a trivially unauthenticated denial-of-service against
    // every user's ability to delete their account. None of these may ever
    // see 429; only a genuine authenticateToken failure (401).
    for (let attempt = 0; attempt < 4; attempt += 1) {
        const result = await unauthenticated();
        assert.equal(result.response.status, 401, `unauthenticated attempt ${attempt + 1} must be 401, not rate-limited`);
    }

    const user = await registerAndLogin("del-after-anon");
    const first = await deletionAttempt(user);
    assert.equal(
        first.response.status,
        401,
        `DEFECT: a real user's first-ever attempt was consumed by unauthenticated traffic (${JSON.stringify(first.data)})`
    );
    assert.equal(first.data.error.code, "CURRENT_PASSWORD_INVALID");
});

// ---- account.passwordChange (POST /api/account/change-password, max 2) ----

function passwordChangeAttempt(user) {
    return api("/api/account/change-password", {
        method: "POST",
        token: user.token,
        body: {
            currentPassword: "definitely-the-wrong-password",
            newPassword: "a-brand-new-password-123",
            newPasswordConfirmation: "a-brand-new-password-123"
        }
    });
}

test("password change: user A exhausting their own rate-limit bucket never blocks user B", async () => {
    const userA = await registerAndLogin("pw-a");
    const userB = await registerAndLogin("pw-b");

    assert.equal((await passwordChangeAttempt(userA)).response.status, 401);
    assert.equal((await passwordChangeAttempt(userA)).response.status, 401);
    const exhausted = await passwordChangeAttempt(userA);
    assert.equal(exhausted.response.status, 429, JSON.stringify(exhausted.data));

    const b1 = await passwordChangeAttempt(userB);
    assert.equal(
        b1.response.status,
        401,
        `DEFECT: user B's first attempt was rejected (${JSON.stringify(b1.data)}) because it shares user A's bucket`
    );
    assert.equal(b1.data.error.code, "CURRENT_PASSWORD_INVALID");
});

test("password change: the same user remains correctly limited", async () => {
    const user = await registerAndLogin("pw-same");
    assert.equal((await passwordChangeAttempt(user)).response.status, 401);
    assert.equal((await passwordChangeAttempt(user)).response.status, 401);
    const third = await passwordChangeAttempt(user);
    assert.equal(third.response.status, 429);
    assert.equal(third.data.error.code, "RATE_LIMIT_EXCEEDED");
});

test("password change: a request without a token is rejected with 401", async () => {
    const result = await api("/api/account/change-password", {
        method: "POST",
        body: {
            currentPassword: "x",
            newPassword: "a-brand-new-password-123",
            newPasswordConfirmation: "a-brand-new-password-123"
        }
    });
    assert.equal(result.response.status, 401);
});

// ---- account.emailChangeRequest (POST /api/account/email-change-requests, max 2) ----

function emailChangeAttempt(user) {
    return api("/api/account/email-change-requests", {
        method: "POST",
        token: user.token,
        body: { newEmail: `${user.username}-new@example.test`, currentPassword: "definitely-the-wrong-password" }
    });
}

test("email change request: user A exhausting their own rate-limit bucket never blocks user B", async () => {
    const userA = await registerAndLogin("email-a");
    const userB = await registerAndLogin("email-b");

    assert.equal((await emailChangeAttempt(userA)).response.status, 401);
    assert.equal((await emailChangeAttempt(userA)).response.status, 401);
    const exhausted = await emailChangeAttempt(userA);
    assert.equal(exhausted.response.status, 429, JSON.stringify(exhausted.data));

    const b1 = await emailChangeAttempt(userB);
    assert.equal(
        b1.response.status,
        401,
        `DEFECT: user B's first attempt was rejected (${JSON.stringify(b1.data)}) because it shares user A's bucket`
    );
    assert.equal(b1.data.error.code, "CURRENT_PASSWORD_INVALID");
});

test("email change request: the same user remains correctly limited", async () => {
    const user = await registerAndLogin("email-same");
    assert.equal((await emailChangeAttempt(user)).response.status, 401);
    assert.equal((await emailChangeAttempt(user)).response.status, 401);
    const third = await emailChangeAttempt(user);
    assert.equal(third.response.status, 429);
    assert.equal(third.data.error.code, "RATE_LIMIT_EXCEEDED");
});

test("email change request: a request without a token is rejected with 401", async () => {
    const result = await api("/api/account/email-change-requests", {
        method: "POST",
        body: { newEmail: "nobody@example.test", currentPassword: "x" }
    });
    assert.equal(result.response.status, 401);
});
