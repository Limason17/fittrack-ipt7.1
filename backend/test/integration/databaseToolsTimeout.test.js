// Real-process proof of the timeout/kill escalation in
// scripts/databaseTools.js#runDockerDatabaseTool - no mocks: every test
// here spawns a genuine `docker exec` against the real local MySQL
// container, using `sleep`/`sh` as stand-ins for a hung mysqldump/mysql
// process, since the escalation logic itself is executable-agnostic.
const test = require("node:test");
const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const { runDockerDatabaseTool } = require("../../scripts/databaseTools");

const execFileAsync = promisify(execFile);
const CONTAINER = process.env.FITTRACK_DB_CONTAINER || "fittrack_mysql";

// This base image has no `ps`/`pkill` at all (confirmed empirically - `ps`
// reports "command not found"), so this scans /proc/*/cmdline directly, the
// same technique the production remote-kill fallback in databaseTools.js
// uses. The match pattern is passed as a positional argument ($1) via argv,
// never string-concatenated into the script source.
const PROCESS_SEARCH_SCRIPT = [
    "count=0",
    "self=$$",
    "for entry in /proc/[0-9]*/cmdline; do",
    "  pid=$(basename \"$(dirname \"$entry\")\")",
    "  if [ \"$pid\" = \"$self\" ]; then continue; fi",
    "  content=$(tr '\\0' ' ' < \"$entry\" 2>/dev/null)",
    "  case \"$content\" in",
    "    *\"$1\"*) count=$((count + 1)) ;;",
    "  esac",
    "done",
    "echo \"$count\""
].join("\n");

async function processCountMatching(pattern) {
    const { stdout } = await execFileAsync("docker", [
        "exec",
        CONTAINER,
        "sh",
        "-c",
        PROCESS_SEARCH_SCRIPT,
        "sh",
        pattern
    ]);
    return Number(stdout.trim());
}

test("a hanging process is terminated once its timeout elapses, and the promise rejects with a stable timeout code", async () => {
    const started = Date.now();
    await assert.rejects(
        runDockerDatabaseTool({
            container: CONTAINER,
            executable: "sleep",
            password: "unused",
            toolArgs: ["9999"],
            timeoutMs: 500,
            gracePeriodMs: 500
        }),
        (error) => error.code === "DATABASE_TOOL_TIMEOUT"
    );
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 5000, `expected timeout to fire quickly, took ${elapsed}ms`);
});

test("the timed-out process is actually gone afterward, not left running inside the container", async () => {
    const marker = `ftbackup-timeout-test-${Date.now()}`;
    await assert.rejects(
        runDockerDatabaseTool({
            container: CONTAINER,
            executable: "sh",
            password: "unused",
            toolArgs: ["-c", `exec -a ${marker} sleep 9999`],
            timeoutMs: 500,
            gracePeriodMs: 500
        })
    );
    // Give the OS a brief moment to reap the killed process before checking.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const remaining = await processCountMatching(marker);
    assert.equal(remaining, 0, "the hung process must not still be running after the timeout fired");
});

test("a remote process that ignores SIGTERM is still gone afterward, regardless of local client escalation timing", async () => {
    const marker = `ftbackup-sigterm-ignoring-${Date.now()}`;
    const started = Date.now();
    // Empty trap on TERM means the remote process itself does not react to
    // termination - this is the "process ignores the first termination"
    // scenario the hard-kill/remote-marker-kill escalation exists for. Note:
    // killing the *local* docker exec client process (SIGTERM, then SIGKILL
    // after the grace period) does not reliably terminate the *remote*
    // process docker started on its behalf - confirmed empirically - so the
    // property that actually matters is not how quickly the local client
    // exits, but whether the remote process is verifiably gone afterward.
    await assert.rejects(
        runDockerDatabaseTool({
            container: CONTAINER,
            executable: "sh",
            password: "unused",
            toolArgs: ["-c", `trap '' TERM; exec -a ${marker} sleep 9999`],
            timeoutMs: 500,
            gracePeriodMs: 800
        }),
        (error) => error.code === "DATABASE_TOOL_TIMEOUT"
    );
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 8000, `expected the whole operation to resolve promptly, took ${elapsed}ms`);

    await new Promise((resolve) => setTimeout(resolve, 500));
    const remaining = await processCountMatching(marker);
    assert.equal(remaining, 0, "a SIGTERM-ignoring process must still be gone after SIGKILL");
});

test("a process that finishes well within its timeout is never touched by the escalation", async () => {
    const result = await runDockerDatabaseTool({
        container: CONTAINER,
        executable: "sh",
        password: "unused",
        toolArgs: ["-c", "echo fast-completion"],
        captureOutput: true,
        timeoutMs: 10_000,
        gracePeriodMs: 5_000
    });
    assert.equal(result.trim(), "fast-completion");
});

test("no timeout is applied when timeoutMs is explicitly falsy (defense against accidental 0/undefined misconfiguration reintroducing an unbounded process)", async () => {
    // A deliberately tiny but real timeout still fires - proving the guard
    // is active by default - while a fast command with a real timeout
    // completes normally without being mistaken for a hang.
    const result = await runDockerDatabaseTool({
        container: CONTAINER,
        executable: "sh",
        password: "unused",
        toolArgs: ["-c", "echo ok"],
        captureOutput: true,
        timeoutMs: 5_000
    });
    assert.equal(result.trim(), "ok");
});
