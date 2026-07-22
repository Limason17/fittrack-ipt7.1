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
    deleteObject,
    headObject,
    remoteError,
    uploadObject
} = require("./backupRemoteStorage");

const REPOSITORY_ROOT = path.resolve(__dirname, "../..");

// Decides, from already-fetched data only (no I/O here), whether a
// post-upload HeadObject matches what this exact upload just published, and
// whether the caller can *prove* ownership of whatever is currently at that
// key. Ownership is only provable when the bucket returned a versionId for
// our own write and the HeadObject we just read reports that same
// versionId - if either is missing (unversioned bucket) or they differ
// (someone else has since published a newer version at this key), ownership
// is not confirmed and nothing at the key may be touched.
function evaluatePublishConsistency({ uploadResult, head, expectedBytes, expectedCiphertextSha256, expectedKeyId }) {
    const ownershipConfirmed = Boolean(uploadResult.versionId) && head.VersionId === uploadResult.versionId;
    const sizeOk = head.ContentLength === expectedBytes;
    const metadataOk =
        head.Metadata?.["ciphertext-sha256"] === expectedCiphertextSha256 &&
        head.Metadata?.["key-id"] === expectedKeyId;
    return { consistent: sizeOk && metadataOk, ownershipConfirmed };
}

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
            "REMOTE_BACKUP_TOO_LARGE",
            `Backup file (${stat.size} bytes) exceeds the documented remote upload limit of ${MAX_UPLOAD_BYTES} bytes.`
        );
    }
    const ciphertextSha256 = await sha256File(filePath);
    const createdAt = new Date(verifyReport.createdAt);
    const filename = path.basename(filePath);
    const key = buildRemoteObjectKey({ prefix: remoteConfig.prefix, filename, now: createdAt });

    const client = createS3Client(remoteConfig);
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

    // Single atomically-conditional PutObject (IfNoneMatch: "*") - no
    // HeadObject pre-check. If an object already exists at this key
    // (created a microsecond or a year ago), the provider itself rejects
    // this write with 412 Precondition Failed, surfaced here as
    // REMOTE_OBJECT_ALREADY_EXISTS; the pre-existing object is never
    // touched. See backupRemoteStorage.js#uploadObject for the full
    // rationale and the empirical concurrency proof.
    const uploadResult = await uploadObject({
        client,
        remoteConfig,
        key,
        body: fs.createReadStream(filePath),
        contentLength: stat.size,
        metadataFields
    });

    // The PutObject call already proved this exact process published the
    // object (or the whole call would have thrown already) - this
    // HeadObject is a publish/metadata proof, not a second race-prone
    // check. A failure here does not mean "someone else has it" - it means
    // the publish state is now unknown and must not be guessed at.
    let head;
    try {
        head = await headObject({ client, remoteConfig, key });
    } catch (error) {
        throw remoteError(
            "REMOTE_PUBLISH_STATE_UNKNOWN",
            "The backup was uploaded, but its published state could not be confirmed afterward.",
            { cause: error, versionId: uploadResult.versionId }
        );
    }

    const { consistent, ownershipConfirmed } = evaluatePublishConsistency({
        uploadResult,
        head,
        expectedBytes: stat.size,
        expectedCiphertextSha256: ciphertextSha256,
        expectedKeyId: verifyReport.keyId
    });

    if (!consistent) {
        // Only ever remove what we can prove is the exact object/version
        // this call just created (a versioned bucket returning a matching
        // versionId) - an unversioned bucket, or a mismatched versionId
        // (someone else has since published a newer version at this key),
        // means ownership cannot be proven, and nothing is deleted.
        let cleanupPerformed = false;
        let cleanupError = null;
        if (ownershipConfirmed) {
            try {
                await deleteObject({ client, remoteConfig, key, versionId: uploadResult.versionId });
                cleanupPerformed = true;
            } catch (error) {
                cleanupError = error.message;
            }
        }
        logger.error("remote_backup_publish_inconsistent", {
            bucket: remoteConfig.bucket,
            key,
            ownershipConfirmed,
            cleanupPerformed,
            cleanupError
        });
        throw remoteError(
            "REMOTE_METADATA_INCONSISTENT",
            "Uploaded object does not match the local backup after publish.",
            { ownershipConfirmed, cleanupPerformed }
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
        versionId: uploadResult.versionId,
        durationMs: Date.now() - started
    };
    logger.info("remote_backup_upload_succeeded", {
        bucket: report.bucket,
        key: report.key,
        bytes: report.bytes,
        versionId: report.versionId,
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
    evaluatePublishConsistency,
    main,
    resolveUploadFile,
    uploadEncryptedBackup
};
