const db = require("../config/db");
const { main: startServer } = require("../server");
const { assertDestructiveTestTarget } = require("./databaseSafety");
const { main: resetTestDatabase } = require("./testDbReset");

async function main() {
    const config = db.readDatabaseConfig();
    assertDestructiveTestTarget(config);
    await resetTestDatabase();
    await startServer();
}

if (require.main === module) {
    main().catch((error) => {
        console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: "error",
            event: "e2e_server_failed",
            error: { name: error.name, code: error.code, message: error.message }
        }));
        process.exitCode = 1;
    });
}

module.exports = { main };
