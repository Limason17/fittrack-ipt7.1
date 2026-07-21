const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
    assertDestructiveTestTarget,
    assertExternalBackupDirectory,
    assertRestoreAcknowledgement,
    assertRestoreTargetAvailability,
    assertRestoreTargetDatabase,
    isLoopbackHost,
    isSystemDatabaseName
} = require("../../scripts/databaseSafety");

test("database safety accepts loopback host spellings only", () => {
    assert.equal(isLoopbackHost("localhost"), true);
    assert.equal(isLoopbackHost("127.0.0.1"), true);
    assert.equal(isLoopbackHost("::1"), true);
    assert.equal(isLoopbackHost("db.internal.example"), false);
    assert.equal(isLoopbackHost("192.168.1.40"), false);
});

test("destructive database operations require an explicit local disposable target", () => {
    const env = {
        NODE_ENV: "test",
        ALLOW_TEST_DB_RESET: "true"
    };

    assert.doesNotThrow(() =>
        assertDestructiveTestTarget(
            { host: "127.0.0.1", database: "fittrack_restore_stage0b_primary" },
            env
        )
    );
    assert.doesNotThrow(() =>
        assertDestructiveTestTarget(
            { host: "localhost", database: "fittrack_e2e_stage0b" },
            env
        )
    );

    for (const config of [
        { host: "db.internal.example", database: "fittrack_restore_stage0b" },
        { host: "127.0.0.1", database: "fittrack" },
        { host: "127.0.0.1", database: "fittrack_production_test" },
        { host: "127.0.0.1", database: "customer_test" }
    ]) {
        assert.throws(
            () => assertDestructiveTestTarget(config, env),
            (error) => error.code === "TEST_DB_OPERATION_FORBIDDEN"
        );
    }

    assert.throws(
        () =>
            assertDestructiveTestTarget(
                { host: "127.0.0.1", database: "fittrack_test_stage0b" },
                { NODE_ENV: "development", ALLOW_TEST_DB_RESET: "true" }
            ),
        (error) => error.code === "TEST_DB_OPERATION_FORBIDDEN"
    );
});

test("restore additionally requires a deliberate acknowledgement", () => {
    assert.doesNotThrow(() =>
        assertRestoreAcknowledgement({
            FITTRACK_RESTORE_ACK: "restore-local-test-database"
        })
    );
    assert.throws(
        () => assertRestoreAcknowledgement({ FITTRACK_RESTORE_ACK: "yes" }),
        (error) => error.code === "TEST_DB_OPERATION_FORBIDDEN"
    );
});

test("system database names are recognized regardless of case", () => {
    for (const name of ["mysql", "MYSQL", "information_schema", "Information_Schema", "performance_schema", "sys", "SYS"]) {
        assert.equal(isSystemDatabaseName(name), true, `expected ${name} to be a system database`);
    }
    assert.equal(isSystemDatabaseName("fittrack_restore_stage2b1_ab12cd"), false);
    assert.equal(isSystemDatabaseName(""), false);
    assert.equal(isSystemDatabaseName(undefined), false);
});

test("an encrypted-backup restore target must match the disposable naming pattern", () => {
    assert.equal(
        assertRestoreTargetDatabase("fittrack_restore_stage2b1_ab12cd", { sourceDatabase: "fittrack" }),
        "fittrack_restore_stage2b1_ab12cd"
    );
    for (const invalid of ["fittrack", "fittrack_production", "customer_test", "not_fittrack_test", ""]) {
        assert.throws(
            () => assertRestoreTargetDatabase(invalid, { sourceDatabase: "fittrack" }),
            (error) => error.code === "RESTORE_TARGET_INVALID",
            `expected rejection for target: ${invalid}`
        );
    }
});

test("a restore target must never be a MySQL system database (none of them match the disposable naming pattern either, so both guards independently reject them)", () => {
    for (const name of ["mysql", "information_schema", "performance_schema", "sys"]) {
        assert.throws(
            () => assertRestoreTargetDatabase(name, { sourceDatabase: "fittrack" }),
            (error) => error.code === "RESTORE_TARGET_INVALID" || error.code === "RESTORE_TARGET_FORBIDDEN",
            `expected system database ${name} to be rejected`
        );
    }
});

test("a restore target must never equal the backup's own source database, case-insensitively", () => {
    assert.throws(
        () => assertRestoreTargetDatabase("fittrack_restore_x", { sourceDatabase: "fittrack_restore_x" }),
        (error) => error.code === "RESTORE_TARGET_IS_SOURCE"
    );
    assert.throws(
        () => assertRestoreTargetDatabase("fittrack_restore_X", { sourceDatabase: "FITTRACK_RESTORE_X" }),
        (error) => error.code === "RESTORE_TARGET_IS_SOURCE"
    );
    assert.doesNotThrow(() =>
        assertRestoreTargetDatabase("fittrack_restore_x", { sourceDatabase: "fittrack" })
    );
});

test("a restore never silently overwrites an existing target database", () => {
    assert.doesNotThrow(() => assertRestoreTargetAvailability({ exists: false, allowRecreateAck: undefined }));
    assert.throws(
        () => assertRestoreTargetAvailability({ exists: true, allowRecreateAck: undefined }),
        (error) => error.code === "RESTORE_TARGET_ALREADY_EXISTS"
    );
    assert.throws(
        () => assertRestoreTargetAvailability({ exists: true, allowRecreateAck: "yes-please" }),
        (error) => error.code === "RESTORE_TARGET_ALREADY_EXISTS"
    );
    assert.doesNotThrow(() =>
        assertRestoreTargetAvailability({
            exists: true,
            allowRecreateAck: "recreate-disposable-restore-target"
        })
    );
});

test("backup targets must resolve outside the repository", () => {
    const repository = path.resolve("C:/workspace/fittrack");
    assert.equal(
        assertExternalBackupDirectory("C:/backups/fittrack", repository),
        path.resolve("C:/backups/fittrack")
    );
    assert.throws(
        () => assertExternalBackupDirectory("C:/workspace/fittrack/backups", repository),
        (error) => error.code === "BACKUP_LOCATION_FORBIDDEN"
    );
    assert.throws(
        () => assertExternalBackupDirectory("C:/workspace/fittrack", repository),
        (error) => error.code === "BACKUP_LOCATION_FORBIDDEN"
    );
});
