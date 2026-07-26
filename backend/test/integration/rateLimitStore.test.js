// Direct, real-database proof of rateLimiting/mysqlRateLimitStore.js's
// atomicity and data-shape contract - independent of any Express router.
// Multi-INSTANCE proof (two full Express apps sharing one database) lives
// in test/integration/rateLimitMultiInstance.test.js; this file is about
// the store's own guarantees: window rollover, parallel-request exactness,
// no plaintext keys ever hitting the table, store-outage behaviour, and the
// cleanup command.
const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mysql = require("mysql2/promise");

const RUN_INTEGRATION = process.env.FITTRACK_RUN_DB_INTEGRATION !== "false";
const TEST_DATABASE = `fittrack_rate_limit_store_test_${process.pid}_${Date.now()}`;
if (!/^fittrack_rate_limit_store_test_[A-Za-z0-9_]+$/.test(TEST_DATABASE)) {
    throw new Error("Refusing to use an unsafe rate-limit store test database name.");
}

process.env.NODE_ENV = "test";
process.env.DB_NAME = TEST_DATABASE;
process.env.JWT_SECRET = "fittrack-rate-limit-store-test-secret-over-32-characters";

const db = require("../../config/db");
const { createMigrationRunner } = require("../../migrations/runner");
const { createMySqlRateLimitStore } = require("../../rateLimiting/mysqlRateLimitStore");
const { cleanupExpiredBuckets } = require("../../rateLimiting/rateLimitCleanup");
const { RateLimitStoreUnavailableError } = require("../../errors/RateLimitErrors");
const { hashRateLimitKey } = require("../../rateLimiting/rateLimitKeys");

const logger = { info() {}, warn() {}, error() {} };
let adminConnection;
let pool;

before(async () => {
    adminConnection = await mysql.createConnection(
        db.readDatabaseConfig(process.env, { includeDatabase: false })
    );
    await adminConnection.query(`CREATE DATABASE \`${TEST_DATABASE}\` CHARACTER SET utf8mb4`);
    const runner = createMigrationRunner({ pool: db, logger });
    await runner.migrate({ expectedDatabase: TEST_DATABASE });
    pool = db.promise();
});

after(async () => {
    await db.closePool(db);
    if (adminConnection) {
        assert.match(TEST_DATABASE, /^fittrack_rate_limit_store_test_[A-Za-z0-9_]+$/);
        await adminConnection.query(`DROP DATABASE IF EXISTS \`${TEST_DATABASE}\``);
        await adminConnection.end();
    }
});

function key(raw) {
    return hashRateLimitKey("a".repeat(32), raw);
}

test("consume() allows exactly `max` requests within a window and then blocks", { skip: !RUN_INTEGRATION }, async () => {
    const store = createMySqlRateLimitStore({ database: pool });
    const policyId = "test.threshold";
    const keyHash = key(`threshold-${crypto.randomUUID()}`);
    const now = Date.now();

    const results = [];
    for (let i = 0; i < 5; i += 1) {
        results.push(await store.consume({ policyId, keyHash, windowMs: 60_000, max: 3, now }));
    }

    assert.deepEqual(results.map((r) => r.allowed), [true, true, true, false, false]);
    assert.equal(results[2].remaining, 0);
    assert.ok(results[3].retryAfterSeconds > 0);
});

test("window rollover is atomic: a request after the window elapses gets a fresh count of 1, not an accumulated one", { skip: !RUN_INTEGRATION }, async () => {
    const store = createMySqlRateLimitStore({ database: pool });
    const policyId = "test.rollover";
    const keyHash = key(`rollover-${crypto.randomUUID()}`);
    let now = Date.now();

    await store.consume({ policyId, keyHash, windowMs: 1000, max: 1, now });
    const blocked = await store.consume({ policyId, keyHash, windowMs: 1000, max: 1, now });
    assert.equal(blocked.allowed, false);

    now += 1001;
    const afterRollover = await store.consume({ policyId, keyHash, windowMs: 1000, max: 1, now });
    assert.equal(afterRollover.allowed, true);
    assert.equal(afterRollover.remaining, 0);
});

test("parallel requests racing the same key never let more than `max` through, and no negative Retry-After ever occurs", { skip: !RUN_INTEGRATION }, async () => {
    const store = createMySqlRateLimitStore({ database: pool });
    const policyId = "test.parallel";
    const keyHash = key(`parallel-${crypto.randomUUID()}`);
    const now = Date.now();
    const max = 10;

    const results = await Promise.all(
        Array.from({ length: 30 }, () => store.consume({ policyId, keyHash, windowMs: 60_000, max, now }))
    );

    const allowedCount = results.filter((r) => r.allowed).length;
    assert.equal(allowedCount, max, "exactly max requests must be allowed, never more, even under true concurrency");
    for (const result of results) {
        assert.ok(result.retryAfterSeconds >= 0, "retryAfterSeconds must never be negative");
    }
});

test("two independent store instances against the same pool/table observe and enforce one shared quota", { skip: !RUN_INTEGRATION }, async () => {
    const storeA = createMySqlRateLimitStore({ database: pool });
    const storeB = createMySqlRateLimitStore({ database: pool });
    const policyId = "test.shared-instances";
    const keyHash = key(`shared-${crypto.randomUUID()}`);
    const now = Date.now();

    const first = await storeA.consume({ policyId, keyHash, windowMs: 60_000, max: 2, now });
    const second = await storeB.consume({ policyId, keyHash, windowMs: 60_000, max: 2, now });
    const third = await storeA.consume({ policyId, keyHash, windowMs: 60_000, max: 2, now });

    assert.equal(first.allowed, true);
    assert.equal(second.allowed, true);
    assert.equal(third.allowed, false, "storeB's consumption must count against storeA's view of the same bucket");
});

test("the persisted bucket never contains the raw key, only a 32-byte key_hash and integer/timestamp bookkeeping", { skip: !RUN_INTEGRATION }, async () => {
    const store = createMySqlRateLimitStore({ database: pool });
    const rawKey = "login|attacker@example.test|203.0.113.7";
    const keyHash = hashRateLimitKey("a".repeat(32), rawKey);
    await store.consume({ policyId: "test.no-plaintext", keyHash, windowMs: 60_000, max: 5, now: Date.now() });

    const [rows] = await pool.query(
        "SELECT policy_id, key_hash, request_count, window_started_at, blocked_until, expires_at, created_at, updated_at FROM security_rate_limit_buckets WHERE policy_id = ?",
        ["test.no-plaintext"]
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].key_hash.length, 32);
    assert.equal(rows[0].key_hash.toString("utf8").includes("attacker"), false);
    assert.equal(rows[0].key_hash.toString("utf8").includes("203.0.113.7"), false);
    assert.deepEqual(rows[0].key_hash, keyHash);

    const rawTableDump = JSON.stringify(rows[0], (name, value) =>
        Buffer.isBuffer(value) ? value.toString("hex") : value
    );
    assert.equal(rawTableDump.includes("attacker"), false);
    assert.equal(rawTableDump.includes("example.test"), false);
    assert.equal(rawTableDump.includes("203.0.113.7"), false);
});

test("blocked_until is set only once the bucket is over its limit, and cleared again on the next fresh window", { skip: !RUN_INTEGRATION }, async () => {
    const store = createMySqlRateLimitStore({ database: pool });
    const policyId = "test.blocked-until";
    const keyHash = key(`blocked-until-${crypto.randomUUID()}`);
    let now = Date.now();

    await store.consume({ policyId, keyHash, windowMs: 1000, max: 1, now });
    await store.consume({ policyId, keyHash, windowMs: 1000, max: 1, now });
    const [[overLimitRow]] = await pool.query(
        "SELECT blocked_until FROM security_rate_limit_buckets WHERE policy_id = ? AND key_hash = ?",
        [policyId, keyHash]
    );
    assert.notEqual(overLimitRow.blocked_until, null);

    now += 1001;
    await store.consume({ policyId, keyHash, windowMs: 1000, max: 1, now });
    const [[freshRow]] = await pool.query(
        "SELECT blocked_until FROM security_rate_limit_buckets WHERE policy_id = ? AND key_hash = ?",
        [policyId, keyHash]
    );
    assert.equal(freshRow.blocked_until, null);
});

test("a store built on a closed pool fails closed with RateLimitStoreUnavailableError, never a silent allow", { skip: !RUN_INTEGRATION }, async () => {
    const brokenPool = db.createPool({ ...db.readDatabaseConfig(), database: TEST_DATABASE, port: 1 }).promise();
    const store = createMySqlRateLimitStore({ database: brokenPool });
    await assert.rejects(
        () => store.consume({ policyId: "test.outage", keyHash: key("outage"), windowMs: 60_000, max: 5, now: Date.now() }),
        RateLimitStoreUnavailableError
    );
    await brokenPool.end();
});

test("cleanupExpiredBuckets removes only buckets whose window has fully expired, never an active bucket", { skip: !RUN_INTEGRATION }, async () => {
    const store = createMySqlRateLimitStore({ database: pool });
    const expiredKey = key(`cleanup-expired-${crypto.randomUUID()}`);
    const activeKey = key(`cleanup-active-${crypto.randomUUID()}`);
    const baseNow = Date.now();

    await store.consume({ policyId: "test.cleanup", keyHash: expiredKey, windowMs: 1000, max: 5, now: baseNow });
    await store.consume({ policyId: "test.cleanup", keyHash: activeKey, windowMs: 60_000, max: 5, now: baseNow });

    const result = await cleanupExpiredBuckets({ database: pool, now: () => baseNow + 5000 });
    assert.ok(result.deleted >= 1);

    const [[expiredCount]] = await pool.query(
        "SELECT COUNT(*) AS total FROM security_rate_limit_buckets WHERE policy_id = 'test.cleanup' AND key_hash = ?",
        [expiredKey]
    );
    const [[activeCount]] = await pool.query(
        "SELECT COUNT(*) AS total FROM security_rate_limit_buckets WHERE policy_id = 'test.cleanup' AND key_hash = ?",
        [activeKey]
    );
    assert.equal(Number(expiredCount.total), 0, "the expired bucket must be deleted");
    assert.equal(Number(activeCount.total), 1, "the still-active bucket must survive cleanup");
});

test("cleanupExpiredBuckets is idempotent - a second run finds nothing left to delete", { skip: !RUN_INTEGRATION }, async () => {
    const store = createMySqlRateLimitStore({ database: pool });
    const keyHash = key(`cleanup-idempotent-${crypto.randomUUID()}`);
    const baseNow = Date.now();
    await store.consume({ policyId: "test.cleanup-idempotent", keyHash, windowMs: 1000, max: 5, now: baseNow });

    const first = await cleanupExpiredBuckets({ database: pool, now: () => baseNow + 5000 });
    const second = await cleanupExpiredBuckets({ database: pool, now: () => baseNow + 5000 });
    assert.ok(first.deleted >= 1);
    assert.equal(second.deleted, 0);
});
