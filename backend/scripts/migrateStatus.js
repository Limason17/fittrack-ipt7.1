const { assertMigrationStatusReady } = require("../migrations/planner");
const { runCli } = require("./migrationRuntime");

async function main() {
    await runCli(async ({ runner, logger }) => {
        const status = await runner.status({ ensureLedger: false });
        logger.info("migration_status", {
            applied: status.applied.map((item) => item.id),
            pending: status.pending.map((item) => item.id),
            dirty: status.dirty.map((item) => item.id),
            drift: status.drift.map((item) => item.id),
            unknown: status.unknown.map((item) => item.id)
        });
        assertMigrationStatusReady(status);
    });
}

if (require.main === module) {
    main();
}

module.exports = { main };
