const db = require("../config/db");
const { diagnoseDeletionReceipts, EXIT_CODES } = require("../deletionReceipts/deletionReceiptDoctor");
const { createStructuredLogger } = require("../startup/logger");

function resultLogMethod(report) {
    if (report.state === "ready" || report.state === "not_configured") {
        return "info";
    }
    return "error";
}

async function main(options = {}) {
    const logger = options.logger || createStructuredLogger();
    const env = options.env || process.env;
    let pool;
    let report;
    let failure;

    try {
        pool = options.pool || db.createPool(db.readDatabaseConfig(env));
        await db.verifyConnection(pool);
        const sql = typeof pool.promise === "function" ? pool.promise() : pool;
        report = await diagnoseDeletionReceipts({ connection: sql, env });
    } catch (error) {
        failure = error;
    } finally {
        if (pool && !options.pool) {
            try {
                await db.closePool(pool);
            } catch (error) {
                failure = failure || error;
            }
        }
    }

    const setExitCode = options.setExitCode || ((exitCode) => (process.exitCode = exitCode));

    if (failure) {
        const exitCode = EXIT_CODES.CONFIGURATION_UNSAFE;
        logger.error("deletion_receipt_doctor_result", {
            code: "DELETION_RECEIPT_DOCTOR_FAILED",
            state: "failed",
            exitCode,
            error: failure
        });
        setExitCode(exitCode);
        return { code: "DELETION_RECEIPT_DOCTOR_FAILED", state: "failed", exitCode };
    }

    logger[resultLogMethod(report)]("deletion_receipt_doctor_result", report);
    setExitCode(report.exitCode);
    return report;
}

if (require.main === module) {
    main();
}

module.exports = { main, resultLogMethod };
