const test = require("node:test");
const assert = require("node:assert/strict");
const fsPromises = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const { diagnoseDeletionReceipts, EXIT_CODES, STATE } = require("../../deletionReceipts/deletionReceiptDoctor");
const { publishReceipt } = require("../../deletionReceipts/deletionReceiptStore");
const { buildReceipt, generateReceiptId } = require("../../security/deletionReceipts");

function fakeConnection(usersById) {
    return {
        async query(sql, params) {
            if (sql.includes("WHERE id = ?") && sql.includes("FROM users")) {
                const [id] = params;
                const row = usersById.get(id);
                return [row ? [{ lifecycle_status: row.lifecycleStatus }] : []];
            }
            if (sql.includes("lifecycle_status = 'deleted'")) {
                const rows = [...usersById.entries()]
                    .filter(([, value]) => value.lifecycleStatus === "deleted")
                    .map(([id]) => ({ id }));
                return [rows];
            }
            throw new Error(`fakeConnection received an unexpected query: ${sql}`);
        }
    };
}

async function withTempDir(callback) {
    const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "fittrack-deletion-receipt-doctor-test-"));
    try {
        await callback(dir);
    } finally {
        await fsPromises.rm(dir, { recursive: true, force: true });
    }
}

function readConfigFor(directory, hmacKey) {
    return () => ({ configured: true, directory, key: hmacKey, keyId: "doctor-test-key" });
}

test("not configured in development is reported as ready:true, state 'not_configured'", async () => {
    const report = await diagnoseDeletionReceipts({
        connection: fakeConnection(new Map()),
        readConfig: () => ({ configured: false }),
        env: { NODE_ENV: "development" }
    });
    assert.equal(report.state, STATE.NOT_CONFIGURED);
    assert.equal(report.ready, true);
    assert.equal(report.exitCode, EXIT_CODES.READY);
});

test("not configured in production fails closed", async () => {
    const report = await diagnoseDeletionReceipts({
        connection: fakeConnection(new Map()),
        readConfig: () => ({ configured: false }),
        env: { NODE_ENV: "production" }
    });
    assert.equal(report.state, STATE.CONFIGURATION_UNSAFE);
    assert.equal(report.ready, false);
    assert.equal(report.exitCode, EXIT_CODES.CONFIGURATION_UNSAFE);
    assert.ok(report.configurationIssues.length > 0);
});

test("a throwing config reader is reported as configuration_unsafe, never crashes the doctor", async () => {
    const report = await diagnoseDeletionReceipts({
        connection: fakeConnection(new Map()),
        readConfig: () => {
            throw new Error("INVALID_DELETION_RECEIPT_CONFIG: bad key");
        },
        env: {}
    });
    assert.equal(report.state, STATE.CONFIGURATION_UNSAFE);
    assert.equal(report.ready, false);
});

test("an empty, configured receipt directory reports ready with zero counts", async () => {
    await withTempDir(async (dir) => {
        const report = await diagnoseDeletionReceipts({
            connection: fakeConnection(new Map()),
            readConfig: readConfigFor(dir, crypto.randomBytes(32)),
            env: {}
        });
        assert.equal(report.state, STATE.READY);
        assert.equal(report.ready, true);
        assert.equal(report.receiptCount, 0);
        assert.equal(report.deletedAccountCount, 0);
        assert.deepEqual(report.missingReceipts, []);
        assert.deepEqual(report.restoredActiveAccounts, []);
    });
});

test("a valid receipt for a hard-deleted account (row absent) is consistent, not flagged", async () => {
    await withTempDir(async (dir) => {
        const hmacKey = crypto.randomBytes(32);
        const receipt = buildReceipt({
            receiptId: generateReceiptId(),
            accountRef: 42,
            lifecycleAction: "deleted",
            deletedAt: new Date(),
            key: hmacKey,
            keyId: "doctor-test-key"
        });
        await publishReceipt(dir, receipt);

        const report = await diagnoseDeletionReceipts({
            connection: fakeConnection(new Map()), // no row at all: hard-delete case
            readConfig: readConfigFor(dir, hmacKey),
            env: {}
        });
        assert.equal(report.state, STATE.READY);
        assert.equal(report.receiptCount, 1);
        assert.equal(report.deletedAccountCount, 1);
        assert.deepEqual(report.restoredActiveAccounts, []);
    });
});

test("a valid receipt whose account row shows 'active' (post-restore) is flagged as restoredActiveAccounts", async () => {
    await withTempDir(async (dir) => {
        const hmacKey = crypto.randomBytes(32);
        const receipt = buildReceipt({
            receiptId: generateReceiptId(),
            accountRef: 7,
            lifecycleAction: "deleted",
            deletedAt: new Date(),
            key: hmacKey,
            keyId: "doctor-test-key"
        });
        await publishReceipt(dir, receipt);

        const usersById = new Map([[7, { lifecycleStatus: "active" }]]);
        const report = await diagnoseDeletionReceipts({
            connection: fakeConnection(usersById),
            readConfig: readConfigFor(dir, hmacKey),
            env: {}
        });
        assert.equal(report.state, STATE.RECOVERY_REQUIRED);
        assert.equal(report.ready, false);
        assert.equal(report.exitCode, EXIT_CODES.RECOVERY_REQUIRED);
        assert.deepEqual(report.restoredActiveAccounts, [7]);
    });
});

test("a receipt whose HMAC does not verify is reported as corrupted and fails closed", async () => {
    await withTempDir(async (dir) => {
        const hmacKey = crypto.randomBytes(32);
        const receipt = buildReceipt({
            receiptId: generateReceiptId(),
            accountRef: 1,
            lifecycleAction: "deleted",
            deletedAt: new Date(),
            key: hmacKey,
            keyId: "doctor-test-key"
        });
        const tampered = { ...receipt, accountRef: 999 };
        await publishReceipt(dir, tampered);

        const report = await diagnoseDeletionReceipts({
            connection: fakeConnection(new Map()),
            readConfig: readConfigFor(dir, hmacKey),
            env: {}
        });
        assert.equal(report.state, STATE.RECOVERY_REQUIRED);
        assert.equal(report.ready, false);
        assert.equal(report.corruptedReceipts.length, 1);
    });
});

test("a receipt with an unknown/future schema version is reported separately from corrupted receipts, and fails closed", async () => {
    await withTempDir(async (dir) => {
        const hmacKey = crypto.randomBytes(32);
        const receipt = buildReceipt({
            receiptId: generateReceiptId(),
            accountRef: 1,
            lifecycleAction: "deleted",
            deletedAt: new Date(),
            key: hmacKey,
            keyId: "doctor-test-key"
        });
        const futureVersion = { ...receipt, schemaVersion: 2 };
        await publishReceipt(dir, futureVersion);

        const report = await diagnoseDeletionReceipts({
            connection: fakeConnection(new Map()),
            readConfig: readConfigFor(dir, hmacKey),
            env: {}
        });
        assert.equal(report.state, STATE.RECOVERY_REQUIRED);
        assert.equal(report.unknownReceipts.length, 1);
        assert.equal(report.corruptedReceipts.length, 0);
    });
});

test("a deleted account row with no receipt at all is reported in missingReceipts, but does not fail closed on its own", async () => {
    await withTempDir(async (dir) => {
        const hmacKey = crypto.randomBytes(32);
        const usersById = new Map([[5, { lifecycleStatus: "deleted" }]]);
        const report = await diagnoseDeletionReceipts({
            connection: fakeConnection(usersById),
            readConfig: readConfigFor(dir, hmacKey),
            env: {}
        });
        assert.equal(report.state, STATE.READY);
        assert.equal(report.ready, true);
        assert.deepEqual(report.missingReceipts, [5]);
    });
});

test("malformed (non-JSON) receipt files are reported as corrupted", async () => {
    await withTempDir(async (dir) => {
        await fsPromises.mkdir(dir, { recursive: true });
        await fsPromises.writeFile(path.join(dir, `${crypto.randomUUID()}.json`), "{ not valid json !!");

        const report = await diagnoseDeletionReceipts({
            connection: fakeConnection(new Map()),
            readConfig: readConfigFor(dir, crypto.randomBytes(32)),
            env: {}
        });
        assert.equal(report.state, STATE.RECOVERY_REQUIRED);
        assert.equal(report.corruptedReceipts.length, 1);
    });
});
