const db = require("../config/db");
const { applyReconciliation } = require("../deletionReceipts/deletionReceiptReconciliation");
const { createAccountDeletionService } = require("../services/accountDeletionService");
const { createStructuredLogger } = require("../startup/logger");

// Destructive: re-applies deletions and may write new receipt files. See
// deletionReceiptReconciliation.js's assertReconciliationAuthorized for the
// three required, exact-match acknowledgements this refuses to run
// without. Never runs against a production database without the operator
// explicitly re-typing the current database name and receipt directory.
async function main(options = {}) {
    const logger = options.logger || createStructuredLogger();
    const env = options.env || process.env;
    let pool;
    let result;
    let failure;

    try {
        const databaseConfig = db.readDatabaseConfig(env);
        pool = options.pool || db.createPool(databaseConfig);
        await db.verifyConnection(pool);
        const sql = typeof pool.promise === "function" ? pool.promise() : pool;
        const deletionService = options.deletionService || createAccountDeletionService({ database: pool, logger });
        result = await applyReconciliation({
            connection: sql,
            deletionService,
            databaseName: databaseConfig.database,
            env,
            logger
        });
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
        logger.error("deletion_receipt_reconcile_apply_failed", { code: failure.code, error: failure.message });
        setExitCode(1);
        return { code: failure.code || "DELETION_RECEIPT_RECONCILE_APPLY_FAILED" };
    }

    logger.info("deletion_receipt_reconcile_apply_completed", result);
    setExitCode(0);
    return result;
}

if (require.main === module) {
    main();
}

module.exports = { main };
