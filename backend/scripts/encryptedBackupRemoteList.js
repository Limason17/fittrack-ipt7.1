// Stage 2B2A remote inventory: lists every object under the configured
// prefix (fully paginated) and annotates each recognized FitTrack
// .ftbackup object with its safe metadata. Never deletes anything - an
// unrecognized object is reported, never removed, so an operator always
// sees exactly what is really in the prefix.
const { readBackupRemoteConfig } = require("../config/backupRemoteConfig");
const { createStructuredLogger } = require("../startup/logger");
const { backupCliExitCode } = require("./backupExitCodes");
const { BACKUP_FILENAME_PATTERN } = require("./backupRemoteObjectKey");
const { createS3Client, headObject, listAllObjects } = require("./backupRemoteStorage");

// Only a key of the exact shape <prefix>/<year>/<month>/<filename>.ftbackup
// is treated as a recognized FitTrack backup object - anything else
// (foreign files, renamed copies, partial uploads a provider left behind)
// is still listed, but flagged, and never assumed to be safe to touch.
function classifyObjectKey(prefix, key) {
    const relative = key.slice(prefix.length + 1);
    const segments = relative.split("/");
    if (segments.length !== 3) return { recognized: false };
    const [year, month, filename] = segments;
    if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || !BACKUP_FILENAME_PATTERN.test(filename)) {
        return { recognized: false };
    }
    return { recognized: true, filename };
}

async function fetchSafeMetadata({ client, remoteConfig, key }) {
    try {
        const head = await headObject({ client, remoteConfig, key });
        return {
            formatVersion: head.Metadata?.["format-version"] ?? null,
            keyId: head.Metadata?.["key-id"] ?? null,
            ciphertextSha256: head.Metadata?.["ciphertext-sha256"] ?? null,
            metadataAvailable: true
        };
    } catch {
        return { formatVersion: null, keyId: null, ciphertextSha256: null, metadataAvailable: false };
    }
}

async function listRemoteBackups({ env = process.env, pageSize } = {}) {
    const remoteConfig = readBackupRemoteConfig(env);
    const client = createS3Client(remoteConfig);
    const { objects, truncatedForSafety } = await listAllObjects({
        client,
        remoteConfig,
        ...(pageSize ? { pageSize } : {})
    });

    const entries = [];
    for (const object of objects) {
        const classification = classifyObjectKey(remoteConfig.prefix, object.Key);
        const base = {
            key: object.Key,
            bytes: object.Size,
            lastModified: object.LastModified instanceof Date ? object.LastModified.toISOString() : null,
            // ETag is a technical, provider-specific value (for a
            // multipart-uploaded object it is not even a plain MD5) - it is
            // surfaced for operational cross-referencing only, never as
            // proof of integrity. Ciphertext-sha256 metadata is the actual
            // integrity value.
            etag: object.ETag ?? null,
            storageClass: object.StorageClass ?? null,
            versionId: object.VersionId ?? null,
            recognized: classification.recognized
        };
        if (!classification.recognized) {
            entries.push({ ...base, formatVersion: null, keyId: null, ciphertextSha256: null, metadataAvailable: false });
            continue;
        }
        const metadata = await fetchSafeMetadata({ client, remoteConfig, key: object.Key });
        entries.push({ ...base, ...metadata });
    }

    return {
        result: "ok",
        bucket: remoteConfig.bucket,
        prefix: remoteConfig.prefix,
        count: entries.length,
        truncatedForSafety,
        entries
    };
}

async function main() {
    const report = await listRemoteBackups();
    process.stdout.write(`${JSON.stringify(report)}\n`);
}

if (require.main === module) {
    main().catch((error) => {
        createStructuredLogger().error("remote_backup_list_failed", { error });
        process.exitCode = backupCliExitCode(error);
    });
}

module.exports = {
    classifyObjectKey,
    listRemoteBackups,
    main
};
