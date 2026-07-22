// Stage 2B2A convenience composition: create a fresh Stage 2B1 encrypted
// backup, then upload it. Deliberately just glue - all the actual logic
// lives in encryptedBackupCreate.js and encryptedBackupRemoteUpload.js, so
// there is exactly one place each behavior is implemented.
const path = require("node:path");

const { createStructuredLogger } = require("../startup/logger");
const { backupCliExitCode } = require("./backupExitCodes");
const { createEncryptedBackup } = require("./encryptedBackupCreate");
const { uploadEncryptedBackup } = require("./encryptedBackupRemoteUpload");

async function createAndUploadEncryptedBackup({ env = process.env, now = new Date() } = {}) {
    const createReport = await createEncryptedBackup({ env, now });
    const filePath = path.join(path.resolve(env.BACKUP_OUTPUT_DIRECTORY), createReport.filename);
    const uploadReport = await uploadEncryptedBackup({
        env: { ...env, FITTRACK_BACKUP_REMOTE_FILE: filePath }
    });
    return {
        result: "ok",
        create: createReport,
        upload: uploadReport
    };
}

async function main() {
    const report = await createAndUploadEncryptedBackup();
    process.stdout.write(`${JSON.stringify(report)}\n`);
}

if (require.main === module) {
    main().catch((error) => {
        createStructuredLogger().error("remote_backup_create_upload_failed", { error });
        process.exitCode = backupCliExitCode(error);
    });
}

module.exports = {
    createAndUploadEncryptedBackup,
    main
};
