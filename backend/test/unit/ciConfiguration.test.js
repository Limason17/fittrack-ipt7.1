const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { assertDestructiveTestTarget } = require("../../scripts/databaseSafety");

function readBackendCiDatabaseName() {
    const workflowPath = path.resolve(__dirname, "../../../.github/workflows/ci.yml");
    const workflow = fs.readFileSync(workflowPath, "utf8");
    const backendStart = workflow.indexOf("\n  backend:");
    const frontendStart = workflow.indexOf("\n  frontend:", backendStart);
    assert.notEqual(backendStart, -1, "CI workflow must contain a backend job");
    assert.notEqual(frontendStart, -1, "CI workflow must contain a frontend job after backend");

    const backendJob = workflow.slice(backendStart, frontendStart);
    const match = backendJob.match(/^\s+DB_NAME:\s*["']?([A-Za-z0-9_]+)["']?\s*$/m);
    assert.ok(match, "backend CI job must configure DB_NAME");
    return match[1];
}

test("backend CI reset target satisfies the destructive database guard", () => {
    const database = readBackendCiDatabaseName();
    assert.doesNotThrow(() =>
        assertDestructiveTestTarget(
            { host: "127.0.0.1", database },
            { NODE_ENV: "test", ALLOW_TEST_DB_RESET: "true" }
        )
    );
});
