function migrationError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

const NEW_TABLE = "user_email_change_requests";
const NEW_USER_COLUMNS = ["auth_version", "email_changed_at", "password_changed_at"];

module.exports = {
    id: "009_account_self_service",
    description: "Add auth_version/email_changed_at/password_changed_at to users and a user_email_change_requests table",
    async up({ connection, helpers }) {
        for (const columnName of NEW_USER_COLUMNS) {
            if (await helpers.columnExists("users", columnName)) {
                throw migrationError(
                    "ACCOUNT_SELF_SERVICE_SCHEMA_ALREADY_EXISTS",
                    `Refusing to adopt pre-existing column users.${columnName}.`
                );
            }
        }
        if (await helpers.tableExists(NEW_TABLE)) {
            throw migrationError(
                "ACCOUNT_SELF_SERVICE_SCHEMA_ALREADY_EXISTS",
                `Refusing to adopt pre-existing table ${NEW_TABLE}.`
            );
        }

        await connection.query(`
            ALTER TABLE users
                ADD COLUMN auth_version INT NOT NULL DEFAULT 1,
                ADD COLUMN email_changed_at TIMESTAMP(3) NULL,
                ADD COLUMN password_changed_at TIMESTAMP(3) NULL
        `);

        await connection.query(`
            CREATE TABLE ${NEW_TABLE} (
                id INT AUTO_INCREMENT PRIMARY KEY,
                public_id CHAR(36) NOT NULL,
                user_id INT NOT NULL,
                new_email_normalized VARCHAR(254) NOT NULL,
                token_hash BINARY(32) NOT NULL,
                status VARCHAR(16) NOT NULL DEFAULT 'pending',
                expires_at TIMESTAMP(3) NOT NULL,
                created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                confirmed_at TIMESTAMP(3) NULL,
                revoked_at TIMESTAMP(3) NULL,
                UNIQUE INDEX uq_user_email_change_requests_public_id (public_id),
                UNIQUE INDEX uq_user_email_change_requests_token_hash (token_hash),
                INDEX idx_user_email_change_requests_user_status (user_id, status),
                CONSTRAINT fk_user_email_change_requests_user
                    FOREIGN KEY (user_id) REFERENCES users(id)
                    ON DELETE CASCADE,
                CONSTRAINT chk_user_email_change_requests_status
                    CHECK (status IN ('pending', 'confirmed', 'revoked', 'expired'))
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
    }
};
