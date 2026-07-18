const assert = require("node:assert/strict");
const test = require("node:test");

const { createMigrationRunner } = require("../../migrations/runner");

test("migration runner rejects an unexpected selected database before any DDL", async () => {
    const queries = [];
    let released = false;
    const connection = {
        async query(sql) {
            queries.push(sql);
            if (sql === "SELECT DATABASE() AS database_name") {
                return [[{ database_name: "fittrack_wrong" }]];
            }
            throw new Error(`Unexpected query after target mismatch: ${sql}`);
        },
        release() {
            released = true;
        }
    };
    const pool = {
        async getConnection() {
            return connection;
        }
    };
    const runner = createMigrationRunner({ pool, migrations: [] });

    await assert.rejects(
        runner.migrate({ expectedDatabase: "fittrack_expected" }),
        (error) =>
            error.code === "MIGRATION_TARGET_MISMATCH" &&
            error.expectedDatabase === "fittrack_expected" &&
            error.actualDatabase === "fittrack_wrong"
    );
    assert.deepEqual(queries, ["SELECT DATABASE() AS database_name"]);
    assert.equal(released, true);
});
