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

async function runDockerDatabaseTool({
    container,
    executable,
    toolArgs,
    password,
    input,
    inputTransforms = [],
    output,
    outputTransforms = [],
    captureOutput = false
}) {
    if (output && captureOutput) {
        throw toolError(
            "DATABASE_TOOL_CONFIG_INVALID",
            "Database tool output cannot be streamed and captured at the same time."
        );
    }
    const interactive = Boolean(input);
    const args = buildDockerExecArgs({ container, executable, toolArgs, interactive });
    const child = spawn("docker", args, {
        env: { ...process.env, MYSQL_PWD: password },
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

    const [exitCode] = await Promise.all([waitForChild(child), ...streamTasks]);
    if (exitCode !== 0) {
        throw toolError(
            "DATABASE_TOOL_FAILED",
            `${executable} exited with code ${exitCode}.`,
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
