const path = require("node:path");

function safetyError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function isLoopbackHost(host) {
    const normalized = String(host || "")
        .trim()
        .toLowerCase()
        .replace(/^\[|\]$/g, "");
    return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function isDisposableDatabaseName(name) {
    return /^fittrack_(?:test|e2e|restore)(?:_[a-z0-9]+)*$/i.test(String(name || ""));
}

function assertDestructiveTestTarget(config, env = process.env) {
    const allowed =
        env.NODE_ENV === "test" &&
        env.ALLOW_TEST_DB_RESET === "true" &&
        isLoopbackHost(config?.host) &&
        isDisposableDatabaseName(config?.database);

    if (!allowed) {
        throw safetyError(
            "TEST_DB_OPERATION_FORBIDDEN",
            "Destructive database operations require NODE_ENV=test, ALLOW_TEST_DB_RESET=true, a loopback host, and an explicitly disposable FitTrack database name."
        );
    }

    return config;
}

function assertRestoreAcknowledgement(env = process.env) {
    if (env.FITTRACK_RESTORE_ACK !== "restore-local-test-database") {
        throw safetyError(
            "TEST_DB_OPERATION_FORBIDDEN",
            "Restore requires FITTRACK_RESTORE_ACK=restore-local-test-database."
        );
    }
}

// The legacy, unencrypted mysqldump/gzip backup path (dbBackup.js,
// dbBackupDaily.js) predates Stage 2B1's encrypted .ftbackup format and
// writes a genuine plaintext SQL dump to disk. A prior release-gate review
// found it had no NODE_ENV restriction at all, making it just as
// "production capable" as the encrypted path with none of its protections.
// This closes that gap: forbidden outright in production (no override,
// however guarded), and off by default everywhere else unless explicitly
// opted into for historical regression coverage or a local Stage-0-style
// drill.
function assertLegacyUnencryptedBackupAllowed(env = process.env) {
    if (env.NODE_ENV === "production") {
        throw safetyError(
            "LEGACY_UNENCRYPTED_BACKUP_FORBIDDEN",
            "The legacy unencrypted backup path is forbidden in production. Use the encrypted db:backup:create path instead."
        );
    }
    if (env.ALLOW_LEGACY_UNENCRYPTED_BACKUP !== "true") {
        throw safetyError(
            "LEGACY_UNENCRYPTED_BACKUP_FORBIDDEN",
            "The legacy unencrypted backup path requires ALLOW_LEGACY_UNENCRYPTED_BACKUP=true (development/test only, never production)."
        );
    }
}

// Stage 2B1's encrypted restore contract, replacing a NODE_ENV=test
// coupling that let environment labeling alone stand in for authorization
// (a real recovery run against a genuine incident environment would have
// had to lie about NODE_ENV to use the tool at all). BACKUP_RESTORE_ENABLED
// is the single explicit switch; every other guard (target naming, system
// database, source-database, existing-target) is unchanged and unaffected
// by NODE_ENV in either direction.
function assertRestoreEnabled(env = process.env) {
    if (env.BACKUP_RESTORE_ENABLED !== "true") {
        throw safetyError(
            "RESTORE_NOT_ENABLED",
            "Restore requires BACKUP_RESTORE_ENABLED=true. NODE_ENV alone never authorizes a restore."
        );
    }
}

// Binds the acknowledgement to the exact target database name, not just a
// constant phrase - a fixed phrase could be copy-pasted for any target
// without the operator actually confirming which database is about to be
// dropped and recreated.
function assertRestoreTargetAcknowledgement(env, targetDatabase) {
    const expected = `restore:${targetDatabase}`;
    if (env.FITTRACK_RESTORE_ACK !== expected) {
        throw safetyError(
            "RESTORE_ACK_INVALID",
            "FITTRACK_RESTORE_ACK must exactly equal \"restore:<FITTRACK_RESTORE_TARGET_DATABASE>\"."
        );
    }
}

function assertExternalBackupDirectory(directory, repositoryRoot) {
    if (!directory) {
        throw safetyError(
            "BACKUP_LOCATION_REQUIRED",
            "FITTRACK_BACKUP_DIR must point to a directory outside the repository."
        );
    }

    const resolvedDirectory = path.resolve(directory);
    const resolvedRepository = path.resolve(repositoryRoot);
    const relative = path.relative(resolvedRepository, resolvedDirectory);
    const insideRepository =
        relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));

    if (insideRepository) {
        throw safetyError(
            "BACKUP_LOCATION_FORBIDDEN",
            "Database backups must be stored outside the repository."
        );
    }

    return resolvedDirectory;
}

// Never a valid restore target, regardless of any other guard - these are
// MySQL's own system schemas, never a FitTrack database.
const SYSTEM_DATABASE_NAMES = new Set(["mysql", "information_schema", "performance_schema", "sys"]);

function isSystemDatabaseName(name) {
    return SYSTEM_DATABASE_NAMES.has(String(name || "").toLowerCase());
}

// Strict validation for an explicit encrypted-backup restore target: unlike
// the legacy dbRestore.js path (which always restores into whatever
// config.database/DB_NAME already resolves to), the encrypted restore
// command requires the target to be passed as its own, separate value so
// it can never silently default to - or be confused with - the source
// database. `sourceDatabase` is the database the backup was taken from
// (from the backup's own authenticated header, not from local config).
function assertRestoreTargetDatabase(targetDatabase, { sourceDatabase } = {}) {
    if (!isDisposableDatabaseName(targetDatabase)) {
        throw safetyError(
            "RESTORE_TARGET_INVALID",
            "Restore target database must match the disposable FitTrack test/e2e/restore naming pattern."
        );
    }
    if (isSystemDatabaseName(targetDatabase)) {
        throw safetyError(
            "RESTORE_TARGET_FORBIDDEN",
            "Restore target database must not be a MySQL system database."
        );
    }
    if (sourceDatabase && targetDatabase.toLowerCase() === String(sourceDatabase).toLowerCase()) {
        throw safetyError(
            "RESTORE_TARGET_IS_SOURCE",
            "Restore target database must not be the backup's own source database."
        );
    }
    return targetDatabase;
}

// A restore must not silently overwrite an existing database. Recreating an
// already-existing target is only permitted when the caller passes the
// explicit, unambiguous drill acknowledgement - never implicitly.
function assertRestoreTargetAvailability({ exists, allowRecreateAck }) {
    if (exists && allowRecreateAck !== "recreate-disposable-restore-target") {
        throw safetyError(
            "RESTORE_TARGET_ALREADY_EXISTS",
            "Restore target database already exists; pass the explicit drill acknowledgement to recreate it."
        );
    }
}

module.exports = {
    SYSTEM_DATABASE_NAMES,
    assertDestructiveTestTarget,
    assertExternalBackupDirectory,
    assertLegacyUnencryptedBackupAllowed,
    assertRestoreAcknowledgement,
    assertRestoreEnabled,
    assertRestoreTargetAcknowledgement,
    assertRestoreTargetAvailability,
    assertRestoreTargetDatabase,
    isDisposableDatabaseName,
    isLoopbackHost,
    isSystemDatabaseName,
    safetyError
};
