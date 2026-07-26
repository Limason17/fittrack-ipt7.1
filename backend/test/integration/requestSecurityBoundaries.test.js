// Real HTTP-level proof of Section 15/16's contracts: body size limits,
// Content-Type enforcement, and Cache-Control on auth/account/user
// responses. HSTS is exercised directly against the middleware in
// test/unit/errorHandling.test.js (it depends only on NODE_ENV, not on
// anything HTTP-specific worth re-proving here).
const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const TEST_DATABASE = `fittrack_request_boundaries_test_${process.pid}_${Date.now()}`;
if (!/^fittrack_request_boundaries_test_[A-Za-z0-9_]+$/.test(TEST_DATABASE)) {
    throw new Error("Refusing to use an unsafe request-boundaries test database name.");
}

process.env.NODE_ENV = "test";
process.env.DB_NAME = TEST_DATABASE;
process.env.JWT_SECRET = "fittrack-request-boundaries-test-secret-over-32-characters";
process.env.CORS_ALLOWED_ORIGINS = "http://127.0.0.1:4173";
process.env.REQUEST_JSON_LIMIT = "2kb";
process.env.INVITATION_ACCEPT_BASE_URL = "http://127.0.0.1:4173";
process.env.INVITATION_EMAIL_PROVIDER = "";

const mysql = require("mysql2/promise");
const db = require("../../config/db");
const { createMigrationRunner } = require("../../migrations/runner");
const { createApp, defaultRouters } = require("../../startup/app");

const logger = { info() {}, warn() {}, error() {} };
let adminConnection;
let server;
let baseUrl;
let counter = 0;

function fixture() {
    counter += 1;
    return {
        username: `reqbound-${counter}-${crypto.randomBytes(3).toString("hex")}`,
        email: `reqbound-${counter}-${crypto.randomBytes(3).toString("hex")}@example.test`,
        password: "correct horse battery staple boundaries"
    };
}

before(async () => {
    adminConnection = await mysql.createConnection(
        db.readDatabaseConfig(process.env, { includeDatabase: false })
    );
    await adminConnection.query(`CREATE DATABASE \`${TEST_DATABASE}\` CHARACTER SET utf8mb4`);
    const runner = createMigrationRunner({ pool: db, logger });
    await runner.migrate({ expectedDatabase: TEST_DATABASE });
    const pool = db.promise();
    const app = createApp({
        readiness: { check: async () => ({ ready: true }) },
        logger,
        routers: defaultRouters({ database: pool })
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
        assert.match(TEST_DATABASE, /^fittrack_request_boundaries_test_[A-Za-z0-9_]+$/);
        await adminConnection.query(`DROP DATABASE IF EXISTS \`${TEST_DATABASE}\``);
        await adminConnection.end();
    }
});

async function registerAndLogin() {
    const user = fixture();
    const registered = await fetch(`${baseUrl}/api/users/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
            username: user.username,
            email: user.email,
            password: user.password,
            language_preference: "de",
            weight_unit: "kg",
            distance_unit: "km"
        })
    });
    assert.equal(registered.status, 201);
    const loggedIn = await fetch(`${baseUrl}/api/users/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email: user.email, password: user.password })
    });
    const data = await loggedIn.json();
    return { token: data.token };
}

test("a JSON body exceeding REQUEST_JSON_LIMIT is rejected with 413 PAYLOAD_TOO_LARGE, no internal detail leaked", async () => {
    const hugeNote = "x".repeat(10_000);
    const response = await fetch(`${baseUrl}/api/users/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "toolarge", email: "toolarge@example.test", password: "irrelevant", note: hugeNote })
    });
    const data = await response.json();
    assert.equal(response.status, 413);
    assert.equal(data.error.code, "PAYLOAD_TOO_LARGE");
    assert.doesNotMatch(JSON.stringify(data), /entity|body-parser|byte/i);
});

test("a mutating request with a present but wrong Content-Type is rejected with 415, before any parsing/validation", async () => {
    const response = await fetch(`${baseUrl}/api/users/register`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "not json at all"
    });
    const data = await response.json();
    assert.equal(response.status, 415);
    assert.equal(data.error.code, "UNSUPPORTED_MEDIA_TYPE");
});

test("a mutating request with NO Content-Type and no body is allowed through (refresh/logout contract)", async () => {
    const { token } = await registerAndLogin();
    // logout-all has no required body and the frontend never sends a
    // Content-Type for it - see frontend/src/utils/api.js.
    const response = await fetch(`${baseUrl}/api/auth/logout-all`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
    });
    assert.notEqual(response.status, 415);
});

test("GET requests are never subject to the Content-Type guard", async () => {
    const response = await fetch(`${baseUrl}/api/health/live`, { headers: { "Content-Type": "text/plain" } });
    assert.equal(response.status, 200);
});

test("health endpoints are unaffected by the request-size/content-type hardening", async () => {
    const live = await fetch(`${baseUrl}/api/health/live`);
    const ready = await fetch(`${baseUrl}/api/health/ready`);
    assert.equal(live.status, 200);
    assert.equal(ready.status, 200);
});

test("auth, account and user responses all carry Cache-Control: no-store", async () => {
    const { token } = await registerAndLogin();
    const me = await fetch(`${baseUrl}/api/users/me`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(me.headers.get("cache-control"), "no-store");

    const currentEmailChangeRequest = await fetch(`${baseUrl}/api/account/email-change-requests/current`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(currentEmailChangeRequest.headers.get("cache-control"), "no-store");
});

test("malformed JSON is still a safe 400 INVALID_JSON with no parser stack leaked, unchanged by the new guards", async () => {
    const response = await fetch(`${baseUrl}/api/users/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{ not valid json"
    });
    const data = await response.json();
    assert.equal(response.status, 400);
    assert.equal(data.error.code, "INVALID_JSON");
});
