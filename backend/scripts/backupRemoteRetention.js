// Stage 2B2A remote retention: reuses the exact same GFS bucket-selection
// algorithm (7 daily / 4 weekly / 3 monthly buckets, plus the overall
// newest) that databaseBackupPolicy.js already uses for local automated
// backups, rather than re-implementing retention logic a second time.
// Planning is always a dry run; only applyRemoteRetention can delete
// anything, and only with three separate explicit confirmations plus a hard
// cap on how many objects may be removed in one call.
const { RETENTION_POLICY, selectRetentionBackups } = require("./databaseBackupPolicy");
const { readBackupRemoteConfig } = require("../config/backupRemoteConfig");
const { listRemoteBackups } = require("./encryptedBackupRemoteList");
const { createS3Client, deleteObject, getBucketVersioningStatus, remoteError } = require("./backupRemoteStorage");

// Adapts a remote inventory entry into the {manifest:{completedAt,
// artifact:{name}}} shape selectRetentionBackups() already expects, without
// changing that function at all.
function toRetentionCandidate(entry) {
    return {
        entry,
        manifest: {
            completedAt: entry.lastModified,
            artifact: { name: entry.key }
        }
    };
}

async function planRemoteRetention({ env = process.env } = {}) {
    const remoteConfig = readBackupRemoteConfig(env);
    const inventory = await listRemoteBackups({ env });
    const recognized = inventory.entries.filter((entry) => entry.recognized && entry.lastModified);
    const unrecognizedObjectsSkipped = inventory.entries.length - recognized.length;

    const candidates = recognized.map(toRetentionCandidate);
    const plan = selectRetentionBackups(candidates, RETENTION_POLICY);

    return {
        result: "ok",
        dryRun: true,
        bucket: remoteConfig.bucket,
        prefix: remoteConfig.prefix,
        policy: RETENTION_POLICY,
        keep: plan.keep.map((candidate) => candidate.entry.key),
        remove: plan.remove.map((candidate) => candidate.entry.key),
        unrecognizedObjectsSkipped
    };
}

function requiredExactMatch(env, name, expected) {
    if (env?.[name] !== expected) {
        throw remoteError(
            "REMOTE_RETENTION_NOT_AUTHORIZED",
            `${name} must exactly equal the configured value to authorize a remote retention deletion.`
        );
    }
}

async function applyRemoteRetention({ env = process.env } = {}) {
    const remoteConfig = readBackupRemoteConfig(env);
    if (env.BACKUP_REMOTE_RETENTION_APPLY !== "true") {
        throw remoteError(
            "REMOTE_RETENTION_NOT_AUTHORIZED",
            "BACKUP_REMOTE_RETENTION_APPLY must be exactly \"true\" to delete any remote object."
        );
    }
    requiredExactMatch(env, "FITTRACK_REMOTE_RETENTION_BUCKET_ACK", remoteConfig.bucket);
    requiredExactMatch(env, "FITTRACK_REMOTE_RETENTION_PREFIX_ACK", remoteConfig.prefix);

    const maxDelete = Number(env.FITTRACK_REMOTE_RETENTION_MAX_DELETE);
    if (!Number.isInteger(maxDelete) || maxDelete < 0) {
        throw remoteError(
            "REMOTE_RETENTION_NOT_AUTHORIZED",
            "FITTRACK_REMOTE_RETENTION_MAX_DELETE must be explicitly set to a non-negative integer."
        );
    }

    const plan = await planRemoteRetention({ env });
    if (plan.remove.length > maxDelete) {
        throw remoteError(
            "REMOTE_RETENTION_NOT_AUTHORIZED",
            `Retention plan would remove ${plan.remove.length} object(s), exceeding the authorized maximum of ${maxDelete}.`
        );
    }

    const client = createS3Client(remoteConfig);
    // Deleting an object on a versioned bucket creates a delete marker
    // rather than physically removing prior bytes - this is reported
    // honestly rather than claiming a permanent deletion the provider did
    // not actually perform. Permanent version purging is out of scope for
    // this phase (see docs/STAGE_2B2A_S3_OFFHOST_BACKUPS.md).
    const versioningStatus = await getBucketVersioningStatus({ client, remoteConfig });
    const deletionType = versioningStatus === "Enabled" ? "delete-marker" : "permanent";

    const deleted = [];
    const failed = [];
    for (const key of plan.remove) {
        try {
            await deleteObject({ client, remoteConfig, key });
            deleted.push(key);
        } catch (error) {
            failed.push({ key, error: error.message });
        }
    }
    if (failed.length > 0) {
        throw remoteError(
            "REMOTE_RETENTION_DELETE_FAILED",
            `${failed.length} object(s) could not be deleted during retention apply.`,
            { failed, deleted }
        );
    }

    return {
        result: "ok",
        dryRun: false,
        bucket: remoteConfig.bucket,
        prefix: remoteConfig.prefix,
        deletionType,
        deletedCount: deleted.length,
        deleted,
        kept: plan.keep
    };
}

module.exports = {
    applyRemoteRetention,
    planRemoteRetention,
    toRetentionCandidate
};
