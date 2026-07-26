function migrationError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

const BUCKETS_TABLE = "security_rate_limit_buckets";

module.exports = {
    id: "011_security_rate_limits",
    description: "Add the shared, atomic MySQL-backed rate-limit bucket store",
    async up({ connection, helpers }) {
        if (await helpers.tableExists(BUCKETS_TABLE)) {
            throw migrationError(
                "SECURITY_RATE_LIMITS_SCHEMA_ALREADY_EXISTS",
                `Refusing to adopt pre-existing table ${BUCKETS_TABLE}.`
            );
        }

        // window_started_at/blocked_until/expires_at are DATETIME(3), not
        // TIMESTAMP(3) like most of this schema's bookkeeping columns -
        // deliberately, not an oversight. TIMESTAMP columns are converted
        // to/from the MySQL session's `time_zone` on every read/write; every
        // value this table needs is instead always computed and supplied
        // explicitly by rateLimiting/mysqlRateLimitStore.js from its
        // injected clock, formatted as an unambiguous UTC wall-clock string
        // (see toUtcSql there). DATETIME stores and returns that literal
        // value with zero implicit conversion, so the stored instant can
        // never silently drift from the value the application computed,
        // regardless of the host process's or the MySQL server's own local
        // time zone. created_at/updated_at follow the same DATETIME(3)
        // convention for the same reason (the store always supplies them
        // explicitly too - see docs/STAGE_3D_SECURITY_HARDENING.md).
        await connection.query(`
            CREATE TABLE ${BUCKETS_TABLE} (
                id INT AUTO_INCREMENT PRIMARY KEY,
                policy_id VARCHAR(64) NOT NULL,
                key_hash BINARY(32) NOT NULL,
                window_started_at DATETIME(3) NOT NULL,
                request_count INT UNSIGNED NOT NULL DEFAULT 0,
                blocked_until DATETIME(3) NULL,
                expires_at DATETIME(3) NOT NULL,
                created_at DATETIME(3) NOT NULL,
                updated_at DATETIME(3) NOT NULL,
                UNIQUE INDEX uq_security_rate_limit_buckets_policy_key (policy_id, key_hash),
                INDEX idx_security_rate_limit_buckets_expires (expires_at),
                CONSTRAINT chk_security_rate_limit_buckets_policy_id
                    CHECK (CHAR_LENGTH(policy_id) > 0),
                CONSTRAINT chk_security_rate_limit_buckets_request_count
                    CHECK (request_count >= 0),
                CONSTRAINT chk_security_rate_limit_buckets_window_order
                    CHECK (expires_at >= window_started_at),
                CONSTRAINT chk_security_rate_limit_buckets_blocked_until_order
                    CHECK (blocked_until IS NULL OR blocked_until <= expires_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
    }
};
