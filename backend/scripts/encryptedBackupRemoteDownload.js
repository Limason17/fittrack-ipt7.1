const path = require("node:path");

const { createStructuredLogger } = require("../startup/logger");
const { safetyError } = require("./databaseSafety");
const { backupCliExitCode } = require("./backupExitCodes");
const { fetchAndVerifyRemoteBackup } = require("./encryptedBackupRemoteFetch");

function requiredKey(env) {
    const value = env.FITTRACK_BACKUP_REMOTE_KEY;
    if (typeof value !== "string" || !value.trim()) {
        throw safetyError("REMOTE_OBJECT_KEY_INVALID", "FITTRACK_BACKUP_REMOTE_KEY must be explicitly set.");
    }
    return value.trim();
}

function requiredDownloadDirectory(env) {
    const value = env.FITTRACK_BACKUP_REMOTE_DOWNLOAD_DIR;
    if (typeof value !== "string" || !value.trim()) {
        throw safetyError(
            "BACKUP_LOCATION_REQUIRED",
            "FITTRACK_BACKUP_REMOTE_DOWNLOAD_DIR must point to a directory outside the repository."
        );
    }
    return path.resolve(value.trim());
}

async function downloadRemoteBackup({ env = process.env } = {}) {
    const key = requiredKey(env);
    const destinationDirectory = requiredDownloadDirectory(env);
    return fetchAndVerifyRemoteBackup({ env, key, destinationDirectory, keepFile: true });
}

async function main() {
    const report = await downloadRemoteBackup();
    createStructuredLogger().info("remote_backup_download_succeeded", {
        bucket: report.bucket,
        key: report.key,
        bytes: report.bytes
    });
    process.stdout.write(`${JSON.stringify(report)}\n`);
}

if (require.main === module) {
    main().catch((error) => {
        createStructuredLogger().error("remote_backup_download_failed", { error });
        process.exitCode = backupCliExitCode(error);
    });
}

module.exports = {
    downloadRemoteBackup,
    main
};
