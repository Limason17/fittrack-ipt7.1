const db = require("../config/db");
const { planReconciliation } = require("../deletionReceipts/deletionReceiptReconciliation");
const { createStructuredLogger } = require("../startup/logger");

async function main(options = {}) {
    const logger = options.logger || createStructuredLogger();
    const env = options.env || process.env;
    let pool;
    let plan;
    let failure;

    try {
        pool = options.pool || db.createPool(db.readDatabaseConfig(env));
        await db.verifyConnection(pool);
        const sql = typeof pool.promise === "function" ? pool.promise() : pool;
        plan = await planReconciliation({ connection: sql, env });
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
        logger.error("deletion_receipt_reconcile_plan_failed", { error: failure });
        setExitCode(1);
        return { code: "DELETION_RECEIPT_RECONCILE_PLAN_FAILED" };
    }

    logger.info("deletion_receipt_reconcile_plan", plan);
    setExitCode(0);
    return plan;
}

if (require.main === module) {
    main();
}

module.exports = { main };
