const { loadMigrations } = require("./loader");
const { planMigrations, validateMigrationRegistry } = require("./planner");
const { createSchemaHelpers } = require("./schemaHelpers");
const { createMigrationStore } = require("./store");
const {
    LEDGER_SCHEMA_CONTRACT,
    MIGRATION_SCHEMA_CONTRACT
} = require("./schemaContract");
const {
    isoTimestamp,
    safeChecksum,
    safeFailureCode,
    safeMigrationId,
    summarizeMigrationStatus
} = require("./statusReport");

const DOCTOR_EXIT_CODES = Object.freeze({
    READY: 0,
    OPERATIONAL_FAILURE: 1,
    PENDING: 2,
    RECOVERY_REQUIRED: 3
});

function doctorError(code, message, cause) {
    const error = new Error(message, cause ? { cause } : undefined);
    error.code = code;
    return error;
}

function promisePool(pool) {
    return typeof pool.promise === "function" ? pool.promise() : pool;
}

function isSelectOnlyStatement(sql) {
    const statement = String(sql || "").trim();
    if (!/^SELECT\b/i.test(statement)) {
        return false;
    }

    if (
        /\b(?:GET_LOCK|RELEASE_LOCK|SLEEP|BENCHMARK)\s*\(/i.test(statement) ||
        /\bINTO\b/i.test(statement) ||
        /\bFOR\s+UPDATE\b/i.test(statement) ||
        /\bLOCK\s+IN\s+SHARE\s+MODE\b/i.test(statement) ||
        /:=/.test(statement)
    ) {
        return false;
    }

    const firstSemicolon = statement.indexOf(";");
    return firstSemicolon === -1 || statement.slice(firstSemicolon + 1).trim() === "";
}

function createSelectOnlyConnection(connection, onQuery) {
    if (!connection || typeof connection.query !== "function") {
        throw new TypeError("Read-only migration diagnostics require a database connection.");
    }

    return {
        async query(sql, parameters) {
            if (!isSelectOnlyStatement(sql)) {
                throw doctorError(
                    "MIGRATION_DOCTOR_WRITE_FORBIDDEN",
                    "Migration diagnostics permit SELECT statements only."
                );
            }
            onQuery?.(String(sql));
            return connection.query(sql, parameters);
        }
    };
}

function normalizeColumnType(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/\s+/g, "");
}

function normalizeDeleteRule(value) {
    const rule = String(value || "").trim().toUpperCase();
    return rule === "NO ACTION" ? "RESTRICT" : rule;
}

function schemaObjectName(check) {
    switch (check.kind) {
        case "table":
            return check.table;
        case "column":
            return `${check.table}.${check.column}`;
        case "index":
            return `${check.table}.${check.index}`;
        case "foreign_key":
        case "check_constraint":
            return `${check.table}.${check.constraint}`;
        default:
            return check.table || "[UNKNOWN_SCHEMA_OBJECT]";
    }
}

async function inspectSchemaCheck(helpers, check, tableExists) {
    const common = {
        migrationId: check.migrationId,
        kind: check.kind,
        object: schemaObjectName(check),
        table: check.table,
        pendingMissingAllowed: check.pendingMissingAllowed !== false,
        repairableMismatch: check.repairableMismatch === true
    };

    const tablePresent = await tableExists(check.table);
    if (check.kind === "table") {
        return {
            ...common,
            status: tablePresent ? "ok" : "missing",
            expected: { exists: true },
            actual: { exists: tablePresent }
        };
    }

    if (!tablePresent) {
        return {
            ...common,
            status: "missing",
            expected: { exists: true },
            actual: { exists: false }
        };
    }

    if (check.kind === "column") {
        const info = await helpers.columnInfo(check.table, check.column);
        if (!info) {
            return {
                ...common,
                status: "missing",
                expected: {
                    columnType: normalizeColumnType(check.columnType),
                    nullable: check.nullable
                },
                actual: null
            };
        }

        const expected = {
            columnType: normalizeColumnType(check.columnType),
            nullable: check.nullable
        };
        const actual = {
            columnType: normalizeColumnType(info.column_type),
            nullable: info.is_nullable === "YES"
        };
        return {
            ...common,
            status:
                expected.columnType === actual.columnType &&
                expected.nullable === actual.nullable
                    ? "ok"
                    : "mismatch",
            expected,
            actual
        };
    }

    if (check.kind === "index") {
        const rows = await helpers.indexInfo(check.table, check.index);
        if (rows.length === 0) {
            return {
                ...common,
                status: "missing",
                expected: { columns: check.columns, unique: check.unique },
                actual: null
            };
        }

        const expected = { columns: check.columns, unique: check.unique };
        const actual = {
            columns: rows.map((row) => row.column_name),
            unique: Number(rows[0].non_unique) === 0
        };
        return {
            ...common,
            status:
                expected.unique === actual.unique &&
                expected.columns.length === actual.columns.length &&
                expected.columns.every((column, index) => column === actual.columns[index])
                    ? "ok"
                    : "mismatch",
            expected,
            actual
        };
    }

    if (check.kind === "foreign_key") {
        const rows = await helpers.foreignKeyInfo(check.table, check.constraint);
        if (rows.length === 0) {
            return {
                ...common,
                status: "missing",
                expected: {
                    columns: check.columns,
                    referencedTable: check.referencedTable,
                    referencedColumns: check.referencedColumns,
                    deleteRule: normalizeDeleteRule(check.deleteRule)
                },
                actual: null
            };
        }

        const expected = {
            columns: check.columns,
            referencedTable: check.referencedTable,
            referencedColumns: check.referencedColumns,
            deleteRule: normalizeDeleteRule(check.deleteRule)
        };
        const actual = {
            columns: rows.map((row) => row.column_name),
            referencedTable: rows[0].referenced_table_name,
            referencedColumns: rows.map((row) => row.referenced_column_name),
            deleteRule: normalizeDeleteRule(rows[0].delete_rule)
        };
        const sameColumns =
            expected.columns.length === actual.columns.length &&
            expected.columns.every((column, index) => column === actual.columns[index]);
        const sameReferencedColumns =
            expected.referencedColumns.length === actual.referencedColumns.length &&
            expected.referencedColumns.every(
                (column, index) => column === actual.referencedColumns[index]
            );
        return {
            ...common,
            status:
                sameColumns &&
                sameReferencedColumns &&
                expected.referencedTable === actual.referencedTable &&
                expected.deleteRule === actual.deleteRule
                    ? "ok"
                    : "mismatch",
            expected,
            actual
        };
    }

    if (check.kind === "check_constraint") {
        const exists = await helpers.checkConstraintExists(
            check.table,
            check.constraint
        );
        return {
            ...common,
            status: exists ? "ok" : "missing",
            expected: { exists: true },
            actual: { exists }
        };
    }

    throw doctorError(
        "INVALID_MIGRATION_SCHEMA_CONTRACT",
        `Unsupported schema check kind: ${check.kind || "<missing>"}.`
    );
}

async function inspectSchemaContract(helpers, contract) {
    const tablePresence = new Map();
    async function tableExists(tableName) {
        if (!tablePresence.has(tableName)) {
            tablePresence.set(tableName, helpers.tableExists(tableName));
        }
        return tablePresence.get(tableName);
    }

    const results = [];
    for (const migration of contract) {
        for (const check of migration.checks || []) {
            results.push(await inspectSchemaCheck(helpers, check, tableExists));
        }
    }
    return results;
}

function validateContractCoverage(migrations, contract) {
    const contractIds = new Set(contract.map((item) => item.migrationId));
    const missing = migrations
        .map((migration) => migration.id)
        .filter((migrationId) => !contractIds.has(migrationId));
    if (missing.length > 0) {
        throw doctorError(
            "INVALID_MIGRATION_SCHEMA_CONTRACT",
            `Schema contract is missing migrations: ${missing.join(", ")}.`
        );
    }
}

function publicSchemaCheck(check) {
    return {
        migrationId: check.migrationId,
        kind: check.kind,
        object: check.object,
        status: check.status,
        expected: check.expected,
        actual: check.actual
    };
}

function schemaIssue(check, code) {
    return {
        code,
        migrationId: safeMigrationId(check.migrationId),
        kind: check.kind,
        object: check.object,
        expected: check.expected,
        actual: check.actual
    };
}

function classifySchemaIssues(status, checks) {
    const applied = new Set((status.applied || []).map((item) => item.id));
    const dirty = new Set((status.dirty || []).map((item) => item.id));
    const pending = new Set((status.pending || []).map((item) => item.id));
    const tablePresence = new Map(
        checks
            .filter((check) => check.kind === "table")
            .map((check) => [check.table, check.status === "ok"])
    );
    const issues = [];

    for (const check of checks) {
        if (check.status === "ok") {
            continue;
        }

        if (applied.has(check.migrationId) || dirty.has(check.migrationId)) {
            issues.push(
                schemaIssue(
                    check,
                    check.status === "missing"
                        ? "MIGRATION_SCHEMA_MISSING"
                        : "MIGRATION_SCHEMA_MISMATCH"
                )
            );
            continue;
        }

        if (!pending.has(check.migrationId)) {
            continue;
        }

        const parentTableMissing = tablePresence.get(check.table) === false;
        const missingCanBeCreated =
            check.status === "missing" &&
            (check.pendingMissingAllowed || (check.kind !== "table" && parentTableMissing));
        const mismatchCanBeRepaired =
            check.status === "mismatch" && check.repairableMismatch;

        if (!missingCanBeCreated && !mismatchCanBeRepaired) {
            issues.push(schemaIssue(check, "MIGRATION_PREFLIGHT_BLOCKED"));
        }
    }

    for (const migrationId of dirty) {
        const migrationChecks = checks.filter(
            (check) => check.migrationId === migrationId
        );
        const matching = migrationChecks.filter((check) => check.status === "ok").length;
        const failing = migrationChecks.length - matching;
        if (matching > 0 && failing > 0) {
            issues.push({
                code: "MIGRATION_SCHEMA_PARTIAL",
                migrationId: safeMigrationId(migrationId),
                matchingChecks: matching,
                failingChecks: failing
            });
        }
    }

    return issues;
}

function ledgerSchemaIssue(check) {
    return {
        code: "MIGRATION_LEDGER_INVALID",
        reason:
            check.status === "missing"
                ? "ledger_schema_element_missing"
                : "ledger_schema_element_mismatch",
        kind: check.kind,
        object: check.object,
        expected: check.expected,
        actual: check.actual
    };
}

function validateLedgerRecords(records) {
    const issues = [];
    for (const record of records) {
        const migrationId = safeMigrationId(record.id);
        if (migrationId === "[INVALID_MIGRATION_ID]") {
            issues.push({
                code: "MIGRATION_LEDGER_INVALID",
                reason: "invalid_migration_id",
                migrationId
            });
        }
        if (!safeChecksum(record.checksum)) {
            issues.push({
                code: "MIGRATION_LEDGER_INVALID",
                reason: "invalid_checksum",
                migrationId
            });
        }
        if (!["running", "applied", "failed"].includes(record.status)) {
            issues.push({
                code: "MIGRATION_LEDGER_INVALID",
                reason: "invalid_status",
                migrationId
            });
        }
        if (!isoTimestamp(record.started_at)) {
            issues.push({
                code: "MIGRATION_LEDGER_INVALID",
                reason: "invalid_started_at",
                migrationId
            });
        }
        if (record.status === "applied" && !isoTimestamp(record.applied_at)) {
            issues.push({
                code: "MIGRATION_LEDGER_INVALID",
                reason: "invalid_applied_at",
                migrationId
            });
        }
        const failureCode = safeFailureCode(record.failure_code);
        if (
            (record.failure_code && failureCode === "MIGRATION_FAILURE_CODE_INVALID") ||
            (record.status === "failed" && failureCode === null)
        ) {
            issues.push({
                code: "MIGRATION_LEDGER_INVALID",
                reason: "invalid_failure_code",
                migrationId
            });
        }
    }
    return issues;
}

function statusIssues(statusSummary) {
    return [
        ...statusSummary.dirty.map((item) => ({
            code: "MIGRATION_DIRTY",
            ...item
        })),
        ...statusSummary.drift.map((item) => ({
            code: "MIGRATION_CHECKSUM_DRIFT",
            ...item
        })),
        ...statusSummary.unknown.map((item) => ({
            code: "MIGRATION_UNKNOWN",
            ...item
        }))
    ];
}

function buildDoctorReport({
    database,
    migrations,
    records,
    ledger,
    schemaChecks
}) {
    const status = planMigrations(migrations, records);
    const migrationStatus = summarizeMigrationStatus(status);
    const migrationIssues = statusIssues(migrationStatus);
    const schemaIssues = classifySchemaIssues(status, schemaChecks);
    const ledgerIssues = ledger.issues || [];
    const recoveryRequired =
        migrationIssues.length > 0 ||
        schemaIssues.length > 0 ||
        ledgerIssues.length > 0;
    const hasPending = migrationStatus.pending.length > 0;

    let state = "ready";
    let code = "MIGRATION_DOCTOR_OK";
    let exitCode = DOCTOR_EXIT_CODES.READY;
    if (recoveryRequired) {
        state = "recovery_required";
        code = "MIGRATION_RECOVERY_REQUIRED";
        exitCode = DOCTOR_EXIT_CODES.RECOVERY_REQUIRED;
    } else if (hasPending) {
        state = "pending";
        code = "MIGRATIONS_PENDING";
        exitCode = DOCTOR_EXIT_CODES.PENDING;
    }

    const issues = [
        ...migrationIssues,
        ...ledgerIssues,
        ...schemaIssues,
        ...(hasPending
            ? [
                  {
                      code: "MIGRATIONS_PENDING",
                      migrationIds: migrationStatus.pending
                  }
              ]
            : [])
    ];

    return {
        database,
        state,
        code,
        exitCode,
        ready: state === "ready",
        recoveryRequired,
        summary: {
            applied: migrationStatus.applied.length,
            pending: migrationStatus.pending.length,
            dirty: migrationStatus.dirty.length,
            drift: migrationStatus.drift.length,
            unknown: migrationStatus.unknown.length,
            schemaIssues: schemaIssues.length,
            ledgerIssues: ledgerIssues.length
        },
        migrationStatus,
        ledger: {
            exists: ledger.exists,
            valid: ledger.valid,
            checks: (ledger.checks || []).map(publicSchemaCheck)
        },
        schemaChecks: schemaChecks.map(publicSchemaCheck),
        issues
    };
}

async function inspectLedger(helpers) {
    const exists = await helpers.tableExists("schema_migrations");
    if (!exists) {
        return {
            exists: false,
            valid: true,
            checks: [],
            issues: []
        };
    }

    const checks = await inspectSchemaContract(helpers, [
        { migrationId: null, checks: LEDGER_SCHEMA_CONTRACT }
    ]);
    const issues = checks
        .filter((check) => check.status !== "ok")
        .map(ledgerSchemaIssue);
    return {
        exists: true,
        valid: issues.length === 0,
        checks,
        issues
    };
}

function createMigrationDoctor({
    pool,
    migrations = loadMigrations(),
    schemaContract = MIGRATION_SCHEMA_CONTRACT,
    onQuery
}) {
    if (!pool) {
        throw new TypeError("Migration doctor requires a database pool.");
    }
    validateMigrationRegistry(migrations);
    validateContractCoverage(migrations, schemaContract);

    async function diagnose() {
        const connection = await promisePool(pool).getConnection();
        try {
            const readOnlyConnection = createSelectOnlyConnection(connection, onQuery);
            const helpers = createSchemaHelpers(readOnlyConnection);
            const database = await helpers.databaseName();
            const ledger = await inspectLedger(helpers);
            const store = createMigrationStore(readOnlyConnection, helpers);
            const records = ledger.valid ? await store.list() : [];
            const recordIssues = ledger.valid ? validateLedgerRecords(records) : [];
            if (recordIssues.length > 0) {
                ledger.valid = false;
                ledger.issues.push(...recordIssues);
            }
            const schemaChecks = await inspectSchemaContract(helpers, schemaContract);

            return buildDoctorReport({
                database,
                migrations,
                records,
                ledger,
                schemaChecks
            });
        } finally {
            connection.release();
        }
    }

    return { diagnose };
}

module.exports = {
    DOCTOR_EXIT_CODES,
    buildDoctorReport,
    classifySchemaIssues,
    createMigrationDoctor,
    createSelectOnlyConnection,
    doctorError,
    inspectSchemaContract,
    isSelectOnlyStatement,
    normalizeColumnType,
    normalizeDeleteRule,
    validateContractCoverage,
    validateLedgerRecords
};
