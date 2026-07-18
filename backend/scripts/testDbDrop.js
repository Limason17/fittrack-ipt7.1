const mysql = require("mysql2");

const db = require("../config/db");
const { createStructuredLogger } = require("../startup/logger");
const { assertDestructiveTestTarget } = require("./databaseSafety");

async function main() {
    const config = db.readDatabaseConfig();
    assertDestructiveTestTarget(config);
    const admin = db.createAdminConnection();
    try {
        await admin.query(`DROP DATABASE IF EXISTS ${mysql.escapeId(config.database)}`);
        createStructuredLogger().info("test_database_drop_completed", {
            database: config.database
        });
    } finally {
        await admin.end();
    }
}

if (require.main === module) {
    main().catch((error) => {
        createStructuredLogger().error("test_database_drop_failed", { error });
        process.exitCode = 1;
    });
}

module.exports = { main };
