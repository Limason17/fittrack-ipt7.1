function migrationError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

const NEW_USER_COLUMNS = ["lifecycle_status", "deleted_at"];

module.exports = {
    id: "013_account_lifecycle",
    description: "Add lifecycle_status/deleted_at to users for irreversible account deletion (Stage 5C1)",
    async up({ connection, helpers }) {
        for (const columnName of NEW_USER_COLUMNS) {
            if (await helpers.columnExists("users", columnName)) {
                throw migrationError(
                    "ACCOUNT_LIFECYCLE_SCHEMA_ALREADY_EXISTS",
                    `Refusing to adopt pre-existing column users.${columnName}.`
                );
            }
        }

        // Additive, default-backed columns - every existing row becomes
        // 'active' via the column DEFAULT itself (Stage 5C design Section 19),
        // no UPDATE backfill statement needed. deletion_reason was drafted
        // and then deliberately removed after critical review (ADR 004,
        // "Consequences"): this phase has exactly one deletion trigger
        // (self-service), so a column holding the same constant value on
        // every row it would ever apply to serves no purpose yet.
        await connection.query(`
            ALTER TABLE users
                ADD COLUMN lifecycle_status VARCHAR(16) NOT NULL DEFAULT 'active',
                ADD COLUMN deleted_at TIMESTAMP(3) NULL,
                ADD INDEX idx_users_lifecycle_status (lifecycle_status),
                ADD CONSTRAINT chk_users_lifecycle_status
                    CHECK (lifecycle_status IN ('active', 'deleted')),
                ADD CONSTRAINT chk_users_deleted_at
                    CHECK (
                        (lifecycle_status = 'deleted' AND deleted_at IS NOT NULL)
                        OR (lifecycle_status = 'active' AND deleted_at IS NULL)
                    )
        `);

        // user_auth_sessions.revocation_reason carries no CHECK constraint
        // (verified against 010_auth_sessions.js: plain VARCHAR(32) NULL) -
        // the 'account_deletion' reason string used by the Stage 5C1
        // deletion transaction therefore needs no schema change here, only
        // application-level convention alongside the existing
        // 'password_change'/'email_change'/'logout'/'logout_all'/
        // 'session_limit'/'refresh_reuse_detected' values.
    }
};
