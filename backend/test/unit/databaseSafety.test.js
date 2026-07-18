const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
    assertDestructiveTestTarget,
    assertExternalBackupDirectory,
    assertRestoreAcknowledgement,
    isLoopbackHost
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
