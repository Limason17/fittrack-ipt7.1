const SAFE_MIGRATION_ID = /^[A-Za-z0-9_-]{1,190}$/;
const SAFE_FAILURE_CODE = /^[A-Z0-9_:-]{1,64}$/;
const SAFE_CHECKSUM = /^[a-f0-9]{64}$/i;

function safeMigrationId(value) {
    const text = String(value || "");
    return SAFE_MIGRATION_ID.test(text) ? text : "[INVALID_MIGRATION_ID]";
}

function safeFailureCode(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }
    const text = String(value);
    return SAFE_FAILURE_CODE.test(text)
        ? text
        : "MIGRATION_FAILURE_CODE_INVALID";
}

function safeChecksum(value) {
    const text = String(value || "");
    return SAFE_CHECKSUM.test(text) ? text.toLowerCase() : null;
}

function isoTimestamp(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function safeStatus(value) {
    return ["applied", "running", "failed"].includes(value)
        ? value
        : "invalid";
}

function summarizeDirtyRecord(record) {
    return {
        migrationId: safeMigrationId(record?.id),
        status: safeStatus(record?.status),
        startedAt: isoTimestamp(record?.started_at),
        appliedAt: isoTimestamp(record?.applied_at),
        failureCode: safeFailureCode(record?.failure_code)
    };
}

function summarizeMigrationStatus(status) {
    return {
        applied: (status?.applied || []).map((item) => safeMigrationId(item.id)),
        pending: (status?.pending || []).map((item) => safeMigrationId(item.id)),
        dirty: (status?.dirty || []).map(summarizeDirtyRecord),
        drift: (status?.drift || []).map((item) => ({
            migrationId: safeMigrationId(item.id),
            expectedChecksum: safeChecksum(item.expectedChecksum),
            actualChecksum: safeChecksum(item.actualChecksum)
        })),
        unknown: (status?.unknown || []).map((item) => ({
            migrationId: safeMigrationId(item.id),
            status: safeStatus(item.status)
        }))
    };
}

module.exports = {
    isoTimestamp,
    safeChecksum,
    safeFailureCode,
    safeMigrationId,
    safeStatus,
    summarizeDirtyRecord,
    summarizeMigrationStatus
};
