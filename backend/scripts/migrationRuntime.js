const db = require("../config/db");
const { createMigrationRunner } = require("../migrations/runner");
const { createStructuredLogger } = require("../startup/logger");

function createMigrationRuntime({ pool = db, logger = createStructuredLogger() } = {}) {
    return {
        pool,
        logger,
        runner: createMigrationRunner({ pool, logger }),
        verifyConnection: () => db.verifyConnection(pool),
        close: () => db.closePool(pool)
    };
}

async function runCli(operation) {
    const runtime = createMigrationRuntime();
    try {
        await runtime.verifyConnection();
        await operation(runtime);
    } catch (error) {
        runtime.logger.error("migration_command_failed", { error });
        process.exitCode = 1;
    } finally {
        try {
            await runtime.close();
        } catch (error) {
            runtime.logger.error("migration_command_close_failed", { error });
            process.exitCode = 1;
        }
    }
}

module.exports = {
    createMigrationRuntime,
    runCli
};
