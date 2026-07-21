const crypto = require("node:crypto");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const path = require("node:path");
const { Writable } = require("node:stream");

const { readBackupCryptoConfig } = require("../config/backupCryptoConfig");
const { createStructuredLogger } = require("../startup/logger");
const { safetyError } = require("./databaseSafety");
const { backupCliExitCode } = require("./backupExitCodes");
const { readAndProcessEncryptedBackup } = require("./encryptedBackupStream");

// A discard sink that still hashes and counts every decompressed byte, so
// verification proves the full logical dump was read and is well-formed -
// a bare file hash of the ciphertext would not - without ever writing that
// plaintext to disk.
function hashingDiscardSink() {
    const hash = crypto.createHash("sha256");
    let bytes = 0;
    const sink = new Writable({
        write(chunk, encoding, callback) {
            hash.update(chunk);
            bytes += chunk.length;
            callback();
        }
    });
    return { sink, digest: () => hash.digest("hex"), byteCount: () => bytes };
}

async function resolveBackupFile(env) {
    const value = env.FITTRACK_BACKUP_VERIFY_FILE;
    if (typeof value !== "string" || !value.trim()) {
        throw safetyError(
            "BACKUP_FILE_REQUIRED",
            "FITTRACK_BACKUP_VERIFY_FILE must point to an existing .ftbackup file."
        );
    }
    const filePath = path.resolve(value.trim());
    if (path.extname(filePath).toLowerCase() !== ".ftbackup") {
        throw safetyError("BACKUP_FILE_INVALID", "Backup file must use the .ftbackup extension.");
    }
    await fsPromises.access(filePath, fs.constants.R_OK);
    return filePath;
}

async function verifyEncryptedBackup({ env = process.env } = {}) {
    const cryptoConfig = readBackupCryptoConfig(env);
    const filePath = await resolveBackupFile(env);
    const started = Date.now();
    const { sink, digest, byteCount } = hashingDiscardSink();

    const { header } = await readAndProcessEncryptedBackup({
        filePath,
        key: cryptoConfig.key,
        expectedKeyId: cryptoConfig.keyId,
        sink
    });

    return {
        result: "ok",
        filename: path.basename(filePath),
        formatVersion: header.formatVersion,
        keyId: header.keyId,
        createdAt: header.createdAt,
        database: header.database,
        migrationCount: header.schema?.migrationCount ?? 0,
        logicalBytes: byteCount(),
        logicalSha256: digest(),
        durationMs: Date.now() - started
    };
}

async function main() {
    const report = await verifyEncryptedBackup();
    process.stdout.write(`${JSON.stringify(report)}\n`);
}

if (require.main === module) {
    main().catch((error) => {
        createStructuredLogger().error("backup_verify_failed", { error });
        process.exitCode = backupCliExitCode(error);
    });
}

module.exports = {
    resolveBackupFile,
    main,
    verifyEncryptedBackup
};
