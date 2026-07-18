const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("FT-03: the real process exits non-zero without listening when the DB is unavailable", () => {
    const secretMarker = "must-not-appear-in-logs";
    const result = spawnSync(process.execPath, ["server.js"], {
        cwd: path.resolve(__dirname, "../.."),
        env: {
            ...process.env,
            NODE_ENV: "test",
            PORT: "39876",
            DB_HOST: "127.0.0.1",
            DB_PORT: "1",
            DB_NAME: "fittrack_process_test_not_created",
            DB_USER: "test-user",
            DB_PASSWORD: secretMarker,
            DB_CONNECT_TIMEOUT_MS: "100",
            JWT_SECRET: "fittrack-stage-0a-process-test-secret-32-characters"
        },
        encoding: "utf8",
        timeout: 10_000,
        windowsHide: true
    });

    const output = `${result.stdout || ""}\n${result.stderr || ""}`;
    assert.equal(result.status, 1, output);
    assert.doesNotMatch(output, /startup_listening/);
    assert.doesNotMatch(output, new RegExp(secretMarker));
    assert.match(output, /process_start_failed/);
});

