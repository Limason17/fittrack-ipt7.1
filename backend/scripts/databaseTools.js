const crypto = require("node:crypto");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const { spawn } = require("node:child_process");
const { Writable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const zlib = require("node:zlib");

function toolError(code, message, details = {}) {
    const error = new Error(message);
    error.code = code;
    Object.assign(error, details);
    return error;
}

function assertContainerName(container) {
    if (!/^[A-Za-z0-9_.-]+$/.test(container || "")) {
        throw toolError("DATABASE_TOOL_CONFIG_INVALID", "Invalid Docker container name.");
    }
    return container;
}

function buildDockerExecArgs({ container, executable, toolArgs = [], interactive = false }) {
    assertContainerName(container);
    if (!/^[a-z0-9_-]+$/i.test(executable || "")) {
        throw toolError("DATABASE_TOOL_CONFIG_INVALID", "Invalid database tool name.");
    }

    return [
        "exec",
        ...(interactive ? ["--interactive"] : []),
        "--env",
        "MYSQL_PWD",
        "--env",
        "FTBACKUP_OP_ID",
        container,
        executable,
        ...toolArgs
    ];
}

function createBackupFilename(database, date = new Date()) {
    if (!/^[A-Za-z0-9_$-]+$/.test(database || "")) {
        throw toolError("DATABASE_TOOL_CONFIG_INVALID", "Invalid backup database name.");
    }
    const timestamp = date
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}Z$/, "Z");
    return `${database}-${timestamp}.sql`;
}

function looksLikeLogicalBackup(content) {
    const source = String(content || "");
    return /-- MySQL dump/i.test(source) && /CREATE TABLE\s+`[^`]+`/i.test(source);
}

async function sha256File(filename) {
    const digest = crypto.createHash("sha256");
    await pipeline(fs.createReadStream(filename), digest);
    return digest.digest("hex");
}

async function compressLogicalBackupFile(source, destination) {
    const output = fs.createWriteStream(destination, { flags: "wx", mode: 0o600 });
    try {
        await pipeline(
            fs.createReadStream(source),
            zlib.createGzip({ level: zlib.constants.Z_DEFAULT_COMPRESSION }),
            output
        );
        const stat = await fsPromises.stat(destination);
        return {
            bytes: stat.size,
            sha256: await sha256File(destination)
        };
    } catch (error) {
        output.destroy();
        await fsPromises.rm(destination, { force: true });
        throw error;
    }
}

function normalizedSha256(value) {
    const normalized = String(value || "").toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(normalized)) {
        throw toolError("BACKUP_INTEGRITY_FAILED", "Backup SHA-256 metadata is invalid.");
    }
    return normalized;
}

async function verifyGzipLogicalBackupFile(filename, expected = {}) {
    const stat = await fsPromises.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 32) {
        throw toolError("BACKUP_INTEGRITY_FAILED", "Compressed backup is missing or invalid.");
    }
    if (expected.bytes !== undefined && stat.size !== expected.bytes) {
        throw toolError("BACKUP_INTEGRITY_FAILED", "Compressed backup size does not match its manifest.");
    }

    const compressedSha256 = await sha256File(filename);
    if (
        expected.sha256 !== undefined &&
        compressedSha256 !== normalizedSha256(expected.sha256)
    ) {
        throw toolError("BACKUP_INTEGRITY_FAILED", "Compressed backup hash does not match its manifest.");
    }

    const digest = crypto.createHash("sha256");
    const headerChunks = [];
    let headerBytes = 0;
    let logicalBytes = 0;
    const maximumHeaderBytes = 128 * 1024;
    const expectedLogicalBytes = expected.logicalBytes;
    const sink = new Writable({
        write(chunk, encoding, callback) {
            logicalBytes += chunk.length;
            if (expectedLogicalBytes !== undefined && logicalBytes > expectedLogicalBytes) {
                callback(
                    toolError(
                        "BACKUP_INTEGRITY_FAILED",
                        "Expanded backup exceeds the size declared by its manifest."
                    )
                );
                return;
            }
            digest.update(chunk);
            if (headerBytes < maximumHeaderBytes) {
                const remaining = maximumHeaderBytes - headerBytes;
                const portion = chunk.subarray(0, remaining);
                headerChunks.push(portion);
                headerBytes += portion.length;
            }
            callback();
        }
    });

    try {
        await pipeline(fs.createReadStream(filename), zlib.createGunzip(), sink);
    } catch (error) {
        if (error?.code === "BACKUP_INTEGRITY_FAILED") throw error;
        throw toolError("BACKUP_INTEGRITY_FAILED", "Compressed backup could not be decoded.", {
            cause: error
        });
    }

    if (logicalBytes < 256) {
        throw toolError("BACKUP_INTEGRITY_FAILED", "Expanded logical backup is incomplete.");
    }
    if (!looksLikeLogicalBackup(Buffer.concat(headerChunks).toString("utf8"))) {
        throw toolError(
            "BACKUP_INTEGRITY_FAILED",
            "Expanded backup header or table definitions are missing."
        );
    }

    const logicalSha256 = digest.digest("hex");
    if (expectedLogicalBytes !== undefined && logicalBytes !== expectedLogicalBytes) {
        throw toolError("BACKUP_INTEGRITY_FAILED", "Expanded backup size does not match its manifest.");
    }
    if (
        expected.logicalSha256 !== undefined &&
        logicalSha256 !== normalizedSha256(expected.logicalSha256)
    ) {
        throw toolError("BACKUP_INTEGRITY_FAILED", "Expanded backup hash does not match its manifest.");
    }

    return {
        bytes: stat.size,
        sha256: compressedSha256,
        logicalBytes,
        logicalSha256
    };
}

async function verifyLogicalBackupFile(filename) {
    const stat = await fsPromises.stat(filename);
    if (!stat.isFile() || stat.size < 256) {
        throw toolError("BACKUP_VERIFICATION_FAILED", "Logical backup is empty or incomplete.");
    }

    const handle = await fsPromises.open(filename, "r");
    try {
        const buffer = Buffer.alloc(Math.min(stat.size, 128 * 1024));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (!looksLikeLogicalBackup(buffer.subarray(0, bytesRead).toString("utf8"))) {
            throw toolError(
                "BACKUP_VERIFICATION_FAILED",
                "Logical backup header or table definitions are missing."
            );
        }
    } finally {
        await handle.close();
    }

    return {
        bytes: stat.size,
        sha256: await sha256File(filename)
    };
}

async function waitForChild(child) {
    return new Promise((resolve, reject) => {
        child.once("error", (cause) => {
            reject(
                toolError("DATABASE_TOOL_UNAVAILABLE", "Could not start Docker database tool.", {
                    cause
                })
            );
        });
        child.once("close", (exitCode) => resolve(exitCode));
    });
}

const DEFAULT_TIMEOUT_MS = 600_000; // 10 minutes - only used if a caller omits timeoutMs entirely
const DEFAULT_GRACE_PERIOD_MS = 5_000;

// Returns both the promise and a way to cancel its underlying timer.
// Promise.race never cancels the "losing" side on its own, so a plain
// setTimeout-backed delay left unmanaged keeps running - and keeps the
// process alive - for the rest of its full duration even after the race
// has already been decided the other way. Every call site below must
// cancel its delay once the race settles, whichever side won.
function delay(ms) {
    let timer;
    const promise = new Promise((resolve) => {
        timer = setTimeout(resolve, ms);
    });
    return { promise, cancel: () => clearTimeout(timer) };
}

// Empirically, killing the *local* `docker exec` client process (via
// child.kill()) does not reliably terminate the *remote* process docker
// started on its behalf inside the container - confirmed by deliberately
// hanging a process and observing it still listed in `docker top` well
// after the local client had exited. This is a fixed, hardcoded shell
// script; the only variable data (the operation id) is passed as a
// positional argument ($1) via argv, never string-concatenated into the
// script source, so this stays free of shell-injection risk despite using
// `sh -c`. It scans /proc/*/environ for the marker this operation's
// exec session was given (see buildDockerExecArgs's "--env FTBACKUP_OP_ID",
// forwarded from this process's own env below) and kills any match
// directly, inside the container's own PID namespace.
const REMOTE_KILL_BY_MARKER_SCRIPT = [
    "for entry in /proc/[0-9]*/environ; do",
    "  pid=$(basename \"$(dirname \"$entry\")\")",
    "  if tr '\\0' '\\n' < \"$entry\" 2>/dev/null | grep -qxF \"FTBACKUP_OP_ID=$1\"; then",
    "    kill -9 \"$pid\" 2>/dev/null",
    "  fi",
    "done"
].join("\n");

async function killRemoteProcessByMarker(container, operationId, timeoutMs) {
    try {
        await runDockerDatabaseTool({
            container,
            executable: "sh",
            password: "",
            toolArgs: ["-c", REMOTE_KILL_BY_MARKER_SCRIPT, "sh", operationId],
            timeoutMs,
            // Prevents unbounded recursion: if this cleanup call itself
            // times out (e.g. the container becomes unresponsive), it must
            // not attempt yet another remote-kill-by-marker cleanup of
            // itself. A plain local kill is enough for this bounded,
            // best-effort helper - it never needs its own escalation chain.
            isCleanupOperation: true
        });
    } catch {
        // Best-effort cleanup only - the caller already treats the
        // original operation as timed out regardless of whether this
        // secondary cleanup step itself fully succeeds.
    }
}

const DEFAULT_DOCKER_OPERATION_TIMEOUT_MS = 15_000;

async function runDockerDatabaseTool({
    container,
    executable,
    toolArgs,
    password,
    input,
    inputTransforms = [],
    output,
    outputTransforms = [],
    captureOutput = false,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    gracePeriodMs = DEFAULT_GRACE_PERIOD_MS,
    dockerOperationTimeoutMs = DEFAULT_DOCKER_OPERATION_TIMEOUT_MS,
    isCleanupOperation = false
}) {
    if (output && captureOutput) {
        throw toolError(
            "DATABASE_TOOL_CONFIG_INVALID",
            "Database tool output cannot be streamed and captured at the same time."
        );
    }
    const interactive = Boolean(input);
    const args = buildDockerExecArgs({ container, executable, toolArgs, interactive });
    const operationId = crypto.randomBytes(16).toString("hex");
    const child = spawn("docker", args, {
        env: { ...process.env, MYSQL_PWD: password, FTBACKUP_OP_ID: operationId },
        shell: false,
        windowsHide: true,
        stdio: [
            input ? "pipe" : "ignore",
            output || captureOutput ? "pipe" : "ignore",
            "pipe"
        ]
    });

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
        if (stderr.length < 8192) {
            stderr += chunk;
        }
    });

    let stdout = "";
    if (captureOutput) {
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
            if (stdout.length < 8192) stdout += chunk;
        });
    }

    const streamTasks = [];
    if (input) {
        streamTasks.push(pipeline(input, ...inputTransforms, child.stdin));
    }
    if (output) {
        streamTasks.push(pipeline(child.stdout, ...outputTransforms, output));
    }

    // Never lets Promise.all's rejection propagate unhandled if a timeout
    // wins the race below - both outcomes settle into a plain object here.
    const mainOperation = Promise.all([waitForChild(child), ...streamTasks]).then(
        ([exitCode]) => ({ type: "done", exitCode }),
        (error) => ({ type: "error", error })
    );

    const timeoutDelay = timeoutMs ? delay(timeoutMs) : null;
    const outcome = timeoutDelay
        ? await Promise.race([mainOperation, timeoutDelay.promise.then(() => ({ type: "timeout" }))])
        : await mainOperation;
    timeoutDelay?.cancel();

    if (outcome.type === "timeout") {
        // Controlled termination first (Windows note: child.kill("SIGTERM")
        // is not a real signal there - Node maps it to unconditional
        // termination, so there is no true "graceful" phase on that
        // platform; the grace-period/hard-kill escalation below is a
        // deliberate no-op on Windows but remains harmless and keeps this
        // code path identical on both platforms), then a hard kill if the
        // local client is still running after the grace period, then a
        // direct, targeted kill of the *remote* process regardless of
        // whether the local client responded - see killRemoteProcessByMarker.
        child.kill("SIGTERM");
        const graceDelay = delay(gracePeriodMs);
        const closed = await Promise.race([
            new Promise((resolve) => child.once("close", () => resolve(true))),
            graceDelay.promise.then(() => false)
        ]);
        graceDelay.cancel();
        if (!closed) {
            child.kill("SIGKILL");
        }
        if (!isCleanupOperation) {
            await killRemoteProcessByMarker(container, operationId, dockerOperationTimeoutMs);
        }
        throw toolError(
            "DATABASE_TOOL_TIMEOUT",
            `${executable} did not complete within its configured timeout and was terminated.`
        );
    }

    if (outcome.type === "error") {
        throw outcome.error;
    }

    if (outcome.exitCode !== 0) {
        throw toolError(
            "DATABASE_TOOL_FAILED",
            `${executable} exited with code ${outcome.exitCode}.`,
            { toolMessage: stderr.trim().slice(0, 2048) }
        );
    }
    return captureOutput ? stdout.slice(0, 8192) : undefined;
}

module.exports = {
    assertContainerName,
    buildDockerExecArgs,
    compressLogicalBackupFile,
    createBackupFilename,
    looksLikeLogicalBackup,
    runDockerDatabaseTool,
    sha256File,
    toolError,
    verifyGzipLogicalBackupFile,
    verifyLogicalBackupFile
};
