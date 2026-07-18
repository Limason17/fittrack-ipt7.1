// Backwards-compatible entry point. This command is now additive and delegates
// to the versioned development database initializer; it never executes schema.sql.
const { main } = require("./scripts/devInit");
const { createStructuredLogger } = require("./startup/logger");

if (require.main === module) {
    main().catch((error) => {
        createStructuredLogger().error("development_database_init_failed", { error });
        process.exitCode = 1;
    });
}

module.exports = { main };
