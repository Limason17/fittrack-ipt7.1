// Stage 2B2A: uploads an already-created, already Stage-2B1-encrypted
// .ftbackup file to S3-compatible off-host storage. This command never
// creates a backup itself (see encryptedBackupRemoteCreateUpload.js for the
// create+upload composition) and never handles plaintext SQL - it only ever
// touches the already-authenticated ciphertext container.
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const path = require("node:path");

const { readBackupRemoteConfig } = require("../config/backupRemoteConfig");
const { createStructuredLogger } = require("../startup/logger");
const { safetyError, assertExternalBackupDirectory } = require("./databaseSafety");
const { backupCliExitCode } = require("./backupExitCodes");
const { sha256File } = require("./databaseTools");
const { verifyEncryptedBackup } = require("./encryptedBackupVerify");
const { buildRemoteObjectKey } = require("./backupRemoteObjectKey");
const {
    MAX_UPLOAD_BYTES,
    createS3Client,
    headObject,
    objectExists,
    remoteError,
    uploadObject
} = require("./backupRemoteStorage");

const REPOSITORY_ROOT = path.resolve(__dirname, "../..");

async function resolveUploadFile(env) {
    const value = env.FITTRACK_BACKUP_REMOTE_FILE;
    if (typeof value !== "string" || !value.trim()) {
        throw safetyError(
            "BACKUP_FILE_REQUIRED",
            "FITTRACK_BACKUP_REMOTE_FILE must point to an existing .ftbackup file."
        );
    }
    const filePath = path.resolve(value.trim());
    if (path.extname(filePath).toLowerCase() !== ".ftbackup") {
        throw safetyError("BACKUP_FILE_INVALID", "Remote upload input must be a .ftbackup file.");
    }
    await fsPromises.access(filePath, fs.constants.R_OK);
    // Reuses the same "must live outside the repository" guard as local
    // backup output - a .ftbackup file that somehow ended up inside the
    // repository must never be picked up for upload.
    assertExternalBackupDirectory(path.dirname(filePath), REPOSITORY_ROOT);
    return filePath;
}

async function uploadEncryptedBackup({ env = process.env } = {}) {
    const remoteConfig = readBackupRemoteConfig(env);
    const filePath = await resolveUploadFile(env);
    const started = Date.now();

    // Full Stage 2B1 verify - the exact same function the standalone
    // db:backup:verify command uses, pointed at this file. This is the
    // upload gate: GCM authentication, key-id match, and supported format
    // version are all enforced here before a single network byte is sent.
    const verifyReport = await verifyEncryptedBackup({
        env: { ...env, FITTRACK_BACKUP_VERIFY_FILE: filePath }
    });

    const stat = await fsPromises.stat(filePath);
    if (stat.size > MAX_UPLOAD_BYTES) {
        throw remoteError(
            "REMOTE_UPLOAD_SIZE_LIMIT_EXCEEDED",
            `Backup file (${stat.size} bytes) exceeds the documented remote upload limit of ${MAX_UPLOAD_BYTES} bytes.`
        );
    }
    const ciphertextSha256 = await sha256File(filePath);
    const createdAt = new Date(verifyReport.createdAt);
    const filename = path.basename(filePath);
    const key = buildRemoteObjectKey({ prefix: remoteConfig.prefix, filename, now: createdAt });

    const client = createS3Client(remoteConfig);

    if (await objectExists({ client, remoteConfig, key })) {
        throw remoteError(
            "REMOTE_OBJECT_ALREADY_EXISTS",
            "A remote object already exists at the computed key; uploads never overwrite an existing object."
        );
    }

    const logger = createStructuredLogger();
    logger.info("remote_backup_upload_started", { bucket: remoteConfig.bucket, key, bytes: stat.size });

    const metadataFields = {
        "format-version": String(verifyReport.formatVersion),
        "key-id": verifyReport.keyId,
        "created-at": verifyReport.createdAt,
        "ciphertext-sha256": ciphertextSha256,
        "source-database": verifyReport.database,
        application: "fittrack",
        "backup-type": "encrypted-logical"
    };

    await uploadObject({
        client,
        remoteConfig,
        key,
        body: fs.createReadStream(filePath),
        contentLength: stat.size,
        metadataFields
    });

    // A remote object only counts as "published" once a post-upload
    // HeadObject confirms its size and safe metadata actually match what
    // was intended - a successful multipart completion alone is not
    // sufficient proof.
    const head = await headObject({ client, remoteConfig, key });
    if (head.ContentLength !== stat.size) {
        throw remoteError(
            "REMOTE_METADATA_INCONSISTENT",
            "Uploaded object size does not match the local file after publish."
        );
    }
    if (
        head.Metadata?.["ciphertext-sha256"] !== ciphertextSha256 ||
        head.Metadata?.["key-id"] !== verifyReport.keyId
    ) {
        throw remoteError(
            "REMOTE_METADATA_INCONSISTENT",
            "Uploaded object metadata does not match the local backup after publish."
        );
    }

    const report = {
        result: "ok",
        bucket: remoteConfig.bucket,
        key,
        bytes: stat.size,
        ciphertextSha256,
        formatVersion: verifyReport.formatVersion,
        keyId: verifyReport.keyId,
        createdAt: verifyReport.createdAt,
        sourceDatabase: verifyReport.database,
        durationMs: Date.now() - started
    };
    logger.info("remote_backup_upload_succeeded", {
        bucket: report.bucket,
        key: report.key,
        bytes: report.bytes,
        durationMs: report.durationMs
    });
    return report;
}

async function main() {
    const report = await uploadEncryptedBackup();
    process.stdout.write(`${JSON.stringify(report)}\n`);
}

if (require.main === module) {
    main().catch((error) => {
        createStructuredLogger().error("remote_backup_upload_failed", { error });
        process.exitCode = backupCliExitCode(error);
    });
}

module.exports = {
    REPOSITORY_ROOT,
    main,
    resolveUploadFile,
    uploadEncryptedBackup
};
