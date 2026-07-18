const mysql = require("mysql2");

const db = require("../config/db");
const { createMigrationRunner } = require("../migrations/runner");
const { createStructuredLogger } = require("../startup/logger");

function assertTestDatabaseName(name) {
    const safeTestName = /(^|[_-])test([_-]|$)/i.test(name);
    if (
        process.env.NODE_ENV !== "test" ||
        process.env.ALLOW_TEST_DB_RESET !== "true" ||
        !safeTestName
    ) {
        const error = new Error(
            "Test reset requires NODE_ENV=test, ALLOW_TEST_DB_RESET=true and a DB_NAME containing a test segment."
        );
        error.code = "TEST_DB_RESET_FORBIDDEN";
        throw error;
    }
}

async function main() {
    const logger = createStructuredLogger();
    const config = db.readDatabaseConfig();
    assertTestDatabaseName(config.database);

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
