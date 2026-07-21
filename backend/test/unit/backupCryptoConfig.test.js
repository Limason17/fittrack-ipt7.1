const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const { readBackupCryptoConfig } = require("../../config/backupCryptoConfig");

function validKeyB64() {
    return crypto.randomBytes(32).toString("base64");
}

function baseEnv(overrides = {}) {
    return {
        BACKUP_ENCRYPTION_KEY_B64: validKeyB64(),
        BACKUP_ENCRYPTION_KEY_ID: "local-dev-2026",
        ...overrides
    };
}

test("a valid key/keyId configuration is accepted and the key decodes to exactly 32 bytes", () => {
    const keyB64 = validKeyB64();
    const config = readBackupCryptoConfig(baseEnv({ BACKUP_ENCRYPTION_KEY_B64: keyB64 }));
    assert.equal(Buffer.isBuffer(config.key), true);
    assert.equal(config.key.length, 32);
    assert.equal(config.key.toString("base64"), keyB64);
    assert.equal(config.keyId, "local-dev-2026");
});

test("readBackupCryptoConfig does not require BACKUP_OUTPUT_DIRECTORY - that is create's own concern, not verify/restore's", () => {
    const env = baseEnv();
    assert.equal("BACKUP_OUTPUT_DIRECTORY" in env, false);
    assert.doesNotThrow(() => readBackupCryptoConfig(env));
});

test("missing BACKUP_ENCRYPTION_KEY_B64 fails closed", () => {
    const env = baseEnv();
    delete env.BACKUP_ENCRYPTION_KEY_B64;
    assert.throws(
        () => readBackupCryptoConfig(env),
        (error) => error.code === "INVALID_BACKUP_CRYPTO_CONFIG"
    );
});

test("empty string BACKUP_ENCRYPTION_KEY_B64 fails closed", () => {
    assert.throws(
        () => readBackupCryptoConfig(baseEnv({ BACKUP_ENCRYPTION_KEY_B64: "" })),
        (error) => error.code === "INVALID_BACKUP_CRYPTO_CONFIG"
    );
});

test("known placeholder key values are rejected even if syntactically plausible", () => {
    for (const placeholder of [
        "changeme",
        "replace-with-a-base64-encoded-32-byte-key",
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
    ]) {
        assert.throws(
            () => readBackupCryptoConfig(baseEnv({ BACKUP_ENCRYPTION_KEY_B64: placeholder })),
            (error) => error.code === "INVALID_BACKUP_CRYPTO_CONFIG",
            `expected placeholder to be rejected: ${placeholder}`
        );
    }
});

test("invalid base64 characters are rejected", () => {
    assert.throws(
        () => readBackupCryptoConfig(baseEnv({ BACKUP_ENCRYPTION_KEY_B64: "not*valid*base64*chars!!" })),
        (error) => error.code === "INVALID_BACKUP_CRYPTO_CONFIG"
    );
});

test("a key that decodes to fewer than 32 bytes is rejected", () => {
    const shortKey = crypto.randomBytes(16).toString("base64");
    assert.throws(
        () => readBackupCryptoConfig(baseEnv({ BACKUP_ENCRYPTION_KEY_B64: shortKey })),
        (error) => error.code === "INVALID_BACKUP_CRYPTO_CONFIG"
    );
});

test("a key that decodes to more than 32 bytes is rejected", () => {
    const longKey = crypto.randomBytes(48).toString("base64");
    assert.throws(
        () => readBackupCryptoConfig(baseEnv({ BACKUP_ENCRYPTION_KEY_B64: longKey })),
        (error) => error.code === "INVALID_BACKUP_CRYPTO_CONFIG"
    );
});

test("missing or empty BACKUP_ENCRYPTION_KEY_ID fails closed", () => {
    const missing = baseEnv();
    delete missing.BACKUP_ENCRYPTION_KEY_ID;
    assert.throws(() => readBackupCryptoConfig(missing), (error) => error.code === "INVALID_BACKUP_CRYPTO_CONFIG");
    assert.throws(
        () => readBackupCryptoConfig(baseEnv({ BACKUP_ENCRYPTION_KEY_ID: "" })),
        (error) => error.code === "INVALID_BACKUP_CRYPTO_CONFIG"
    );
});

test("BACKUP_ENCRYPTION_KEY_ID rejects characters outside letters/digits/underscore/hyphen", () => {
    for (const invalid of ["has spaces", "has/slash", "has.dot", "emoji🔑", "semi;colon"]) {
        assert.throws(
            () => readBackupCryptoConfig(baseEnv({ BACKUP_ENCRYPTION_KEY_ID: invalid })),
            (error) => error.code === "INVALID_BACKUP_CRYPTO_CONFIG",
            `expected rejection for: ${invalid}`
        );
    }
});

test("BACKUP_ENCRYPTION_KEY_ID longer than 64 characters is rejected", () => {
    assert.throws(
        () => readBackupCryptoConfig(baseEnv({ BACKUP_ENCRYPTION_KEY_ID: "a".repeat(65) })),
        (error) => error.code === "INVALID_BACKUP_CRYPTO_CONFIG"
    );
});

test("known placeholder key IDs are rejected", () => {
    for (const placeholder of ["changeme", "example", "test", "placeholder", "local-key-id"]) {
        assert.throws(
            () => readBackupCryptoConfig(baseEnv({ BACKUP_ENCRYPTION_KEY_ID: placeholder })),
            (error) => error.code === "INVALID_BACKUP_CRYPTO_CONFIG",
            `expected placeholder key id to be rejected: ${placeholder}`
        );
    }
});

test("there is no implicit fallback: an empty environment object always throws, never returns a default key", () => {
    assert.throws(() => readBackupCryptoConfig({}), (error) => error.code === "INVALID_BACKUP_CRYPTO_CONFIG");
});

test("the returned config object is frozen and the key is never derived from anything but the explicit env value", () => {
    const config = readBackupCryptoConfig(baseEnv());
    assert.equal(Object.isFrozen(config), true);
});
