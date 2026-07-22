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
    assert.equal(backupCliExitCode({ code: "REMOTE_OPERATION_TIMEOUT" }), EXIT_CODES.TIMEOUT);
});

test("Stage 2B2A remote configuration/authorization errors map to CONFIG_UNSAFE", () => {
    for (const code of [
        "INVALID_BACKUP_REMOTE_CONFIG",
        "REMOTE_OBJECT_KEY_INVALID",
        "REMOTE_OBJECT_KEY_OUTSIDE_PREFIX",
        "REMOTE_VERSIONING_REQUIRED",
        "REMOTE_OBJECT_LOCK_REQUIRED",
        "REMOTE_BUCKET_NOT_PRIVATE",
        "REMOTE_OBJECT_ALREADY_EXISTS",
        "REMOTE_UPLOAD_SIZE_LIMIT_EXCEEDED",
        "REMOTE_RETENTION_NOT_AUTHORIZED",
        "REMOTE_DOWNLOAD_TARGET_EXISTS"
    ]) {
        assert.equal(backupCliExitCode({ code }), EXIT_CODES.CONFIG_UNSAFE, `expected ${code} to map to CONFIG_UNSAFE`);
    }
});

test("Stage 2B2A remote integrity errors map to INTEGRITY_FAILED, the same bucket as tampered local backups", () => {
    for (const code of [
        "REMOTE_CIPHERTEXT_HASH_MISMATCH",
        "REMOTE_METADATA_INCONSISTENT",
        "REMOTE_KEY_ID_MISMATCH",
        "REMOTE_DOWNLOAD_INCOMPLETE"
    ]) {
        assert.equal(backupCliExitCode({ code }), EXIT_CODES.INTEGRITY_FAILED, `expected ${code} to map to INTEGRITY_FAILED`);
    }
});

test("Stage 2B2A remote availability errors map to their own distinct REMOTE_UNAVAILABLE exit code", () => {
    for (const code of [
        "REMOTE_AUTH_FAILED",
        "REMOTE_BUCKET_UNAVAILABLE",
        "REMOTE_OBJECT_NOT_FOUND",
        "REMOTE_OPERATION_FAILED",
        "REMOTE_UPLOAD_FAILED",
        "REMOTE_DOWNLOAD_FAILED"
    ]) {
        assert.equal(backupCliExitCode({ code }), EXIT_CODES.REMOTE_UNAVAILABLE, `expected ${code} to map to REMOTE_UNAVAILABLE`);
    }
});

test("a cleanup failure after an otherwise successful remote operation maps to its own distinct CLEANUP_FAILED exit code, never 0", () => {
    assert.equal(backupCliExitCode({ code: "REMOTE_DRILL_CLEANUP_FAILED" }), EXIT_CODES.CLEANUP_FAILED);
    assert.equal(backupCliExitCode({ code: "REMOTE_PREFLIGHT_CLEANUP_FAILED" }), EXIT_CODES.CLEANUP_FAILED);
    assert.notEqual(EXIT_CODES.CLEANUP_FAILED, EXIT_CODES.OK);
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
