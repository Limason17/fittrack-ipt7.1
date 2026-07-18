function migrationError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

const STUDIO_TABLES = [
    "studios",
    "studio_memberships",
    "studio_invitations",
    "studio_audit_events"
];

module.exports = {
    id: "005_studio_tenancy_and_rbac",
    description: "Add isolated studio tenancy, memberships, invitations, and audit events",
    async up({ connection, helpers }) {
        for (const table of STUDIO_TABLES) {
            if (await helpers.tableExists(table)) {
                throw migrationError(
                    "STUDIO_SCHEMA_ALREADY_EXISTS",
                    `Refusing to adopt pre-existing table ${table}.`
                );
            }
        }

        await connection.query(`
            CREATE TABLE studios (
                id INT AUTO_INCREMENT PRIMARY KEY,
                public_id CHAR(36) NOT NULL,
                name VARCHAR(120) NOT NULL,
                slug VARCHAR(80) NOT NULL,
                status VARCHAR(16) NOT NULL DEFAULT 'active',
                default_locale VARCHAR(10) NOT NULL DEFAULT 'de',
                default_timezone VARCHAR(64) NOT NULL DEFAULT 'Europe/Zurich',
                default_weight_unit VARCHAR(4) NOT NULL DEFAULT 'kg',
                created_by_user_id INT NOT NULL,
                created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                    ON UPDATE CURRENT_TIMESTAMP(3),
                UNIQUE INDEX uq_studios_public_id (public_id),
                UNIQUE INDEX uq_studios_slug (slug),
                INDEX idx_studios_created_by_user (created_by_user_id),
                CONSTRAINT fk_studios_created_by_user
                    FOREIGN KEY (created_by_user_id) REFERENCES users(id)
                    ON DELETE RESTRICT,
                CONSTRAINT chk_studios_status
                    CHECK (status IN ('active', 'suspended')),
                CONSTRAINT chk_studios_default_weight_unit
                    CHECK (default_weight_unit IN ('kg', 'lb'))
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        await connection.query(`
            CREATE TABLE studio_memberships (
                id INT AUTO_INCREMENT PRIMARY KEY,
                public_id CHAR(36) NOT NULL,
                studio_id INT NOT NULL,
                user_id INT NOT NULL,
                role VARCHAR(16) NOT NULL,
                status VARCHAR(16) NOT NULL,
                invited_by_user_id INT NULL,
                joined_at TIMESTAMP(3) NULL,
                created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                    ON UPDATE CURRENT_TIMESTAMP(3),
                UNIQUE INDEX uq_studio_memberships_public_id (public_id),
                UNIQUE INDEX uq_studio_memberships_studio_user (studio_id, user_id),
                INDEX idx_studio_memberships_user_status (user_id, status),
                INDEX idx_studio_memberships_studio_role_status (studio_id, role, status),
                INDEX idx_studio_memberships_invited_by_user (invited_by_user_id),
                CONSTRAINT fk_studio_memberships_studio
                    FOREIGN KEY (studio_id) REFERENCES studios(id)
                    ON DELETE CASCADE,
                CONSTRAINT fk_studio_memberships_user
                    FOREIGN KEY (user_id) REFERENCES users(id)
                    ON DELETE RESTRICT,
                CONSTRAINT fk_studio_memberships_invited_by_user
                    FOREIGN KEY (invited_by_user_id) REFERENCES users(id)
                    ON DELETE SET NULL,
                CONSTRAINT chk_studio_memberships_role
                    CHECK (role IN ('owner', 'admin', 'trainer', 'member')),
                CONSTRAINT chk_studio_memberships_status
                    CHECK (status IN ('invited', 'active', 'suspended', 'left'))
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        await connection.query(`
            CREATE TABLE studio_invitations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                public_id CHAR(36) NOT NULL,
                studio_id INT NOT NULL,
                email_normalized VARCHAR(254) NOT NULL,
                role VARCHAR(16) NOT NULL,
                token_hash BINARY(32) NOT NULL,
                status VARCHAR(16) NOT NULL DEFAULT 'pending',
                expires_at TIMESTAMP(3) NOT NULL,
                invited_by_user_id INT NULL,
                accepted_by_user_id INT NULL,
                accepted_at TIMESTAMP(3) NULL,
                created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                revoked_at TIMESTAMP(3) NULL,
                UNIQUE INDEX uq_studio_invitations_public_id (public_id),
                UNIQUE INDEX uq_studio_invitations_token_hash (token_hash),
                INDEX idx_studio_invitations_studio_status_expires (
                    studio_id, status, expires_at
                ),
                INDEX idx_studio_invitations_email_status (email_normalized, status),
                INDEX idx_studio_invitations_invited_by_user (invited_by_user_id),
                INDEX idx_studio_invitations_accepted_by_user (accepted_by_user_id),
                CONSTRAINT fk_studio_invitations_studio
                    FOREIGN KEY (studio_id) REFERENCES studios(id)
                    ON DELETE CASCADE,
                CONSTRAINT fk_studio_invitations_invited_by_user
                    FOREIGN KEY (invited_by_user_id) REFERENCES users(id)
                    ON DELETE SET NULL,
                CONSTRAINT fk_studio_invitations_accepted_by_user
                    FOREIGN KEY (accepted_by_user_id) REFERENCES users(id)
                    ON DELETE SET NULL,
                CONSTRAINT chk_studio_invitations_role
                    CHECK (role IN ('admin', 'trainer', 'member')),
                CONSTRAINT chk_studio_invitations_status
                    CHECK (status IN ('pending', 'accepted', 'revoked', 'expired'))
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        await connection.query(`
            CREATE TABLE studio_audit_events (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                public_id CHAR(36) NOT NULL,
                studio_id INT NOT NULL,
                actor_user_id INT NULL,
                event_type VARCHAR(64) NOT NULL,
                target_type VARCHAR(32) NULL,
                target_public_id CHAR(36) NULL,
                details_json JSON NULL,
                created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                UNIQUE INDEX uq_studio_audit_events_public_id (public_id),
                INDEX idx_studio_audit_events_studio_created_id (
                    studio_id, created_at, id
                ),
                INDEX idx_studio_audit_events_actor_created_id (
                    actor_user_id, created_at, id
                ),
                CONSTRAINT fk_studio_audit_events_studio
                    FOREIGN KEY (studio_id) REFERENCES studios(id)
                    ON DELETE CASCADE,
                CONSTRAINT fk_studio_audit_events_actor_user
                    FOREIGN KEY (actor_user_id) REFERENCES users(id)
                    ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
    }
};
