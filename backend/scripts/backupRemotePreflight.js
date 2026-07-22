// Read-only-by-intent bucket preflight for Stage 2B2A. Never creates or
// configures a bucket (that would be "unasked bucket creation" in
// production, explicitly forbidden) - it only confirms an already-existing
// bucket is reachable, not publicly exposed (as far as the provider can
// confirm), meets the configured versioning/Object Lock requirements, and
// is actually writable/readable/deletable at the exact configured prefix.
const crypto = require("node:crypto");
const { PutObjectCommand } = require("@aws-sdk/client-s3");

const { readBackupRemoteConfig } = require("../config/backupRemoteConfig");
const { createStructuredLogger } = require("../startup/logger");
const { backupCliExitCode } = require("./backupExitCodes");
const {
    createS3Client,
    deleteObject,
    getBucketVersioningStatus,
    getObjectLockStatus,
    getPublicAccessStatus,
    headBucket,
    headObject,
    remoteError,
    sendWithTimeout
} = require("./backupRemoteStorage");

async function writeProbeObject({ client, remoteConfig, key }) {
    const body = Buffer.from(`fittrack-preflight-probe ${new Date().toISOString()}\n`, "utf8");
    await sendWithTimeout(
        client,
        new PutObjectCommand({ Bucket: remoteConfig.bucket, Key: key, Body: body, ContentType: "text/plain" }),
        { timeoutMs: remoteConfig.operationTimeoutMs, context: "PutObject(preflight-probe)" }
    );
}

async function runRemoteBackupPreflight({ env = process.env } = {}) {
    const remoteConfig = readBackupRemoteConfig(env);
    const client = createS3Client(remoteConfig);

    await headBucket({ client, remoteConfig });

    const publicAccess = await getPublicAccessStatus({ client, remoteConfig });
    if (publicAccess === "not-fully-blocked") {
        throw remoteError(
            "REMOTE_BUCKET_NOT_PRIVATE",
            "The configured bucket does not confirm that public access is fully blocked."
        );
    }

    const versioningStatus = await getBucketVersioningStatus({ client, remoteConfig });
    if (remoteConfig.requireVersioning && versioningStatus !== "Enabled") {
        throw remoteError(
            "REMOTE_VERSIONING_REQUIRED",
            `BACKUP_S3_REQUIRE_VERSIONING=true but bucket versioning status is "${versioningStatus}".`
        );
    }

    const objectLockStatus = await getObjectLockStatus({ client, remoteConfig });
    if (remoteConfig.requireObjectLock && objectLockStatus !== "enabled") {
        throw remoteError(
            "REMOTE_OBJECT_LOCK_REQUIRED",
            `BACKUP_S3_REQUIRE_OBJECT_LOCK=true but the bucket does not confirm Object Lock is enabled (status: ${objectLockStatus}).`
        );
    }

    const probeKey = `${remoteConfig.prefix}/.fittrack-preflight-${crypto.randomBytes(8).toString("hex")}`;
    await writeProbeObject({ client, remoteConfig, key: probeKey });

    let headError;
    try {
        await headObject({ client, remoteConfig, key: probeKey });
    } catch (error) {
        headError = error;
    }
    let deleteError;
    try {
        await deleteObject({ client, remoteConfig, key: probeKey });
    } catch (error) {
        deleteError = error;
    }
    if (headError) throw headError;
    if (deleteError) {
        throw remoteError(
            "REMOTE_PREFLIGHT_CLEANUP_FAILED",
            "The preflight probe object could not be deleted after the read/write check succeeded.",
            { cause: deleteError }
        );
    }

    return {
        result: "ok",
        bucket: remoteConfig.bucket,
        region: remoteConfig.region,
        prefix: remoteConfig.prefix,
        endpoint: remoteConfig.endpoint,
        publicAccess,
        versioningStatus,
        objectLockStatus,
        readWriteDeleteVerified: true
    };
}

async function main() {
    const report = await runRemoteBackupPreflight();
    createStructuredLogger().info("remote_backup_preflight_succeeded", {
        bucket: report.bucket,
        region: report.region,
        prefix: report.prefix,
        versioningStatus: report.versioningStatus,
        objectLockStatus: report.objectLockStatus
    });
    process.stdout.write(`${JSON.stringify(report)}\n`);
}

if (require.main === module) {
    main().catch((error) => {
        createStructuredLogger().error("remote_backup_preflight_failed", { error });
        process.exitCode = backupCliExitCode(error);
    });
}

module.exports = {
    main,
    runRemoteBackupPreflight
};
