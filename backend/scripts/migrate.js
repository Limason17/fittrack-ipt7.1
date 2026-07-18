const db = require("../config/db");
const { createStructuredLogger } = require("../startup/logger");
const { runCli } = require("./migrationRuntime");

async function main() {
    const environment = db.readRuntimeEnvironment();
    const config = db.readDatabaseConfig();
    const expectedDatabase = db.assertMigrationExpectedDatabase(config);
    const target = db.databaseTarget(config, environment);
    createStructuredLogger().info("migration_target", target);

    await runCli(async ({ runner, logger }) => {
        const result = await runner.migrate({ expectedDatabase });
        logger.info("migration_command_completed", {
            applied: result.applied,
            appliedCount: result.applied.length
        });
    });
}

if (require.main === module) {
    main().catch((error) => {
        createStructuredLogger().error("migration_command_failed", { error });
        process.exitCode = 1;
    });
}

module.exports = {
    main
};
