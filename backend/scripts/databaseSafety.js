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

module.exports = {
    assertDestructiveTestTarget,
    assertExternalBackupDirectory,
    assertRestoreAcknowledgement,
    isDisposableDatabaseName,
    isLoopbackHost,
    safetyError
};
