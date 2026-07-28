const test = require("node:test");
const assert = require("node:assert/strict");
const fsPromises = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const {
    listReceiptFiles,
    publishReceipt,
    readReceiptFile,
    receiptFilePath
} = require("../../deletionReceipts/deletionReceiptStore");

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
