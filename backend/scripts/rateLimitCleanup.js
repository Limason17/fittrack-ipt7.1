const db = require("../config/db");
const { createStructuredLogger } = require("../startup/logger");
const { cleanupExpiredBuckets } = require("../rateLimiting/rateLimitCleanup");

// Optional manual companion to the lazy, in-request cleanup already applied
// by rateLimiting/mysqlRateLimitStore.js (Section 20) - not required for
// correctness (an expired bucket is simply overwritten in place the next
// time its key is used again), only for reclaiming space from keys that
// will never be reused (e.g. a one-off IP). No scheduler: run manually or
// from an external cron if desired.
async function main() {
    const logger = createStructuredLogger();
    try {
        await db.verifyConnection(db);
        const result = await cleanupExpiredBuckets({ database: db.promise() });
        logger.info("rate_limit_cleanup_completed", { deleted: result.deleted });
    } catch (error) {
        logger.error("rate_limit_cleanup_failed", { error });
        process.exitCode = 1;
    } finally {
        try {
            await db.closePool(db);
        } catch (error) {
            logger.error("rate_limit_cleanup_close_failed", { error });
            process.exitCode = 1;
        }
    }
}

if (require.main === module) {
    main();
}

module.exports = { main };
