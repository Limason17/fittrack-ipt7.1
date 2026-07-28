const test = require("node:test");
const assert = require("node:assert/strict");
const fsPromises = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const {
    findValidReceiptForAccount,
    listReceiptFiles,
    publishReceipt,
    readReceiptFile,
    receiptFilePath
} = require("../../deletionReceipts/deletionReceiptStore");
const { buildReceipt } = require("../../security/deletionReceipts");

async function withTempDir(callback) {
    const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "fittrack-deletion-receipt-store-test-"));
    try {
        await callback(dir);
    } finally {
        await fsPromises.rm(dir, { recursive: true, force: true });
    }
}

function fakeReceipt(receiptId) {
    return {
        schemaVersion: 1,
        receiptId,
        accountRef: 1,
        lifecycleAction: "deleted",
        deletedAt: new Date().toISOString(),
        integrity: { algorithm: "HMAC-SHA256", keyId: "k", signature: "a".repeat(64) }
    };
}

test("publishReceipt creates the directory, writes the file, and leaves no .partial file behind", async () => {
    await withTempDir(async (dir) => {
        const receiptDir = path.join(dir, "nested", "receipts");
        const receiptId = crypto.randomUUID();
        const finalPath = await publishReceipt(receiptDir, fakeReceipt(receiptId));
        assert.equal(finalPath, receiptFilePath(receiptDir, receiptId));

        const entries = await fsPromises.readdir(receiptDir);
        assert.deepEqual(entries, [`${receiptId}.json`]);

        const written = await readReceiptFile(finalPath);
        assert.equal(written.receiptId, receiptId);
    });
});

test("publishReceipt never overwrites an existing receipt with the same id", async () => {
    await withTempDir(async (dir) => {
        const receiptId = crypto.randomUUID();
        await publishReceipt(dir, fakeReceipt(receiptId));
        await assert.rejects(
            () => publishReceipt(dir, { ...fakeReceipt(receiptId), accountRef: 999 }),
            (error) => error.code === "DELETION_RECEIPT_ALREADY_EXISTS"
        );

        // The original content must be intact - not partially overwritten.
        const stillOriginal = await readReceiptFile(receiptFilePath(dir, receiptId));
        assert.equal(stillOriginal.accountRef, 1);

        // The failed attempt's temp file must not linger.
        const entries = await fsPromises.readdir(dir);
        assert.deepEqual(entries, [`${receiptId}.json`]);
    });
});

test("listReceiptFiles returns an empty array for a directory that does not exist yet, and lists only .json files once populated", async () => {
    await withTempDir(async (dir) => {
        const receiptDir = path.join(dir, "not-yet-created");
        assert.deepEqual(await listReceiptFiles(receiptDir), []);

        const idA = crypto.randomUUID();
        const idB = crypto.randomUUID();
        await publishReceipt(receiptDir, fakeReceipt(idA));
        await publishReceipt(receiptDir, fakeReceipt(idB));
        await fsPromises.writeFile(path.join(receiptDir, "not-a-receipt.txt"), "ignore me");

        const files = await listReceiptFiles(receiptDir);
        assert.equal(files.length, 2);
        assert.ok(files.every((file) => file.endsWith(".json")));
    });
});

test("readReceiptFile throws a typed error for a missing file and for malformed JSON", async () => {
    await withTempDir(async (dir) => {
        await assert.rejects(
            () => readReceiptFile(path.join(dir, "missing.json")),
            (error) => error.code === "DELETION_RECEIPT_NOT_FOUND"
        );

        const badPath = path.join(dir, "bad.json");
        await fsPromises.writeFile(badPath, "{ not valid json");
        await assert.rejects(
            () => readReceiptFile(badPath),
            (error) => error.code === "DELETION_RECEIPT_MALFORMED"
        );
    });
});

// ---- findValidReceiptForAccount (receipt-first commit protocol) ----

test("findValidReceiptForAccount finds a valid receipt matching accountRef, and ignores one for a different account", async () => {
    await withTempDir(async (dir) => {
        const key = crypto.randomBytes(32);
        const mine = buildReceipt({
            receiptId: crypto.randomUUID(), accountRef: 42, lifecycleAction: "deleted",
            deletedAt: new Date(), key, keyId: "test-key"
        });
        const someoneElses = buildReceipt({
            receiptId: crypto.randomUUID(), accountRef: 99, lifecycleAction: "deleted",
            deletedAt: new Date(), key, keyId: "test-key"
        });
        await publishReceipt(dir, mine);
        await publishReceipt(dir, someoneElses);

        const found = await findValidReceiptForAccount(dir, 42, key);
        assert.equal(found.accountRef, 42);
        assert.equal(found.receiptId, mine.receiptId);
    });
});

test("findValidReceiptForAccount returns null when no receipt exists for the account", async () => {
    await withTempDir(async (dir) => {
        const key = crypto.randomBytes(32);
        assert.equal(await findValidReceiptForAccount(dir, 1, key), null);

        const someoneElses = buildReceipt({
            receiptId: crypto.randomUUID(), accountRef: 99, lifecycleAction: "deleted",
            deletedAt: new Date(), key, keyId: "test-key"
        });
        await publishReceipt(dir, someoneElses);
        assert.equal(await findValidReceiptForAccount(dir, 1, key), null);
    });
});

test("findValidReceiptForAccount throws fail-closed when a receipt claiming this accountRef fails signature verification", async () => {
    await withTempDir(async (dir) => {
        const key = crypto.randomBytes(32);
        const receipt = buildReceipt({
            receiptId: crypto.randomUUID(), accountRef: 7, lifecycleAction: "deleted",
            deletedAt: new Date(), key, keyId: "test-key"
        });
        const tampered = JSON.parse(JSON.stringify(receipt));
        tampered.integrity.signature = "0".repeat(64);
        await fsPromises.mkdir(dir, { recursive: true });
        await fsPromises.writeFile(path.join(dir, `${tampered.receiptId}.json`), JSON.stringify(tampered));

        await assert.rejects(
            () => findValidReceiptForAccount(dir, 7, key),
            (error) => error.code === "DELETION_RECEIPT_INTEGRITY_INVALID"
        );
    });
});

test("findValidReceiptForAccount skips a receipt that cannot even be parsed, rather than blocking on it", async () => {
    await withTempDir(async (dir) => {
        const key = crypto.randomBytes(32);
        await fsPromises.mkdir(dir, { recursive: true });
        await fsPromises.writeFile(path.join(dir, `${crypto.randomUUID()}.json`), "{ not valid json !!");

        assert.equal(await findValidReceiptForAccount(dir, 1, key), null);
    });
});

test("findValidReceiptForAccount prefers the most recently deletedAt among multiple valid matches for the same account", async () => {
    await withTempDir(async (dir) => {
        const key = crypto.randomBytes(32);
        const older = buildReceipt({
            receiptId: crypto.randomUUID(), accountRef: 5, lifecycleAction: "deleted",
            deletedAt: new Date("2026-01-01T00:00:00.000Z"), key, keyId: "test-key"
        });
        const newer = buildReceipt({
            receiptId: crypto.randomUUID(), accountRef: 5, lifecycleAction: "reconciliation_reapplied",
            deletedAt: new Date("2026-02-01T00:00:00.000Z"), key, keyId: "test-key"
        });
        await publishReceipt(dir, older);
        await publishReceipt(dir, newer);

        const found = await findValidReceiptForAccount(dir, 5, key);
        assert.equal(found.receiptId, newer.receiptId);
    });
});
