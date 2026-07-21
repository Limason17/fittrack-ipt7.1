// Strictly validated timeouts for the external mysqldump/mysql/docker exec
// processes the encrypted backup pipeline shells out to. No unbounded
// process is allowed to run: every caller of
// scripts/databaseTools.js#runDockerDatabaseTool gets an explicit,
// millisecond deadline after which the child is sent SIGTERM, then SIGKILL
// if it has not exited after a fixed grace period.
const DUMP_TIMEOUT_MIN_MS = 5_000;
const DUMP_TIMEOUT_MAX_MS = 3_600_000; // 1 hour
const DUMP_TIMEOUT_DEFAULT_MS = 300_000; // 5 minutes

const RESTORE_TIMEOUT_MIN_MS = 5_000;
const RESTORE_TIMEOUT_MAX_MS = 3_600_000; // 1 hour
const RESTORE_TIMEOUT_DEFAULT_MS = 600_000; // 10 minutes - imports are typically slower than dumps

const DOCKER_OPERATION_TIMEOUT_MIN_MS = 1_000;
const DOCKER_OPERATION_TIMEOUT_MAX_MS = 120_000; // 2 minutes
const DOCKER_OPERATION_TIMEOUT_DEFAULT_MS = 15_000;

// Fixed, not operator-configurable: the window between an unresponsive
// process being asked nicely (SIGTERM) and being forced (SIGKILL). Keeping
// this fixed avoids a misconfiguration turning "graceful" into "never".
const GRACE_PERIOD_MS = 5_000;

function configError(message) {
    const error = new Error(message);
    error.code = "INVALID_BACKUP_TIMEOUT_CONFIG";
    return error;
}

function timeoutSetting(env, name, { fallback, min, max }) {
    const value = env?.[name];
    if (value === undefined || value === null || value === "") {
        return fallback;
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        throw configError(`${name} must be an integer between ${min} and ${max} milliseconds.`);
    }
    return parsed;
}

function readBackupTimeoutConfig(env = process.env) {
    return Object.freeze({
        dumpTimeoutMs: timeoutSetting(env, "BACKUP_DUMP_TIMEOUT_MS", {
            fallback: DUMP_TIMEOUT_DEFAULT_MS,
            min: DUMP_TIMEOUT_MIN_MS,
            max: DUMP_TIMEOUT_MAX_MS
        }),
        restoreTimeoutMs: timeoutSetting(env, "BACKUP_RESTORE_TIMEOUT_MS", {
            fallback: RESTORE_TIMEOUT_DEFAULT_MS,
            min: RESTORE_TIMEOUT_MIN_MS,
            max: RESTORE_TIMEOUT_MAX_MS
        }),
        dockerOperationTimeoutMs: timeoutSetting(env, "BACKUP_DOCKER_OPERATION_TIMEOUT_MS", {
            fallback: DOCKER_OPERATION_TIMEOUT_DEFAULT_MS,
            min: DOCKER_OPERATION_TIMEOUT_MIN_MS,
            max: DOCKER_OPERATION_TIMEOUT_MAX_MS
        })
    });
}

module.exports = {
    DOCKER_OPERATION_TIMEOUT_DEFAULT_MS,
    DUMP_TIMEOUT_DEFAULT_MS,
    GRACE_PERIOD_MS,
    RESTORE_TIMEOUT_DEFAULT_MS,
    configError,
    readBackupTimeoutConfig
};
