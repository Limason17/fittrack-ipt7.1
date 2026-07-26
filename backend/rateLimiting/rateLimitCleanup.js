const BUCKETS_TABLE = "security_rate_limit_buckets";
const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_MAX_BATCHES = 200;

// Deletes only buckets whose window has fully expired (expires_at < now) -
// an active bucket, even one currently over its limit (blocked_until set),
// is never touched, since its request_count is still authoritative for the
// remainder of its window. Batched with LIMIT so one cleanup run never holds
// a long-running delete against the table; idempotent (re-running finds
// nothing left to delete) and safe under concurrent traffic (each batch is
// its own statement - a row that a concurrent request re-armed with a new
// window before this statement reached it simply no longer matches
// `expires_at < ?` and is left alone, exactly as intended).
async function cleanupExpiredBuckets({
    database,
    now = Date.now,
    batchSize = DEFAULT_BATCH_SIZE,
    maxBatches = DEFAULT_MAX_BATCHES
}) {
    if (!database || typeof database.execute !== "function") {
        throw new TypeError("cleanupExpiredBuckets requires a promise-pool database with execute().");
    }
    if (!Number.isSafeInteger(batchSize) || batchSize <= 0) {
        throw new TypeError("cleanupExpiredBuckets requires a positive integer batchSize.");
    }

    const nowDate = new Date(now());
    const cutoffSql = nowDate.toISOString().slice(0, 23).replace("T", " ");

    let totalDeleted = 0;
    for (let batch = 0; batch < maxBatches; batch += 1) {
        const [result] = await database.execute(
            `DELETE FROM ${BUCKETS_TABLE} WHERE expires_at < ? LIMIT ${Number(batchSize)}`,
            [cutoffSql]
        );
        totalDeleted += result.affectedRows;
        if (result.affectedRows < batchSize) {
            break;
        }
    }

    return { deleted: totalDeleted };
}

module.exports = { cleanupExpiredBuckets, DEFAULT_BATCH_SIZE };
