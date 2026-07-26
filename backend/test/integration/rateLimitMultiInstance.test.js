// Section 19: proves the shared-quota contract across genuinely separate
// Express application instances, not just separate middleware objects on
// one app. Two full createApp()+listen() instances are built independently
// (their own composition root call, their own HTTP server, their own port)
// and wired only through the one thing they are supposed to share: the same
// MySQL database/table (see rateLimiting/mysqlRateLimitStore.js). Neither
// instance's Express/Node module state is shared with the other, so the
// only way traffic against instance A can affect instance B's decisions is
// through the database - exactly the real multi-process deployment this
// guards against.
//
// routes/users.js builds its login/registration rate limiters once, at
// module-require time, from whatever AUTH_*_RATE_LIMIT_* env vars are set
// at that moment - exactly like the pre-Stage-3D code it replaces (see that
// file's module-level `createRateLimiters(...)` call). That means every
// env override this file needs must be set BEFORE the first
// require("../../startup/app") anywhere in this process (at the top of this
// file, not inside a test body), and every registration-based test below
// shares one fixed max/window: tests get a clean window by waiting out a
// short, fixed window rather than by re-configuring the limit per test.
const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mysql = require("mysql2/promise");

const RUN_INTEGRATION = process.env.FITTRACK_RUN_DB_INTEGRATION !== "false";
const TEST_DATABASE = `fittrack_rate_limit_multi_test_${process.pid}_${Date.now()}`;
if (!/^fittrack_rate_limit_multi_test_[A-Za-z0-9_]+$/.test(TEST_DATABASE)) {
    throw new Error("Refusing to use an unsafe multi-instance test database name.");
}

process.env.NODE_ENV = "test";
process.env.DB_NAME = TEST_DATABASE;
process.env.JWT_SECRET = "fittrack-rate-limit-multi-test-secret-over-32-characters";
process.env.AUTH_LOGIN_RATE_LIMIT_MAX = "1000";
process.env.AUTH_REGISTRATION_RATE_LIMIT_MAX = "5";
process.env.AUTH_REGISTRATION_RATE_LIMIT_WINDOW_MS = "2000";
process.env.INVITATION_ACCEPT_BASE_URL = "http://127.0.0.1:4173";
process.env.INVITATION_EMAIL_PROVIDER = "";

const db = require("../../config/db");
const { createMigrationRunner } = require("../../migrations/runner");
const { createApp, defaultRouters } = require("../../startup/app");

const REGISTRATION_WINDOW_MS = 2000;
const logger = { info() {}, warn() {}, error() {} };
let adminConnection;
let pool;
let instanceA;
let instanceB;
let counter = 0;

function fixture() {
    counter += 1;
    return {
        username: `mi-${counter}-${crypto.randomBytes(3).toString("hex")}`,
        email: `mi-${counter}-${crypto.randomBytes(3).toString("hex")}@example.test`,
        password: "correct horse battery staple multi-instance"
    };
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startInstance(overrides = {}) {
    const routers = defaultRouters({ database: pool, ...overrides });
    const app = createApp({ readiness: { check: async () => ({ ready: true }) }, logger, routers });
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
    });
    return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

async function register(baseUrl) {
    const user = fixture();
    const response = await fetch(`${baseUrl}/api/users/register`, {
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
    const data = await response.json();
    return { status: response.status, data, headers: response.headers };
}

// Waits out a full registration window plus margin so the shared (IP-keyed)
// bucket that every test in this file necessarily uses starts fresh -
// there is no per-test key isolation available for this policy (see the
// module-level comment above).
async function waitForFreshRegistrationWindow() {
    await delay(REGISTRATION_WINDOW_MS + 300);
}

before(async () => {
    adminConnection = await mysql.createConnection(
        db.readDatabaseConfig(process.env, { includeDatabase: false })
    );
    await adminConnection.query(`CREATE DATABASE \`${TEST_DATABASE}\` CHARACTER SET utf8mb4`);
    const runner = createMigrationRunner({ pool: db, logger });
    await runner.migrate({ expectedDatabase: TEST_DATABASE });
    pool = db.promise();

    instanceA = await startInstance();
    instanceB = await startInstance();
});

after(async () => {
    if (instanceA) await new Promise((resolve) => instanceA.server.close(resolve));
    if (instanceB) await new Promise((resolve) => instanceB.server.close(resolve));
    await db.closePool(db);
    if (adminConnection) {
        assert.match(TEST_DATABASE, /^fittrack_rate_limit_multi_test_[A-Za-z0-9_]+$/);
        await adminConnection.query(`DROP DATABASE IF EXISTS \`${TEST_DATABASE}\``);
        await adminConnection.end();
    }
});

test(
    "registration (IP-keyed) shares one quota across two independent app instances - alternating requests",
    { skip: !RUN_INTEGRATION },
    async () => {
        await waitForFreshRegistrationWindow();
        // Both instances run in the same test process and therefore make
        // their outbound HTTP calls from the same loopback address, so both
        // see the exact same IP-derived rate-limit key - exactly the "two
        // instances behind one load balancer, one client IP" scenario this
        // section exists to prove.
        const sequence = [instanceA, instanceB, instanceA, instanceB, instanceA, instanceB];
        const results = [];
        for (const instance of sequence) {
            results.push(await register(instance.baseUrl));
        }
        assert.deepEqual(
            results.map((r) => r.status),
            [201, 201, 201, 201, 201, 429],
            JSON.stringify(results.map((r) => ({ status: r.status, body: r.data })))
        );
        assert.equal(results[5].data.error.code, "RATE_LIMIT_EXCEEDED");
        assert.ok(Number(results[5].headers.get("retry-after")) > 0);
    }
);

test(
    "parallel requests split across both instances never let more than the configured quota through",
    { skip: !RUN_INTEGRATION },
    async () => {
        await waitForFreshRegistrationWindow();
        const calls = Array.from({ length: 15 }, (_, i) =>
            register(i % 2 === 0 ? instanceA.baseUrl : instanceB.baseUrl));
        const results = await Promise.all(calls);
        const successCount = results.filter((r) => r.status === 201).length;
        const limitedCount = results.filter((r) => r.status === 429).length;
        assert.equal(successCount, 5, "exactly the configured quota must succeed, split across both instances");
        assert.equal(limitedCount, 10);
        for (const result of results.filter((r) => r.status === 429)) {
            assert.equal(result.data.error.code, "RATE_LIMIT_EXCEEDED");
            assert.ok(Number(result.headers.get("retry-after")) > 0);
        }
    }
);

test(
    "the window rollover is honoured across instances: after the shared window elapses, both instances allow traffic again",
    { skip: !RUN_INTEGRATION },
    async () => {
        await waitForFreshRegistrationWindow();
        for (let i = 0; i < 5; i += 1) {
            const result = await register(instanceA.baseUrl);
            assert.equal(result.status, 201, `request ${i} should still be within quota`);
        }
        const blocked = await register(instanceB.baseUrl);
        assert.equal(blocked.status, 429);

        await delay(REGISTRATION_WINDOW_MS + 300);

        const afterRollover = await register(instanceB.baseUrl);
        assert.equal(afterRollover.status, 201, "a fresh window must allow a request again on the OTHER instance too");
    }
);

test(
    "a rate-limit store outage fails closed with 503 on a fresh instance, and never silently falls back to an unlimited allow",
    { skip: !RUN_INTEGRATION },
    async () => {
        const brokenPool = db.createPool({ ...db.readDatabaseConfig(), database: TEST_DATABASE, port: 1 }).promise();
        // /api/account/email-change-confirmations is public (no
        // Authorization header needed) and its rate limiter runs before any
        // service/database call, so this exercises the limiter's own
        // outage handling in isolation from account-service behaviour.
        const { server, baseUrl } = await startInstance({ database: brokenPool });
        try {
            const response = await fetch(`${baseUrl}/api/account/email-change-confirmations`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify({ token: "irrelevant-token-value" })
            });
            const data = await response.json();
            assert.equal(response.status, 503);
            assert.equal(data.error.code, "RATE_LIMIT_BACKEND_UNAVAILABLE");
            assert.doesNotMatch(JSON.stringify(data), /ECONNREFUSED|sql|mysql/i);
        } finally {
            await new Promise((resolve) => server.close(resolve));
            await brokenPool.end();
        }
    }
);
