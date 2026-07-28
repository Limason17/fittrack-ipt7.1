const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const {
    RECEIPT_ID_PATTERN,
    SCHEMA_VERSION,
    buildReceipt,
    buildReceiptContent,
    generateReceiptId,
    stableStringify,
    verifyReceipt
} = require("../../security/deletionReceipts");

function key() {
    return crypto.randomBytes(32);
}

test("generateReceiptId returns a lowercase UUID v4 matching RECEIPT_ID_PATTERN", () => {
    const id = generateReceiptId();
    assert.equal(RECEIPT_ID_PATTERN.test(id), true);
    assert.equal(id, id.toLowerCase());
});

test("stableStringify sorts object keys recursively regardless of insertion order", () => {
    const a = stableStringify({ b: 1, a: 2, c: { z: 1, y: 2 } });
    const b = stableStringify({ a: 2, c: { y: 2, z: 1 }, b: 1 });
    assert.equal(a, b);
    assert.equal(a, '{"a":2,"b":1,"c":{"y":2,"z":1}}');
});

test("stableStringify handles arrays and primitives", () => {
    assert.equal(stableStringify([3, 1, 2]), "[3,1,2]");
    assert.equal(stableStringify(null), "null");
    assert.equal(stableStringify("x"), '"x"');
    assert.equal(stableStringify(42), "42");
});

test("buildReceiptContent validates every field and rejects an invalid shape", () => {
    const receiptId = generateReceiptId();
    const content = buildReceiptContent({
        receiptId,
        accountRef: 42,
        lifecycleAction: "deleted",
        deletedAt: new Date("2026-01-01T00:00:00.000Z")
    });
    assert.equal(content.schemaVersion, SCHEMA_VERSION);
    assert.equal(content.receiptId, receiptId);
    assert.equal(content.accountRef, 42);
    assert.equal(content.lifecycleAction, "deleted");
    assert.equal(content.deletedAt, "2026-01-01T00:00:00.000Z");
    assert.equal(Object.isFrozen(content), true);

    assert.throws(() => buildReceiptContent({ receiptId: "not-a-uuid", accountRef: 1, lifecycleAction: "deleted", deletedAt: new Date() }));
    assert.throws(() => buildReceiptContent({ receiptId, accountRef: -1, lifecycleAction: "deleted", deletedAt: new Date() }));
    assert.throws(() => buildReceiptContent({ receiptId, accountRef: 1.5, lifecycleAction: "deleted", deletedAt: new Date() }));
    assert.throws(() => buildReceiptContent({ receiptId, accountRef: 1, lifecycleAction: "not_a_real_action", deletedAt: new Date() }));
    assert.throws(() => buildReceiptContent({ receiptId, accountRef: 1, lifecycleAction: "deleted", deletedAt: "not-a-date" }));
});

test("buildReceipt produces a receipt whose signature verifyReceipt accepts with the same key", () => {
    const hmacKey = key();
    const receipt = buildReceipt({
        receiptId: generateReceiptId(),
        accountRef: 7,
        lifecycleAction: "deleted",
        deletedAt: new Date(),
        key: hmacKey,
        keyId: "test-key-1"
    });
    assert.equal(receipt.integrity.algorithm, "HMAC-SHA256");
    assert.equal(receipt.integrity.keyId, "test-key-1");
    assert.match(receipt.integrity.signature, /^[0-9a-f]{64}$/);

    const verifiedContent = verifyReceipt(receipt, hmacKey);
    assert.equal(verifiedContent.accountRef, 7);
    assert.equal(verifiedContent.lifecycleAction, "deleted");
});

test("verifyReceipt is deterministic: the same content and key always reproduce the same signature", () => {
    const hmacKey = key();
    const receiptId = generateReceiptId();
    const deletedAt = new Date("2026-03-01T12:00:00.000Z");
    const first = buildReceipt({ receiptId, accountRef: 3, lifecycleAction: "deleted", deletedAt, key: hmacKey, keyId: "k" });
    const second = buildReceipt({ receiptId, accountRef: 3, lifecycleAction: "deleted", deletedAt, key: hmacKey, keyId: "k" });
    assert.equal(first.integrity.signature, second.integrity.signature);
});

test("verifyReceipt rejects a receipt whose content was altered after signing", () => {
    const hmacKey = key();
    const receipt = buildReceipt({
        receiptId: generateReceiptId(),
        accountRef: 7,
        lifecycleAction: "deleted",
        deletedAt: new Date(),
        key: hmacKey,
        keyId: "k"
    });
    const tampered = { ...receipt, accountRef: 999 };
    assert.throws(
        () => verifyReceipt(tampered, hmacKey),
        (error) => error.code === "DELETION_RECEIPT_INTEGRITY_INVALID"
    );
});

test("verifyReceipt rejects the correct content signed/verified with the wrong key", () => {
    const receipt = buildReceipt({
        receiptId: generateReceiptId(),
        accountRef: 1,
        lifecycleAction: "deleted",
        deletedAt: new Date(),
        key: key(),
        keyId: "k"
    });
    assert.throws(
        () => verifyReceipt(receipt, key()),
        (error) => error.code === "DELETION_RECEIPT_INTEGRITY_INVALID"
    );
});

test("verifyReceipt fails closed on an unknown schema version", () => {
    const hmacKey = key();
    const receipt = buildReceipt({
        receiptId: generateReceiptId(),
        accountRef: 1,
        lifecycleAction: "deleted",
        deletedAt: new Date(),
        key: hmacKey,
        keyId: "k"
    });
    const futureVersion = { ...receipt, schemaVersion: 2 };
    assert.throws(
        () => verifyReceipt(futureVersion, hmacKey),
        (error) => error.code === "DELETION_RECEIPT_UNKNOWN_SCHEMA_VERSION"
    );
});

test("verifyReceipt fails closed on a malformed receipt (not an object, missing integrity, bad signature shape)", () => {
    const hmacKey = key();
    assert.throws(() => verifyReceipt(null, hmacKey), (error) => error.code === "DELETION_RECEIPT_MALFORMED");
    assert.throws(() => verifyReceipt([], hmacKey), (error) => error.code === "DELETION_RECEIPT_MALFORMED");
    assert.throws(
        () => verifyReceipt({ schemaVersion: 1 }, hmacKey),
        (error) => error.code === "DELETION_RECEIPT_UNSUPPORTED_ALGORITHM"
    );
    assert.throws(
        () => verifyReceipt({ schemaVersion: 1, integrity: { algorithm: "HMAC-SHA256", signature: "not-hex" } }, hmacKey),
        (error) => error.code === "DELETION_RECEIPT_MALFORMED"
    );
});

test("the receipt never contains e-mail, username, password, or free-text fields - only the allowlisted five content keys plus integrity", () => {
    const receipt = buildReceipt({
        receiptId: generateReceiptId(),
        accountRef: 1,
        lifecycleAction: "deleted",
        deletedAt: new Date(),
        key: key(),
        keyId: "k"
    });
    const keys = Object.keys(receipt).sort();
    assert.deepEqual(keys, ["accountRef", "deletedAt", "integrity", "lifecycleAction", "receiptId", "schemaVersion"]);
});
