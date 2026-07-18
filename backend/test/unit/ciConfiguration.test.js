const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { assertDestructiveTestTarget } = require("../../scripts/databaseSafety");

function readBackendCiConfiguration() {
    const workflowPath = path.resolve(__dirname, "../../../.github/workflows/ci.yml");
    const workflow = fs.readFileSync(workflowPath, "utf8");
    const backendStart = workflow.indexOf("\n  backend:");
    const frontendStart = workflow.indexOf("\n  frontend:", backendStart);
    assert.notEqual(backendStart, -1, "CI workflow must contain a backend job");
    assert.notEqual(frontendStart, -1, "CI workflow must contain a frontend job after backend");

    const backendJob = workflow.slice(backendStart, frontendStart);
    const databaseMatch = backendJob.match(
        /^\s+DB_NAME:\s*["']?([A-Za-z0-9_]+)["']?\s*$/m
    );
    const expectedMatch = backendJob.match(
        /^\s+FITTRACK_MIGRATION_EXPECTED_DATABASE:\s*["']?([A-Za-z0-9_]+)["']?\s*$/m
    );
    assert.ok(databaseMatch, "backend CI job must configure DB_NAME");
    assert.ok(
        expectedMatch,
        "backend CI job must explicitly confirm its migration database"
    );
    return {
        database: databaseMatch[1],
        expectedDatabase: expectedMatch[1]
    };
}

test("backend CI reset target satisfies the destructive database guard", () => {
    const { database } = readBackendCiConfiguration();
    assert.doesNotThrow(() =>
        assertDestructiveTestTarget(
            { host: "127.0.0.1", database },
            { NODE_ENV: "test", ALLOW_TEST_DB_RESET: "true" }
        )
    );
});

test("backend CI migration acknowledgement matches its disposable database", () => {
    const { database, expectedDatabase } = readBackendCiConfiguration();
    assert.equal(expectedDatabase, database);
});
