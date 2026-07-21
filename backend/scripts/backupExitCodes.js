// Distinct, stable exit codes for the four encrypted backup CLI commands
// (db:backup:create/verify/restore/drill) - mirrors the established
// pattern in databaseBackupPolicy.js's EXIT_CODES for the legacy path, so a
// scheduler/monitor can distinguish failure categories from the exit code
// alone, without parsing JSON.
const EXIT_CODES = Object.freeze({
    OK: 0,
    CONFIG_UNSAFE: 10,
    OPERATIONAL_FAILURE: 20,
    INTEGRITY_FAILED: 23,
    TIMEOUT: 24
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
    "DATABASE_TOOL_CONFIG_INVALID"
]);

const INTEGRITY_CODES = new Set([
    "BACKUP_INTEGRITY_FAILED",
    "BACKUP_INVALID_MAGIC",
    "BACKUP_UNSUPPORTED_VERSION",
    "BACKUP_KEY_ID_MISMATCH",
    "BACKUP_FORMAT_INVALID_KEY",
    "BACKUP_FORMAT_INVALID_HEADER"
]);

function backupCliExitCode(error) {
    const code = typeof error?.code === "string" ? error.code : "";
    if (code === "DATABASE_TOOL_TIMEOUT") return EXIT_CODES.TIMEOUT;
    if (INTEGRITY_CODES.has(code)) return EXIT_CODES.INTEGRITY_FAILED;
    if (CONFIG_UNSAFE_CODES.has(code)) return EXIT_CODES.CONFIG_UNSAFE;
    return EXIT_CODES.OPERATIONAL_FAILURE;
}

module.exports = {
    EXIT_CODES,
    backupCliExitCode
};
