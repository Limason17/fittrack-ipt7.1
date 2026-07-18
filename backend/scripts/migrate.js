const { runCli } = require("./migrationRuntime");

async function main() {
    await runCli(async ({ runner, logger }) => {
        const result = await runner.migrate();
        logger.info("migration_command_completed", {
            applied: result.applied,
            appliedCount: result.applied.length
        });
    });
}

if (require.main === module) {
    main();
}

module.exports = {
    main
};
