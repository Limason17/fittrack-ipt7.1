const mysql = require("mysql2");

const db = require("../config/db");
const { createMigrationRunner } = require("../migrations/runner");
const { createStructuredLogger } = require("../startup/logger");
const { assertDestructiveTestTarget } = require("./databaseSafety");

function assertTestDatabaseName(name, env = process.env, host = env.DB_HOST || "localhost") {
    return assertDestructiveTestTarget({ host, database: name }, env);
}

async function main() {
    const logger = createStructuredLogger();
    const config = db.readDatabaseConfig();
    assertDestructiveTestTarget(config);

    const admin = db.createAdminConnection();
    try {
        await admin.query(`DROP DATABASE IF EXISTS ${mysql.escapeId(config.database)}`);
        await admin.query(
            `CREATE DATABASE ${mysql.escapeId(config.database)}
             CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`
        );
    } finally {
        await admin.end();
    }

    const pool = db.createPool(config);
    try {
        await db.verifyConnection(pool);
        const runner = createMigrationRunner({ pool, logger });
        const result = await runner.migrate();
        logger.info("test_database_reset_completed", {
            database: config.database,
            applied: result.applied
        });
    } finally {
        await db.closePool(pool);
    }
}

if (require.main === module) {
    main().catch((error) => {
        createStructuredLogger().error("test_database_reset_failed", { error });
        process.exitCode = 1;
    });
}

module.exports = {
    assertTestDatabaseName,
    main
};
