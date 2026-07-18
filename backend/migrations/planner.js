function migrationError(message) {
    const error = new Error(message);
    error.code = "INVALID_MIGRATION_REGISTRY";
    return error;
}

function validateMigrationRegistry(migrations) {
    if (!Array.isArray(migrations)) {
        throw migrationError("Migration registry must be an array.");
    }

    const seenIds = new Set();
    let previousId = "";

    migrations.forEach((migration) => {
        if (!migration || typeof migration !== "object") {
            throw migrationError("Every migration must be an object.");
        }

        if (!/^\d{3,}_[a-z0-9_]+$/.test(migration.id || "")) {
            throw migrationError(`Invalid migration id: ${migration.id || "<missing>"}`);
        }

        if (seenIds.has(migration.id)) {
            throw migrationError(`Duplicate migration id: ${migration.id}`);
        }

        if (previousId && migration.id.localeCompare(previousId) <= 0) {
            throw migrationError("Migrations must be sorted by id.");
        }

        if (!/^[a-f0-9]{64}$/i.test(migration.checksum || "")) {
            throw migrationError(`Invalid checksum for migration ${migration.id}.`);
        }

        if (typeof migration.up !== "function") {
            throw migrationError(`Migration ${migration.id} must export an up function.`);
        }

        seenIds.add(migration.id);
        previousId = migration.id;
    });

    return migrations;
}

function planMigrations(migrations, appliedRecords) {
    validateMigrationRegistry(migrations);

    const records = Array.isArray(appliedRecords) ? appliedRecords : [];
    const migrationById = new Map(migrations.map((migration) => [migration.id, migration]));
    const recordById = new Map(records.map((record) => [record.id, record]));

    const pending = migrations.filter((migration) => !recordById.has(migration.id));
    const dirty = records.filter((record) => record.status !== "applied");
    const unknown = records.filter((record) => !migrationById.has(record.id));
    const drift = records
        .filter((record) => migrationById.has(record.id))
        .filter((record) => migrationById.get(record.id).checksum !== record.checksum)
        .map((record) => ({
            id: record.id,
            expectedChecksum: migrationById.get(record.id).checksum,
            actualChecksum: record.checksum
        }));

    return {
        pending,
        dirty,
        drift,
        unknown,
        applied: records.filter((record) => record.status === "applied")
    };
}

function assertMigrationStatusReady(status) {
    const pending = status?.pending || [];
    const dirty = status?.dirty || [];
    const drift = status?.drift || [];
    const unknown = status?.unknown || [];

    if (pending.length || dirty.length || drift.length || unknown.length) {
        const error = new Error("Database migration status is not ready.");
        error.code = "MIGRATION_STATUS_NOT_READY";
        error.summary = {
            pending: pending.map((item) => item.id),
            dirty: dirty.map((item) => item.id),
            drift: drift.map((item) => item.id),
            unknown: unknown.map((item) => item.id)
        };
        throw error;
    }
}

module.exports = {
    assertMigrationStatusReady,
    planMigrations,
    validateMigrationRegistry
};
