const crypto = require("node:crypto");

const { loadMigrations } = require("./loader");
const { planMigrations, validateMigrationRegistry } = require("./planner");
const { createSchemaHelpers } = require("./schemaHelpers");
const { createMigrationStore } = require("./store");

function runnerError(code, message, details = {}) {
    const error = new Error(message);
    error.code = code;
    Object.assign(error, details);
    return error;
}

function promisePool(pool) {
    return typeof pool.promise === "function" ? pool.promise() : pool;
}

function lockName(databaseName) {
    const digest = crypto.createHash("sha256").update(databaseName).digest("hex").slice(0, 32);
    return `fittrack:migrations:${digest}`;
}

async function acquireLock(connection, name, timeoutSeconds) {
    const [rows] = await connection.query("SELECT GET_LOCK(?, ?) AS acquired", [
        name,
        timeoutSeconds
    ]);
    if (Number(rows[0]?.acquired) !== 1) {
        throw runnerError(
            "MIGRATION_LOCK_UNAVAILABLE",
            "Could not acquire the database migration lock."
        );
    }
}

async function releaseLock(connection, name, logger) {
    try {
        await connection.query("SELECT RELEASE_LOCK(?) AS released", [name]);
    } catch (error) {
        logger?.error("migration_lock_release_failed", { error });
    }
}

function unsafeState(status) {
    return (
        status.dirty.length > 0 || status.drift.length > 0 || status.unknown.length > 0
    );
}

function createMigrationRunner({
    pool,
    migrations = loadMigrations(),
    logger,
    lockTimeoutSeconds = 15
}) {
    if (!pool) {
        throw new TypeError("Migration runner requires a database pool.");
    }
    validateMigrationRegistry(migrations);

    async function status() {
        const connection = await promisePool(pool).getConnection();
        try {
            const helpers = createSchemaHelpers(connection);
            const store = createMigrationStore(connection, helpers);
            const records = await store.list();
            return planMigrations(migrations, records);
        } finally {
            connection.release();
        }
    }

    async function migrate() {
        const connection = await promisePool(pool).getConnection();
        const helpers = createSchemaHelpers(connection);
        const store = createMigrationStore(connection, helpers);
        const databaseName = await helpers.databaseName();
        const advisoryLockName = lockName(databaseName);
        let acquired = false;

        try {
            await acquireLock(connection, advisoryLockName, lockTimeoutSeconds);
            acquired = true;
            await store.ensureTable();

            let currentStatus = planMigrations(migrations, await store.list());
            if (unsafeState(currentStatus)) {
                throw runnerError(
                    "MIGRATION_STATE_INVALID",
                    "Migration history contains dirty, changed, or unknown entries.",
                    { status: currentStatus }
                );
            }

            const applied = [];
            for (const migration of currentStatus.pending) {
                await store.markStarted(migration);
                const startedAt = Date.now();
                logger?.info("migration_started", { migrationId: migration.id });

                try {
                    await migration.up({ connection, helpers, logger });
                    const executionMs = Date.now() - startedAt;
                    await store.markApplied(migration, executionMs);
                    applied.push(migration.id);
                    logger?.info("migration_applied", {
                        migrationId: migration.id,
                        executionMs
                    });
                } catch (cause) {
                    const executionMs = Date.now() - startedAt;
                    try {
                        await store.markFailed(migration, {
                            code: cause.code,
                            executionMs
                        });
                    } catch (markError) {
                        logger?.error("migration_mark_failed_error", {
                            migrationId: migration.id,
                            error: markError
                        });
                    }

                    throw runnerError(
                        "MIGRATION_FAILED",
                        `Migration ${migration.id} failed.`,
                        { migrationId: migration.id, cause }
                    );
                }
            }

            currentStatus = planMigrations(migrations, await store.list());
            if (
                currentStatus.pending.length ||
                currentStatus.dirty.length ||
                currentStatus.drift.length ||
                currentStatus.unknown.length
            ) {
                throw runnerError(
                    "MIGRATION_STATUS_NOT_READY",
                    "Migrations did not reach a ready state.",
                    { status: currentStatus }
                );
            }

            return { applied, status: currentStatus };
        } finally {
            if (acquired) {
                await releaseLock(connection, advisoryLockName, logger);
            }
            connection.release();
        }
    }

    return {
        migrate,
        migrations,
        status
    };
}

module.exports = {
    acquireLock,
    createMigrationRunner,
    lockName,
    releaseLock,
    runnerError,
    unsafeState
};
