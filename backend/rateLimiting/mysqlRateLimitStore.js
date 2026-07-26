const { RateLimitStoreUnavailableError } = require("../errors/RateLimitErrors");
const { cleanupExpiredBuckets } = require("./rateLimitCleanup");

const BUCKETS_TABLE = "security_rate_limit_buckets";

// Lazy cleanup (Section 20): no scheduler, no background process - instead,
// a small random fraction of otherwise-normal consume() calls also fires a
// small, bounded, best-effort cleanup batch. Deliberately fire-and-forget:
// a cleanup failure must never fail (or even slow down) the request that
// triggered it, so its promise is never awaited and any error is swallowed
// after being logged. This keeps the table from growing unboundedly between
// runs of the explicit `npm run security:rate-limits:cleanup` command
// (rateLimiting/rateLimitCleanup.js) without requiring one at all.
const LAZY_CLEANUP_PROBABILITY = 0.01;
const LAZY_CLEANUP_BATCH_SIZE = 50;
const LAZY_CLEANUP_MAX_BATCHES = 1;

function maybeTriggerLazyCleanup(database, now, logger) {
    if (Math.random() >= LAZY_CLEANUP_PROBABILITY) {
        return;
    }
    cleanupExpiredBuckets({
        database,
        now,
        batchSize: LAZY_CLEANUP_BATCH_SIZE,
        maxBatches: LAZY_CLEANUP_MAX_BATCHES
    }).catch((error) => {
        logger?.warn?.("rate_limit_lazy_cleanup_failed", { error: error?.message });
    });
}

// DATETIME(3) columns store exactly the literal value given, with no
// server-side time-zone conversion (see the comment in
// database/migrations/011_security_rate_limits.js) - so every value this
// store WRITES is formatted here, explicitly, as a UTC wall-clock string.
// `new Date(ms)` always represents a UTC instant internally regardless of
// the host process's local time zone; toISOString() is likewise always UTC.
function toUtcSql(date) {
    return date.toISOString().slice(0, 23).replace("T", " ");
}

// The write side above is only half of the UTC-correctness story. On
// READ, mysql2 (like most MySQL drivers) turns a DATETIME column into a JS
// Date by parsing its plain "YYYY-MM-DD HH:MM:SS.mmm" string as LOCAL time,
// not UTC - because a MySQL DATETIME string itself carries no time-zone
// information at all, and the driver has to assume something. On a host
// whose local time zone is not UTC (confirmed here: this dev machine is
// UTC+2/CEST), that silently reinterprets a value written as (say)
// "21:54:31 UTC" as if it meant "21:54:31 local", introducing exactly a
// 2-hour skew on every read and making window-expiry comparisons wrong in
// a way that is invisible until a machine outside UTC actually runs this
// code (found via test/integration/rateLimitStore.test.js's parallel-
// request test). The fix: every query that needs to compare against this
// store's own UTC clock explicitly casts the column to CHAR in SQL (so
// mysql2 hands back a plain string, never attempting Date conversion at
// all) and this function parses that string itself, explicitly as UTC.
function parseUtcSql(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(String(value));
    if (!match) {
        throw new RateLimitStoreUnavailableError(`Unexpected datetime format from rate limit store: ${value}`);
    }
    const [, year, month, day, hours, minutes, seconds, fraction] = match;
    const milliseconds = fraction ? Number(fraction.padEnd(3, "0").slice(0, 3)) : 0;
    return Date.UTC(
        Number(year), Number(month) - 1, Number(day),
        Number(hours), Number(minutes), Number(seconds), milliseconds
    );
}

// Ensures a row for this (policy_id, key_hash) exists, as an empty/fresh
// bucket, without needing to know yet whether this call is a first-ever hit
// or a re-hit. INSERT IGNORE means a concurrent caller racing the exact same
// brand-new key simply has its (harmless) duplicate insert silently dropped
// by the unique index instead of throwing - whichever of them "wins" the
// row, both proceed to the SELECT ... FOR UPDATE below to do the real
// accounting.
const ENSURE_ROW_SQL = `
    INSERT IGNORE INTO ${BUCKETS_TABLE}
        (policy_id, key_hash, window_started_at, request_count, blocked_until, expires_at, created_at, updated_at)
    VALUES (?, ?, ?, 0, NULL, ?, ?, ?)
`;

// CAST(... AS CHAR) is deliberate - see parseUtcSql's comment above.
const LOCK_ROW_SQL = `
    SELECT request_count, CAST(window_started_at AS CHAR) AS window_started_at
    FROM ${BUCKETS_TABLE}
    WHERE policy_id = ? AND key_hash = ?
    FOR UPDATE
`;

const APPLY_ROW_SQL = `
    UPDATE ${BUCKETS_TABLE}
    SET request_count = ?, window_started_at = ?, expires_at = ?, blocked_until = ?, updated_at = ?
    WHERE policy_id = ? AND key_hash = ?
`;

function createMySqlRateLimitStore({ database, logger } = {}) {
    if (!database || typeof database.getConnection !== "function") {
        throw new TypeError("createMySqlRateLimitStore requires a promise-pool database with getConnection().");
    }

    // consume() is the store's entire public contract: given a policy's
    // identity, key, window and limit, atomically record one more request
    // against that bucket and report whether it is within the limit.
    // `now` is always caller-supplied (see rateLimiting/rateLimitPolicies.js
    // and middleware/rateLimiter.js) so the whole chain - policy window
    // math, bucket rollover, Retry-After - is driven by one injectable
    // clock, never `Date.now()`/`NOW()` called independently at different
    // layers.
    //
    // Atomicity comes from an explicit transaction with `SELECT ... FOR
    // UPDATE`: that statement takes an exclusive lock on this key's row for
    // the rest of the transaction, so a second concurrent caller racing the
    // SAME key blocks at its own SELECT ... FOR UPDATE until the first
    // caller commits or rolls back, and then reads the first caller's
    // already-applied update. Every caller therefore reads and increments
    // the count under exclusive ownership of that row - there is no window
    // in which two concurrent callers can both read the same count and both
    // decide they are "allowed". An earlier version of this store used a
    // single INSERT ... ON DUPLICATE KEY UPDATE followed by a plain
    // (unlocked) SELECT to report the outcome; under real concurrent load
    // that follow-up SELECT could observe a LATER sibling call's
    // already-committed increment, making every one of a burst of
    // concurrent callers see a count already over the limit and get
    // wrongly blocked - found via this file's own parallel-request test in
    // test/integration/rateLimitStore.test.js, which is why this design
    // replaces it.
    async function consume({ policyId, keyHash, windowMs, max, now }) {
        if (typeof policyId !== "string" || !policyId) {
            throw new TypeError("consume() requires a policyId.");
        }
        if (!Buffer.isBuffer(keyHash) || keyHash.length !== 32) {
            throw new TypeError("consume() requires a 32-byte keyHash Buffer.");
        }
        if (!Number.isSafeInteger(windowMs) || windowMs <= 0) {
            throw new TypeError("consume() requires a positive integer windowMs.");
        }
        if (!Number.isSafeInteger(max) || max <= 0) {
            throw new TypeError("consume() requires a positive integer max.");
        }
        const nowDate = now instanceof Date ? now : new Date(now);
        if (Number.isNaN(nowDate.getTime())) {
            throw new TypeError("consume() requires a valid now.");
        }

        const nowMs = nowDate.getTime();
        const nowSql = toUtcSql(nowDate);
        const initialExpiresAtSql = toUtcSql(new Date(nowMs + windowMs));

        let connection;
        try {
            connection = await database.getConnection();
        } catch (error) {
            throw new RateLimitStoreUnavailableError(
                "The MySQL rate limit store could not be reached.",
                { cause: error }
            );
        }

        try {
            await connection.execute(ENSURE_ROW_SQL, [policyId, keyHash, nowSql, initialExpiresAtSql, nowSql, nowSql]);
            await connection.beginTransaction();
            const [rows] = await connection.execute(LOCK_ROW_SQL, [policyId, keyHash]);
            const existing = rows[0];
            if (!existing) {
                // Cannot happen under normal operation (ENSURE_ROW_SQL above
                // guarantees the row exists before this transaction starts)
                // - treated as a store fault rather than a silent "allow".
                throw new RateLimitStoreUnavailableError("Rate limit bucket missing immediately after ensure-row insert.");
            }

            const existingWindowStartMs = parseUtcSql(existing.window_started_at);
            const windowExpired = existingWindowStartMs <= nowMs - windowMs;

            const newCount = windowExpired ? 1 : Number(existing.request_count) + 1;
            const newWindowStartMs = windowExpired ? nowMs : existingWindowStartMs;
            const newExpiresAtMs = newWindowStartMs + windowMs;
            const blockedUntilSql = newCount > max ? toUtcSql(new Date(newExpiresAtMs)) : null;

            await connection.execute(APPLY_ROW_SQL, [
                newCount,
                toUtcSql(new Date(newWindowStartMs)),
                toUtcSql(new Date(newExpiresAtMs)),
                blockedUntilSql,
                nowSql,
                policyId,
                keyHash
            ]);
            await connection.commit();

            const allowed = newCount <= max;
            const retryAfterSeconds = allowed ? 0 : Math.max(1, Math.ceil((newExpiresAtMs - nowMs) / 1000));

            maybeTriggerLazyCleanup(database, () => nowMs, logger);

            return {
                allowed,
                remaining: Math.max(0, max - newCount),
                retryAfterSeconds,
                resetAt: newExpiresAtMs
            };
        } catch (error) {
            try {
                await connection.rollback();
            } catch {
                // The connection itself may already be dead (the original
                // outage) - rollback failing is not a new, separate error
                // worth surfacing over the one already being thrown below.
            }
            if (error instanceof RateLimitStoreUnavailableError) {
                throw error;
            }
            throw new RateLimitStoreUnavailableError(
                "The MySQL rate limit store could not be reached.",
                { cause: error }
            );
        } finally {
            connection.release();
        }
    }

    return { consume };
}

module.exports = { createMySqlRateLimitStore, parseUtcSql, toUtcSql };
