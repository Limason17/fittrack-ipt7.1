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
    createApplication,
    listen,
    port = Number(process.env.PORT) || 3001
}) {
    if (!database || !migrationRunner || !readiness) {
        throw new TypeError("Bootstrap dependencies are incomplete.");
    }

    try {
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

        logger?.info("startup_migrations_started");
        await migrationRunner.migrate();
        const status = await migrationRunner.status({ ensureLedger: false });

        if (!isMigrationStatusReady(status)) {
            throw startupError(
                "MIGRATIONS_PENDING",
                "Database migrations are not fully applied."
            );
        }
        logger?.info("startup_migrations_succeeded");

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
