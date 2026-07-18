function startupError(code, message, cause) {
    const error = new Error(message, cause ? { cause } : undefined);
    error.code = code;
    return error;
}

function isMigrationStatusReady(status) {
    return ["pending", "dirty", "drift", "unknown"].every(
        (key) => Array.isArray(status?.[key]) && status[key].length === 0
    );
}

async function safeClose(database, logger) {
    try {
        await database.close();
    } catch (error) {
        logger?.error("database_close_failed", { error });
    }
}

async function bootstrap({
    database,
    migrationRunner,
    readiness,
    logger,
    autoMigrate = false,
    migrationExpectedDatabase,
    migrationTarget,
    createApplication,
    listen,
    port = Number(process.env.PORT) || 3001
}) {
    if (
        !database ||
        !migrationRunner ||
        !readiness ||
        !migrationTarget ||
        typeof createApplication !== "function" ||
        typeof listen !== "function"
    ) {
        throw new TypeError("Bootstrap dependencies are incomplete.");
    }
    if (autoMigrate && migrationExpectedDatabase !== migrationTarget.database) {
        throw startupError(
            "MIGRATION_TARGET_NOT_CONFIRMED",
            "Auto-migrate requires an explicitly confirmed database target."
        );
    }

    try {
        logger?.info("migration_target", migrationTarget);
        logger?.info("startup_database_check_started");
        try {
            await database.verifyConnection();
        } catch (error) {
            throw startupError(
                "DATABASE_UNAVAILABLE",
                "Database is unavailable during startup.",
                error
            );
        }
        logger?.info("startup_database_check_succeeded");

        if (autoMigrate) {
            logger?.info("startup_migrations_started");
            await migrationRunner.migrate({
                expectedDatabase: migrationExpectedDatabase
            });
        } else {
            logger?.info("startup_migrations_skipped", { reason: "auto_migrate_disabled" });
        }
        const status = await migrationRunner.status({ ensureLedger: false });

        if (!isMigrationStatusReady(status)) {
            throw startupError(
                "MIGRATIONS_PENDING",
                "Database migrations are not fully applied."
            );
        }
        logger?.info("startup_migration_status_succeeded", {
            autoMigrate
        });

        readiness.markReady();
        const app = createApplication({ readiness, logger });
        const server = await listen(app, port);
        logger?.info("startup_listening", { port });

        return { app, server, readiness };
    } catch (error) {
        readiness.markFailed();
        logger?.error("startup_failed", { error });
        await safeClose(database, logger);
        throw error;
    }
}

module.exports = {
    bootstrap,
    isMigrationStatusReady,
    startupError
};
