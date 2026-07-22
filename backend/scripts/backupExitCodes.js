// Distinct, stable exit codes for the encrypted backup CLI commands
// (db:backup:create/verify/restore/drill plus the Stage 2B2A
// db:backup:remote:* family) - mirrors the established pattern in
// databaseBackupPolicy.js's EXIT_CODES for the legacy path, so a
// scheduler/monitor can distinguish failure categories from the exit code
// alone, without parsing JSON. REMOTE_UNAVAILABLE and CLEANUP_FAILED are new
// in Stage 2B2A; every code and mapping that already existed for the local
// commands is unchanged.
const EXIT_CODES = Object.freeze({
    OK: 0,
    CONFIG_UNSAFE: 10,
    OPERATIONAL_FAILURE: 20,
    INTEGRITY_FAILED: 23,
    TIMEOUT: 24,
    REMOTE_UNAVAILABLE: 25,
    CLEANUP_FAILED: 26
});

const CONFIG_UNSAFE_CODES = new Set([
    "INVALID_BACKUP_CRYPTO_CONFIG",
    "INVALID_BACKUP_TIMEOUT_CONFIG",
    "BACKUP_LOCATION_REQUIRED",
    "BACKUP_LOCATION_FORBIDDEN",
    "BACKUP_TARGET_FORBIDDEN",
    "BACKUP_FILE_REQUIRED",
    "BACKUP_FILE_INVALID",
    "RESTORE_TARGET_REQUIRED",
    "RESTORE_TARGET_INVALID",
    "RESTORE_TARGET_FORBIDDEN",
    "RESTORE_TARGET_IS_SOURCE",
    "RESTORE_TARGET_ALREADY_EXISTS",
    "RESTORE_NOT_ENABLED",
    "RESTORE_ACK_INVALID",
    "LEGACY_UNENCRYPTED_BACKUP_FORBIDDEN",
    "DATABASE_TOOL_CONFIG_INVALID",
    // Stage 2B2A remote configuration/authorization preconditions - nothing
    // was attempted yet, exactly like the existing local config-unsafe codes.
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
]);

const INTEGRITY_CODES = new Set([
    "BACKUP_INTEGRITY_FAILED",
    "BACKUP_INVALID_MAGIC",
    "BACKUP_UNSUPPORTED_VERSION",
    "BACKUP_KEY_ID_MISMATCH",
    "BACKUP_FORMAT_INVALID_KEY",
    "BACKUP_FORMAT_INVALID_HEADER",
    // Stage 2B2A: the remote copy or its metadata is provably wrong/tampered
    // - the same class of failure as a tampered local .ftbackup file.
    "REMOTE_CIPHERTEXT_HASH_MISMATCH",
    "REMOTE_METADATA_INCONSISTENT",
    "REMOTE_KEY_ID_MISMATCH",
    "REMOTE_DOWNLOAD_INCOMPLETE"
]);

// Stage 2B2A: the remote endpoint/bucket/credentials themselves are the
// problem (unreachable, rejected, not found) - distinct from both a local
// config mistake (nothing attempted) and a data-integrity failure (data
// received but provably wrong).
const REMOTE_UNAVAILABLE_CODES = new Set([
    "REMOTE_AUTH_FAILED",
    "REMOTE_BUCKET_UNAVAILABLE",
    "REMOTE_OBJECT_NOT_FOUND",
    "REMOTE_OPERATION_FAILED",
    "REMOTE_UPLOAD_FAILED",
    "REMOTE_DOWNLOAD_FAILED"
]);

// Stage 2B2A: the operation's core purpose already succeeded, but cleanup
// afterward (removing a test/drill artifact, dropping a disposable restore
// database, deleting a remote test object) did not - this must never be
// reported as exit code 0.
const CLEANUP_FAILED_CODES = new Set([
    "REMOTE_DRILL_CLEANUP_FAILED",
    "REMOTE_PREFLIGHT_CLEANUP_FAILED"
]);

function backupCliExitCode(error) {
    const code = typeof error?.code === "string" ? error.code : "";
    if (code === "DATABASE_TOOL_TIMEOUT" || code === "REMOTE_OPERATION_TIMEOUT") {
        return EXIT_CODES.TIMEOUT;
    }
    if (CLEANUP_FAILED_CODES.has(code)) return EXIT_CODES.CLEANUP_FAILED;
    if (INTEGRITY_CODES.has(code)) return EXIT_CODES.INTEGRITY_FAILED;
    if (REMOTE_UNAVAILABLE_CODES.has(code)) return EXIT_CODES.REMOTE_UNAVAILABLE;
    if (CONFIG_UNSAFE_CODES.has(code)) return EXIT_CODES.CONFIG_UNSAFE;
    return EXIT_CODES.OPERATIONAL_FAILURE;
}

module.exports = {
    EXIT_CODES,
    backupCliExitCode
};
