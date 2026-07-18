const mysql = require("mysql2");

const db = require("../config/db");
const { createStructuredLogger } = require("../startup/logger");

async function main() {
    const logger = createStructuredLogger();
    if (process.env.NODE_ENV === "production") {
        const error = new Error("Development database initialization is disabled in production.");
        error.code = "DEV_INIT_FORBIDDEN";
        throw error;
    }

    const databaseConfig = db.readDatabaseConfig();
    const admin = db.createAdminConnection();
    try {
        await admin.query(
            `CREATE DATABASE IF NOT EXISTS ${mysql.escapeId(databaseConfig.database)}
             CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`
        );
        logger.info("development_database_available", {
            database: databaseConfig.database
        });
    } finally {
        await admin.end();
    }

    await require("./migrate").main();
}

if (require.main === module) {
    main().catch((error) => {
        createStructuredLogger().error("development_database_init_failed", { error });
        process.exitCode = 1;
    });
}

module.exports = { main };
