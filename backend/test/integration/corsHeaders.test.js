// Real HTTP-level proof of the `cors` middleware wiring in startup/app.js -
// exact header values, preflight handling, and what a disallowed/evil
// origin does and does NOT receive. This complements (not replaces) the
// genuine browser-based CORS tests in frontend/e2e (Section 14 is explicit
// that Supertest/fetch-only coverage is not sufficient on its own, since a
// raw HTTP client - unlike a browser - never itself enforces CORS; what it
// CAN prove is that the server sends the right headers for a real browser
// to enforce against).
const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const TEST_DATABASE = `fittrack_cors_headers_test_${process.pid}_${Date.now()}`;
if (!/^fittrack_cors_headers_test_[A-Za-z0-9_]+$/.test(TEST_DATABASE)) {
    throw new Error("Refusing to use an unsafe CORS headers test database name.");
}

process.env.NODE_ENV = "test";
process.env.DB_NAME = TEST_DATABASE;
process.env.JWT_SECRET = "fittrack-cors-headers-test-secret-over-32-characters";
process.env.CORS_ALLOWED_ORIGINS = "http://allowed.example.test:5173";
process.env.CORS_ALLOW_CREDENTIALS = "true";
process.env.CORS_MAX_AGE_SECONDS = "123";
process.env.INVITATION_ACCEPT_BASE_URL = "http://allowed.example.test:5173";
process.env.INVITATION_EMAIL_PROVIDER = "";

const mysql = require("mysql2/promise");
const db = require("../../config/db");
const { createMigrationRunner } = require("../../migrations/runner");
const { createApp, defaultRouters } = require("../../startup/app");

const logger = { info() {}, warn() {}, error() {} };
let adminConnection;
let server;
let baseUrl;

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
        assert.match(TEST_DATABASE, /^fittrack_cors_headers_test_[A-Za-z0-9_]+$/);
        await adminConnection.query(`DROP DATABASE IF EXISTS \`${TEST_DATABASE}\``);
        await adminConnection.end();
    }
});

function uniqueEmail() {
    return `cors-${crypto.randomBytes(4).toString("hex")}@example.test`;
}

test("an allowed origin gets its exact value reflected, Vary: Origin, and credentials allowed", async () => {
    const response = await fetch(`${baseUrl}/api/users/register`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Origin: "http://allowed.example.test:5173"
        },
        body: JSON.stringify({
            username: `corsuser${crypto.randomBytes(3).toString("hex")}`,
            email: uniqueEmail(),
            password: "correct horse battery staple cors",
            language_preference: "de",
            weight_unit: "kg",
            distance_unit: "km"
        })
    });
    assert.equal(response.headers.get("access-control-allow-origin"), "http://allowed.example.test:5173");
    assert.equal(response.headers.get("access-control-allow-credentials"), "true");
    assert.match(response.headers.get("vary") || "", /origin/i);
    assert.notEqual(response.headers.get("access-control-allow-origin"), "*");
});

test("preflight for an allowed origin reports minimal methods/headers and the configured max-age", async () => {
    const response = await fetch(`${baseUrl}/api/users/register`, {
        method: "OPTIONS",
        headers: {
            Origin: "http://allowed.example.test:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type"
        }
    });
    assert.ok(response.status === 204 || response.status === 200, `unexpected preflight status ${response.status}`);
    assert.equal(response.headers.get("access-control-allow-origin"), "http://allowed.example.test:5173");
    assert.equal(response.headers.get("access-control-max-age"), "123");
    const allowedMethods = (response.headers.get("access-control-allow-methods") || "").split(",").map((m) => m.trim());
    assert.ok(allowedMethods.includes("POST"));
    assert.equal(allowedMethods.includes("TRACE"), false, "the allowed method list must be minimal, not a wildcard/broad default");
    const allowedHeaders = (response.headers.get("access-control-allow-headers") || "").toLowerCase();
    assert.ok(allowedHeaders.includes("content-type"));
});

test("a disallowed origin receives no permissive CORS header of any kind", async () => {
    const response = await fetch(`${baseUrl}/api/users/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://evil.example.test" },
        body: JSON.stringify({
            username: `corsevil${crypto.randomBytes(3).toString("hex")}`,
            email: uniqueEmail(),
            password: "correct horse battery staple cors",
            language_preference: "de",
            weight_unit: "kg",
            distance_unit: "km"
        })
    });
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.equal(response.headers.get("access-control-allow-credentials"), null);
});

test("a lookalike suffix domain of an allowed origin is never treated as allowed", async () => {
    const response = await fetch(`${baseUrl}/api/health/live`, {
        headers: { Origin: "http://allowed.example.test.evil.test:5173" }
    });
    assert.equal(response.headers.get("access-control-allow-origin"), null);
});

test('a literal Origin: "null" header is never treated as allowed', async () => {
    const response = await fetch(`${baseUrl}/api/health/live`, {
        headers: { Origin: "null" }
    });
    assert.equal(response.headers.get("access-control-allow-origin"), null);
});

test("no configured origin ever results in a wildcard Access-Control-Allow-Origin", async () => {
    for (const origin of ["http://allowed.example.test:5173", "http://evil.example.test", "null"]) {
        const response = await fetch(`${baseUrl}/api/health/live`, { headers: { Origin: origin } });
        assert.notEqual(response.headers.get("access-control-allow-origin"), "*");
    }
});

test("a request with no Origin header (non-browser caller) is still served, unaffected by the allowlist", async () => {
    const response = await fetch(`${baseUrl}/api/health/live`);
    assert.equal(response.status, 200);
});
