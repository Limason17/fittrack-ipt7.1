const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
    assertMigrationStatusReady,
    planMigrations,
    validateMigrationRegistry
} = require("../migrations/planner");
const { checksum, loadMigrations } = require("../migrations/loader");

function migration(id, checksum = crypto.createHash("sha256").update(id).digest("hex")) {
    return {
        id,
        checksum,
        description: id,
        async up() {}
    };
}

test("Migration Registry lehnt doppelte und unsortierte IDs vor Ausführung ab", () => {
    assert.throws(
        () => validateMigrationRegistry([migration("002_b"), migration("001_a")]),
        (error) => error.code === "INVALID_MIGRATION_REGISTRY"
    );
    assert.throws(
        () => validateMigrationRegistry([migration("001_a"), migration("001_a")]),
        (error) => error.code === "INVALID_MIGRATION_REGISTRY"
    );
});

test("dateibasierte Registry entdeckt alle Migrationen in stabiler Reihenfolge", () => {
    const migrations = loadMigrations();
    assert.deepEqual(
        migrations.map((item) => item.id),
        [
            "001_initial_schema",
            "002_legacy_schema_upgrade",
            "003_seed_global_exercises",
            "004_training_history_consistency",
            "005_studio_tenancy_and_rbac",
            "006_coach_member_training",
            "007_studio_workout_execution",
            "008_studio_workout_session_feedback"
        ]
    );
    assert.ok(migrations.every((item) => /^[a-f0-9]{64}$/.test(item.checksum)));
});

test("Migrationsprüfsummen sind unabhängig von Windows- und Unix-Zeilenenden", () => {
    const unixSource = "module.exports = {\n  id: \"001_example\"\n};\n";
    const windowsSource = unixSource.replace(/\n/g, "\r\n");

    assert.equal(checksum(windowsSource), checksum(unixSource));
    assert.equal(checksum(Buffer.from(windowsSource, "utf8")), checksum(unixSource));
});

test("vollständig angewandte Registry ist ein No-op", () => {
    const migrations = [migration("001_a"), migration("002_b")];
    const status = planMigrations(migrations, [
        { id: "001_a", checksum: migrations[0].checksum, status: "applied" },
        { id: "002_b", checksum: migrations[1].checksum, status: "applied" }
    ]);

    assert.deepEqual(status.pending, []);
    assert.deepEqual(status.dirty, []);
    assert.deepEqual(status.drift, []);
    assert.deepEqual(status.unknown, []);
    assert.doesNotThrow(() => assertMigrationStatusReady(status));
});

test("pending, dirty, checksum drift und DB-ahead werden getrennt erkannt", () => {
    const migrations = [migration("001_a"), migration("002_b")];
    const status = planMigrations(migrations, [
        { id: "001_a", checksum: "0".repeat(64), status: "applied" },
        { id: "900_unknown", checksum: "1".repeat(64), status: "applied" },
        { id: "901_dirty", checksum: "2".repeat(64), status: "failed" }
    ]);

    assert.deepEqual(status.pending.map((item) => item.id), ["002_b"]);
    assert.deepEqual(status.drift.map((item) => item.id), ["001_a"]);
    assert.deepEqual(status.unknown.map((item) => item.id), ["900_unknown", "901_dirty"]);
    assert.deepEqual(status.dirty.map((item) => item.id), ["901_dirty"]);
    assert.throws(
        () => assertMigrationStatusReady(status),
        (error) => error.code === "MIGRATION_STATUS_NOT_READY"
    );
});
