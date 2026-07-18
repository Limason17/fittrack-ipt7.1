const crypto = require("node:crypto");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const { spawn } = require("node:child_process");
const { pipeline } = require("node:stream/promises");

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

async function runDockerDatabaseTool({
    container,
    executable,
    toolArgs,
    password,
    input,
    output
}) {
    const interactive = Boolean(input);
    const args = buildDockerExecArgs({ container, executable, toolArgs, interactive });
    const child = spawn("docker", args, {
        env: { ...process.env, MYSQL_PWD: password },
        shell: false,
        windowsHide: true,
        stdio: [input ? "pipe" : "ignore", output ? "pipe" : "ignore", "pipe"]
    });

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
        if (stderr.length < 8192) {
            stderr += chunk;
        }
    });

    const streamTasks = [];
    if (input) {
        streamTasks.push(pipeline(input, child.stdin));
    }
    if (output) {
        streamTasks.push(pipeline(child.stdout, output));
    }

    const [exitCode] = await Promise.all([waitForChild(child), ...streamTasks]);
    if (exitCode !== 0) {
        throw toolError(
            "DATABASE_TOOL_FAILED",
            `${executable} exited with code ${exitCode}.`,
            { toolMessage: stderr.trim().slice(0, 2048) }
        );
    }
}

module.exports = {
    assertContainerName,
    buildDockerExecArgs,
    createBackupFilename,
    looksLikeLogicalBackup,
    runDockerDatabaseTool,
    sha256File,
    toolError,
    verifyLogicalBackupFile
};
