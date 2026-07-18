const mysql = require("mysql2");

function createSchemaHelpers(connection) {
    let databaseNamePromise;

    async function databaseName() {
        if (!databaseNamePromise) {
            databaseNamePromise = connection.query("SELECT DATABASE() AS database_name").then(
                ([rows]) => rows[0]?.database_name
            );
        }

        const name = await databaseNamePromise;
        if (!name) {
            const error = new Error("No database is selected for migrations.");
            error.code = "DATABASE_NOT_SELECTED";
            throw error;
        }
        return name;
    }

    async function tableExists(tableName) {
        const [rows] = await connection.query(
            `SELECT 1
             FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
             LIMIT 1`,
            [await databaseName(), tableName]
        );
        return rows.length > 0;
    }

    async function columnInfo(tableName, columnName) {
        const [rows] = await connection.query(
            `SELECT
                COLUMN_NAME AS column_name,
                COLUMN_TYPE AS column_type,
                IS_NULLABLE AS is_nullable,
                COLUMN_DEFAULT AS column_default,
                ORDINAL_POSITION AS ordinal_position
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?
             LIMIT 1`,
            [await databaseName(), tableName, columnName]
        );
        return rows[0] || null;
    }

    async function columnExists(tableName, columnName) {
        return Boolean(await columnInfo(tableName, columnName));
    }

    async function indexInfo(tableName, indexName) {
        const [rows] = await connection.query(
            `SELECT
                INDEX_NAME AS index_name,
                NON_UNIQUE AS non_unique,
                SEQ_IN_INDEX AS sequence_number,
                COLUMN_NAME AS column_name
             FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?
             ORDER BY SEQ_IN_INDEX`,
            [await databaseName(), tableName, indexName]
        );
        return rows;
    }

    async function indexExists(tableName, indexName) {
        return (await indexInfo(tableName, indexName)).length > 0;
    }

    async function foreignKeyInfo(tableName, constraintName) {
        const [rows] = await connection.query(
            `SELECT
                kcu.CONSTRAINT_NAME AS constraint_name,
                kcu.COLUMN_NAME AS column_name,
                kcu.REFERENCED_TABLE_NAME AS referenced_table_name,
                kcu.REFERENCED_COLUMN_NAME AS referenced_column_name,
                kcu.ORDINAL_POSITION AS ordinal_position,
                rc.DELETE_RULE AS delete_rule,
                rc.UPDATE_RULE AS update_rule
             FROM information_schema.KEY_COLUMN_USAGE kcu
             INNER JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
                ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
               AND rc.TABLE_NAME = kcu.TABLE_NAME
               AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
             WHERE kcu.CONSTRAINT_SCHEMA = ?
               AND kcu.TABLE_NAME = ?
               AND kcu.CONSTRAINT_NAME = ?
             ORDER BY kcu.ORDINAL_POSITION`,
            [await databaseName(), tableName, constraintName]
        );
        return rows;
    }

    async function foreignKeyExists(tableName, constraintName) {
        return (await foreignKeyInfo(tableName, constraintName)).length > 0;
    }

    async function checkConstraintExists(tableName, constraintName) {
        const [rows] = await connection.query(
            `SELECT 1
             FROM information_schema.TABLE_CONSTRAINTS
             WHERE CONSTRAINT_SCHEMA = ?
               AND TABLE_NAME = ?
               AND CONSTRAINT_NAME = ?
               AND CONSTRAINT_TYPE = 'CHECK'
             LIMIT 1`,
            [await databaseName(), tableName, constraintName]
        );
        return rows.length > 0;
    }

    return {
        checkConstraintExists,
        columnExists,
        columnInfo,
        databaseName,
        escapeId: mysql.escapeId,
        foreignKeyExists,
        foreignKeyInfo,
        indexExists,
        indexInfo,
        tableExists
    };
}

module.exports = {
    createSchemaHelpers
};
