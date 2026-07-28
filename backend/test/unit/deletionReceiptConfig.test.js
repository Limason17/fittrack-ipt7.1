const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const os = require("node:os");

const { readDeletionReceiptConfig } = require("../../config/deletionReceiptConfig");

function validKeyB64() {
    return crypto.randomBytes(32).toString("base64");
}

function baseEnv(overrides = {}) {
    return {
        NODE_ENV: "test",
        DELETION_RECEIPT_DIR: path.join(os.tmpdir(), "fittrack-deletion-receipts-test"),
        DELETION_RECEIPT_HMAC_KEY_B64: validKeyB64(),
        DELETION_RECEIPT_HMAC_KEY_ID: "unit-test-key",
        ...overrides
    };
}

test("a fully-configured non-production environment is accepted", () => {
    const config = readDeletionReceiptConfig(baseEnv());
    assert.equal(config.configured, true);
    assert.equal(Buffer.isBuffer(config.key), true);
    assert.equal(config.key.length, 32);
    assert.equal(config.keyId, "unit-test-key");
    assert.equal(path.isAbsolute(config.directory), true);
});

test("an entirely unconfigured non-production environment returns configured:false rather than throwing", () => {
    const config = readDeletionReceiptConfig({ NODE_ENV: "development" });
    assert.deepEqual(config, { configured: false });
});

test("an entirely unconfigured production environment fails closed", () => {
    assert.throws(
        () => readDeletionReceiptConfig({ NODE_ENV: "production" }),
        (error) => error.code === "INVALID_DELETION_RECEIPT_CONFIG"
    );
});

test("a partially-configured environment (one of three variables set) always throws, never treated as unconfigured", () => {
    assert.throws(
        () => readDeletionReceiptConfig({ NODE_ENV: "development", DELETION_RECEIPT_DIR: "/tmp/receipts" }),
        (error) => error.code === "INVALID_DELETION_RECEIPT_CONFIG"
    );
    assert.throws(
        () => readDeletionReceiptConfig({ NODE_ENV: "development", DELETION_RECEIPT_HMAC_KEY_B64: validKeyB64() }),
        (error) => error.code === "INVALID_DELETION_RECEIPT_CONFIG"
    );
});

test("a key that does not decode to exactly 32 bytes is rejected", () => {
    assert.throws(
        () => readDeletionReceiptConfig(baseEnv({ DELETION_RECEIPT_HMAC_KEY_B64: crypto.randomBytes(16).toString("base64") })),
        (error) => error.code === "INVALID_DELETION_RECEIPT_CONFIG"
    );
});

test("known placeholder keys and key ids are rejected even if syntactically valid", () => {
    assert.throws(
        () => readDeletionReceiptConfig(baseEnv({ DELETION_RECEIPT_HMAC_KEY_B64: "changeme" })),
        (error) => error.code === "INVALID_DELETION_RECEIPT_CONFIG"
    );
    assert.throws(
        () => readDeletionReceiptConfig(baseEnv({ DELETION_RECEIPT_HMAC_KEY_ID: "example" })),
        (error) => error.code === "INVALID_DELETION_RECEIPT_CONFIG"
    );
});

test("the receipt directory must not be inside the git repository", () => {
    const repositoryRoot = path.resolve(__dirname, "../..");
    assert.throws(
        () => readDeletionReceiptConfig(baseEnv({ DELETION_RECEIPT_DIR: path.join(repositoryRoot, "receipts") })),
        (error) => error.code === "INVALID_DELETION_RECEIPT_CONFIG"
    );
    assert.throws(
        () => readDeletionReceiptConfig(baseEnv({ DELETION_RECEIPT_DIR: repositoryRoot })),
        (error) => error.code === "INVALID_DELETION_RECEIPT_CONFIG"
    );
});

test("the receipt directory must not be inside FITTRACK_BACKUP_DIR", () => {
    const backupDir = path.join(os.tmpdir(), "fittrack-backups-test");
    assert.throws(
        () => readDeletionReceiptConfig(
            baseEnv({
                DELETION_RECEIPT_DIR: path.join(backupDir, "receipts"),
                FITTRACK_BACKUP_DIR: backupDir
            })
        ),
        (error) => error.code === "INVALID_DELETION_RECEIPT_CONFIG"
    );
});

test("a receipt directory outside both the repository and an unrelated backup directory is accepted", () => {
    const backupDir = path.join(os.tmpdir(), "fittrack-backups-test-other");
    const config = readDeletionReceiptConfig(
        baseEnv({ FITTRACK_BACKUP_DIR: backupDir })
    );
    assert.equal(config.configured, true);
});

test("the returned config object is frozen", () => {
    const config = readDeletionReceiptConfig(baseEnv());
    assert.equal(Object.isFrozen(config), true);
});
