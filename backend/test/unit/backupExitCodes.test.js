const test = require("node:test");
const assert = require("node:assert/strict");

const { EXIT_CODES, backupCliExitCode } = require("../../scripts/backupExitCodes");

test("configuration/safety errors map to the CONFIG_UNSAFE exit code", () => {
    for (const code of [
        "INVALID_BACKUP_CRYPTO_CONFIG",
        "INVALID_BACKUP_TIMEOUT_CONFIG",
        "BACKUP_LOCATION_FORBIDDEN",
        "RESTORE_NOT_ENABLED",
        "RESTORE_ACK_INVALID",
        "RESTORE_TARGET_ALREADY_EXISTS",
        "LEGACY_UNENCRYPTED_BACKUP_FORBIDDEN"
    ]) {
        assert.equal(backupCliExitCode({ code }), EXIT_CODES.CONFIG_UNSAFE, `expected ${code} to map to CONFIG_UNSAFE`);
    }
});

test("authentication/integrity errors map to the INTEGRITY_FAILED exit code", () => {
    for (const code of [
        "BACKUP_INTEGRITY_FAILED",
        "BACKUP_INVALID_MAGIC",
        "BACKUP_UNSUPPORTED_VERSION",
        "BACKUP_KEY_ID_MISMATCH"
    ]) {
        assert.equal(backupCliExitCode({ code }), EXIT_CODES.INTEGRITY_FAILED, `expected ${code} to map to INTEGRITY_FAILED`);
    }
});

test("a timed-out process maps to its own distinct TIMEOUT exit code", () => {
    assert.equal(backupCliExitCode({ code: "DATABASE_TOOL_TIMEOUT" }), EXIT_CODES.TIMEOUT);
});

test("an unrecognized or missing error code falls back to the general OPERATIONAL_FAILURE exit code, never 0", () => {
    assert.equal(backupCliExitCode({ code: "SOMETHING_UNEXPECTED" }), EXIT_CODES.OPERATIONAL_FAILURE);
    assert.equal(backupCliExitCode({}), EXIT_CODES.OPERATIONAL_FAILURE);
    assert.equal(backupCliExitCode(new Error("plain error, no code")), EXIT_CODES.OPERATIONAL_FAILURE);
    assert.notEqual(EXIT_CODES.OPERATIONAL_FAILURE, EXIT_CODES.OK);
});

test("all exit codes are distinct from each other", () => {
    const values = Object.values(EXIT_CODES);
    assert.equal(new Set(values).size, values.length);
});
