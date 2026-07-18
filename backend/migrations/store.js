const MIGRATION_TABLE = "schema_migrations";

function createMigrationStore(connection, helpers) {
    async function exists() {
        return helpers.tableExists(MIGRATION_TABLE);
    }

    async function ensureTable() {
        if (await exists()) {
            return false;
        }

        await connection.query(`
            CREATE TABLE schema_migrations (
                migration_id VARCHAR(190) NOT NULL PRIMARY KEY,
                description VARCHAR(255) NOT NULL,
                checksum CHAR(64) NOT NULL,
                status VARCHAR(16) NOT NULL,
                started_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                applied_at TIMESTAMP(6) NULL,
                execution_ms INT NULL,
                failure_code VARCHAR(64) NULL,
                CONSTRAINT chk_schema_migrations_status
                    CHECK (status IN ('running', 'applied', 'failed'))
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        return true;
    }

    async function list() {
        if (!(await exists())) {
            return [];
        }

        const [rows] = await connection.query(`
            SELECT
                migration_id AS id,
                description,
                checksum,
                status,
                started_at,
                applied_at,
                execution_ms,
                failure_code
            FROM schema_migrations
            ORDER BY migration_id
        `);
        return rows;
    }

    async function markStarted(migration) {
        await connection.query(
            `INSERT INTO schema_migrations (
                migration_id, description, checksum, status, started_at
             ) VALUES (?, ?, ?, 'running', CURRENT_TIMESTAMP(6))`,
            [migration.id, migration.description, migration.checksum]
        );
    }

    async function markApplied(migration, executionMs) {
        await connection.query(
            `UPDATE schema_migrations
             SET status = 'applied',
                 applied_at = CURRENT_TIMESTAMP(6),
                 execution_ms = ?,
                 failure_code = NULL
             WHERE migration_id = ? AND checksum = ? AND status = 'running'`,
            [executionMs, migration.id, migration.checksum]
        );
    }

    async function markFailed(migration, error) {
        await connection.query(
            `UPDATE schema_migrations
             SET status = 'failed',
                 execution_ms = ?,
                 failure_code = ?
             WHERE migration_id = ? AND checksum = ? AND status = 'running'`,
            [
                error.executionMs,
                String(error.code || "MIGRATION_FAILED").slice(0, 64),
                migration.id,
                migration.checksum
            ]
        );
    }

    return {
        ensureTable,
        exists,
        list,
        markApplied,
        markFailed,
        markStarted
    };
}

module.exports = {
    MIGRATION_TABLE,
    createMigrationStore
};
