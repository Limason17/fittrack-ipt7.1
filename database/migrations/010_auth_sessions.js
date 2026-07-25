function migrationError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

const SESSIONS_TABLE = "user_auth_sessions";
const REFRESH_TOKENS_TABLE = "user_refresh_tokens";

module.exports = {
    id: "010_auth_sessions",
    description: "Add server-side revocable authentication sessions and rotating refresh tokens",
    async up({ connection, helpers }) {
        if (await helpers.tableExists(SESSIONS_TABLE)) {
            throw migrationError(
                "AUTH_SESSIONS_SCHEMA_ALREADY_EXISTS",
                `Refusing to adopt pre-existing table ${SESSIONS_TABLE}.`
            );
        }
        if (await helpers.tableExists(REFRESH_TOKENS_TABLE)) {
            throw migrationError(
                "AUTH_SESSIONS_SCHEMA_ALREADY_EXISTS",
                `Refusing to adopt pre-existing table ${REFRESH_TOKENS_TABLE}.`
            );
        }

        await connection.query(`
            CREATE TABLE ${SESSIONS_TABLE} (
                id INT AUTO_INCREMENT PRIMARY KEY,
                public_id CHAR(36) NOT NULL,
                user_id INT NOT NULL,
                auth_version INT NOT NULL,
                status VARCHAR(16) NOT NULL DEFAULT 'active',
                created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                last_seen_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                expires_at TIMESTAMP(3) NOT NULL,
                revoked_at TIMESTAMP(3) NULL,
                revocation_reason VARCHAR(32) NULL,
                UNIQUE INDEX uq_user_auth_sessions_public_id (public_id),
                INDEX idx_user_auth_sessions_user_status (user_id, status),
                INDEX idx_user_auth_sessions_expires (expires_at),
                CONSTRAINT fk_user_auth_sessions_user
                    FOREIGN KEY (user_id) REFERENCES users(id)
                    ON DELETE CASCADE,
                CONSTRAINT chk_user_auth_sessions_status
                    CHECK (status IN ('active', 'revoked', 'expired', 'compromised'))
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        await connection.query(`
            CREATE TABLE ${REFRESH_TOKENS_TABLE} (
                id INT AUTO_INCREMENT PRIMARY KEY,
                public_id CHAR(36) NOT NULL,
                session_id INT NOT NULL,
                token_hash BINARY(32) NOT NULL,
                csrf_token_hash BINARY(32) NOT NULL,
                status VARCHAR(16) NOT NULL DEFAULT 'active',
                created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                expires_at TIMESTAMP(3) NOT NULL,
                consumed_at TIMESTAMP(3) NULL,
                replaced_by_token_id INT NULL,
                revoked_at TIMESTAMP(3) NULL,
                UNIQUE INDEX uq_user_refresh_tokens_public_id (public_id),
                UNIQUE INDEX uq_user_refresh_tokens_token_hash (token_hash),
                INDEX idx_user_refresh_tokens_session_status (session_id, status),
                CONSTRAINT fk_user_refresh_tokens_session
                    FOREIGN KEY (session_id) REFERENCES ${SESSIONS_TABLE}(id)
                    ON DELETE CASCADE,
                CONSTRAINT fk_user_refresh_tokens_replaced_by
                    FOREIGN KEY (replaced_by_token_id) REFERENCES ${REFRESH_TOKENS_TABLE}(id)
                    ON DELETE SET NULL,
                CONSTRAINT chk_user_refresh_tokens_status
                    CHECK (status IN ('active', 'rotated', 'revoked', 'expired', 'compromised'))
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
    }
};
