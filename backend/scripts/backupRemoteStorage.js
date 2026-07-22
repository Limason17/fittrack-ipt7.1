// Thin, explicit wrapper around the AWS SDK v3 S3 client for Stage 2B2A
// off-host backup storage. Every exported function here takes an already
// validated backupRemoteConfig.js config object and an already constructed
// client - nothing in this file reads process.env directly, and nothing
// here ever lets the SDK fall back to its own default credential provider
// chain (see createS3Client below).
const crypto = require("node:crypto");
const {
    DeleteObjectCommand,
    GetBucketVersioningCommand,
    GetObjectCommand,
    GetObjectLockConfigurationCommand,
    GetPublicAccessBlockCommand,
    HeadBucketCommand,
    HeadObjectCommand,
    ListObjectsV2Command,
    PutObjectCommand,
    S3Client
} = require("@aws-sdk/client-s3");

const CONTENT_TYPE = "application/vnd.fittrack.backup";
const METADATA_ALLOWLIST = Object.freeze([
    "format-version",
    "key-id",
    "created-at",
    "ciphertext-sha256",
    "source-database",
    "application",
    "backup-type"
]);
// Deliberately far below S3's real single-PUT ceiling (5 GiB) rather than
// pushed up against it: every real FitTrack logical dump observed so far is
// in the tens of kilobytes, so 2 GiB leaves enormous headroom while keeping
// every upload a single, atomically-conditional PutObject (see
// uploadObject below) - no multipart, no ambiguity about whether a
// conditional write is honored across multipart completion on every
// provider. If a future backup ever needs to exceed this, that is a
// deliberate, separate decision, not an accidental side effect of removing
// this ceiling.
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

function remoteError(code, message, details = {}) {
    const error = new Error(message);
    error.code = code;
    Object.assign(error, details);
    return error;
}

// Explicit, static credentials only - never `fromEnv()`, `fromIni()`,
// `fromInstanceMetadata()`, SSO, or any other provider from
// @aws-sdk/credential-provider-node. The `credentials` field is always a
// plain object built entirely from the already-validated
// backupRemoteConfig.js result, so an operator's personal `~/.aws/config`
// or ambient AWS_* environment variables can never be reached from here.
function createS3Client(remoteConfig) {
    return new S3Client({
        region: remoteConfig.region,
        endpoint: remoteConfig.endpoint,
        forcePathStyle: remoteConfig.forcePathStyle,
        credentials: {
            accessKeyId: remoteConfig.credentials.accessKeyId,
            secretAccessKey: remoteConfig.credentials.secretAccessKey,
            ...(remoteConfig.credentials.sessionToken
                ? { sessionToken: remoteConfig.credentials.sessionToken }
                : {})
        }
    });
}

// Returns {signal, cancel}; cancel MUST be called once the call this signal
// guards has settled, win or lose - an uncancelled setTimeout keeps the
// process alive for the rest of its duration even after the race is over
// (the exact dangling-timer bug fixed in Stage 2B1's databaseTools.js).
function abortAfter(timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

// Maps AWS SDK v3 errors to FitTrack's own stable, safe error codes.
// Deliberately reconstructs a clean message from a small, explicit
// allowlist of fields (name, bucket, key, http status) rather than ever
// forwarding the raw SDK error object, which can carry internal HTTP
// request/response metadata that has no business reaching a log line.
function normalizeRemoteError(error, context) {
    if (error?.code && String(error.code).startsWith("REMOTE_")) {
        return error;
    }
    const name = error?.name || "";
    const httpStatusCode = error?.$metadata?.httpStatusCode;
    const authNames = new Set([
        "InvalidAccessKeyId",
        "SignatureDoesNotMatch",
        "AccessDenied",
        "AccessDeniedException",
        "CredentialsProviderError",
        "UnrecognizedClientException",
        "ExpiredToken"
    ]);
    const notFoundNames = new Set(["NoSuchKey", "NotFound"]);
    const unavailableNames = new Set([
        "NoSuchBucket",
        "NetworkingError",
        "TimeoutError",
        "ENOTFOUND",
        "ECONNREFUSED",
        "ECONNRESET",
        "EHOSTUNREACH"
    ]);

    if (authNames.has(name) || httpStatusCode === 401 || httpStatusCode === 403) {
        return remoteError("REMOTE_AUTH_FAILED", `${context}: remote authentication or authorization failed.`, {
            providerErrorName: name
        });
    }
    if (notFoundNames.has(name) || httpStatusCode === 404) {
        return remoteError("REMOTE_OBJECT_NOT_FOUND", `${context}: remote object was not found.`, {
            providerErrorName: name
        });
    }
    if (unavailableNames.has(name) || unavailableNames.has(error?.code)) {
        return remoteError("REMOTE_BUCKET_UNAVAILABLE", `${context}: the remote endpoint or bucket is not reachable.`, {
            providerErrorName: name
        });
    }
    return remoteError("REMOTE_OPERATION_FAILED", `${context}: the remote storage operation failed.`, {
        providerErrorName: name || error?.code
    });
}

async function sendWithTimeout(client, command, { timeoutMs, context }) {
    const { signal, cancel } = abortAfter(timeoutMs);
    try {
        return await client.send(command, { abortSignal: signal });
    } catch (error) {
        if (error?.name === "AbortError" || signal.aborted) {
            throw remoteError("REMOTE_OPERATION_TIMEOUT", `${context} did not complete within its configured timeout.`);
        }
        throw normalizeRemoteError(error, context);
    } finally {
        cancel();
    }
}

function buildMetadata(fields) {
    const metadata = {};
    for (const key of METADATA_ALLOWLIST) {
        const value = fields[key];
        if (value !== undefined && value !== null && value !== "") {
            metadata[key] = String(value);
        }
    }
    return metadata;
}

function sseParams(remoteConfig) {
    const { mode, kmsKeyId } = remoteConfig.serverSideEncryption;
    if (mode === "none") return {};
    if (mode === "AES256") return { ServerSideEncryption: "AES256" };
    return { ServerSideEncryption: "aws:kms", SSEKMSKeyId: kmsKeyId };
}

async function headBucket({ client, remoteConfig }) {
    return sendWithTimeout(
        client,
        new HeadBucketCommand({ Bucket: remoteConfig.bucket }),
        { timeoutMs: remoteConfig.operationTimeoutMs, context: "HeadBucket" }
    );
}

async function getBucketVersioningStatus({ client, remoteConfig }) {
    const result = await sendWithTimeout(
        client,
        new GetBucketVersioningCommand({ Bucket: remoteConfig.bucket }),
        { timeoutMs: remoteConfig.operationTimeoutMs, context: "GetBucketVersioning" }
    );
    return result.Status || "Disabled";
}

// Object Lock introspection is intentionally honest about provider support:
// callers must only ever report "enabled" when the provider explicitly says
// so, and must surface "unsupported"/"not-configured" rather than silently
// treating an error as "confirmed disabled" or, worse, "confirmed enabled".
async function getObjectLockStatus({ client, remoteConfig }) {
    try {
        const result = await sendWithTimeout(
            client,
            new GetObjectLockConfigurationCommand({ Bucket: remoteConfig.bucket }),
            { timeoutMs: remoteConfig.operationTimeoutMs, context: "GetObjectLockConfiguration" }
        );
        return result.ObjectLockConfiguration?.ObjectLockEnabled === "Enabled" ? "enabled" : "disabled";
    } catch (error) {
        if (error?.code === "REMOTE_OPERATION_TIMEOUT") throw error;
        const name = error?.providerErrorName || error?.name;
        if (name === "ObjectLockConfigurationNotFoundError") return "disabled";
        return "unsupported";
    }
}

// Public-access introspection likewise degrades honestly: MinIO does not
// implement GetPublicAccessBlock the same way AWS does, so a failure here
// is reported as "unknown", never asserted as "confirmed private".
async function getPublicAccessStatus({ client, remoteConfig }) {
    try {
        const result = await sendWithTimeout(
            client,
            new GetPublicAccessBlockCommand({ Bucket: remoteConfig.bucket }),
            { timeoutMs: remoteConfig.operationTimeoutMs, context: "GetPublicAccessBlock" }
        );
        const config = result.PublicAccessBlockConfiguration || {};
        const allBlocked =
            config.BlockPublicAcls && config.IgnorePublicAcls && config.BlockPublicPolicy && config.RestrictPublicBuckets;
        return allBlocked ? "private" : "not-fully-blocked";
    } catch {
        return "unknown";
    }
}

async function headObject({ client, remoteConfig, key }) {
    return sendWithTimeout(
        client,
        new HeadObjectCommand({ Bucket: remoteConfig.bucket, Key: key }),
        { timeoutMs: remoteConfig.operationTimeoutMs, context: "HeadObject" }
    );
}

// deleteObject accepts an optional `versionId`: when the bucket is
// versioned and the caller already knows which specific version it created
// (see uploadObject's returned versionId), passing it ensures the delete
// removes exactly that version rather than creating a delete marker over
// whatever the current version happens to be at cleanup time - important if
// another writer has since published a newer version at the same key.
async function deleteObject({ client, remoteConfig, key, versionId }) {
    return sendWithTimeout(
        client,
        new DeleteObjectCommand({
            Bucket: remoteConfig.bucket,
            Key: key,
            ...(versionId ? { VersionId: versionId } : {})
        }),
        { timeoutMs: remoteConfig.operationTimeoutMs, context: "DeleteObject" }
    );
}

function preconditionFailed(error) {
    return error?.name === "PreconditionFailed" || error?.$metadata?.httpStatusCode === 412;
}

// Publishes with a single, atomically-conditional PutObject - no HeadObject
// pre-check, no multipart, no @aws-sdk/lib-storage. IfNoneMatch: "*" is
// evaluated server-side, atomically, against the bucket's actual state at
// write time: if any object already exists at this key (created a
// microsecond ago by a different process, or a year ago by a human), S3/
// MinIO reject the write with 412 Precondition Failed and the existing
// object is left completely untouched - there is no window between a
// check and a write for a second writer to slip into. Empirically verified
// against real MinIO, including two genuinely concurrent PutObject calls
// racing for the same key (exactly one succeeds, the loser gets 412, the
// object holds the winner's bytes) - see
// backend/test/integration/backupRemoteMinio.test.js and
// docs/STAGE_2B2A_S3_OFFHOST_BACKUPS.md for the documented guarantee and
// its remaining limits. Never sets an ACL: modern buckets increasingly
// reject any ACL at all ("Bucket Owner Enforced"), and omitting it is also
// the only way to guarantee the object is never accidentally public.
async function uploadObject({ client, remoteConfig, key, body, contentLength, metadataFields }) {
    if (!Number.isSafeInteger(contentLength) || contentLength <= 0) {
        throw remoteError("REMOTE_UPLOAD_FAILED", "Upload body size could not be determined.");
    }
    if (contentLength > MAX_UPLOAD_BYTES) {
        throw remoteError(
            "REMOTE_BACKUP_TOO_LARGE",
            `Backup file (${contentLength} bytes) exceeds the documented remote upload limit of ${MAX_UPLOAD_BYTES} bytes.`
        );
    }
    const { signal, cancel } = abortAfter(remoteConfig.uploadTimeoutMs);
    try {
        const result = await client.send(
            new PutObjectCommand({
                Bucket: remoteConfig.bucket,
                Key: key,
                Body: body,
                ContentLength: contentLength,
                ContentType: CONTENT_TYPE,
                ChecksumAlgorithm: "SHA256",
                IfNoneMatch: "*",
                Metadata: buildMetadata(metadataFields),
                ...sseParams(remoteConfig)
            }),
            { abortSignal: signal }
        );
        return { versionId: result.VersionId ?? null, etag: result.ETag ?? null };
    } catch (error) {
        if (error?.name === "AbortError" || signal.aborted) {
            throw remoteError("REMOTE_OPERATION_TIMEOUT", "Upload did not complete within its configured timeout.");
        }
        if (preconditionFailed(error)) {
            throw remoteError(
                "REMOTE_OBJECT_ALREADY_EXISTS",
                "A remote object already exists at this key; uploads never overwrite an existing object."
            );
        }
        throw normalizeRemoteError(error, "PutObject");
    } finally {
        cancel();
    }
}

// Streams the object body to `sink` (a Writable) while independently
// hashing every byte, so the returned sha256 can be checked against the
// backup's own recorded ciphertext-sha256 before anything downstream ever
// trusts the bytes - this function does not decide what "trust" means, it
// only proves what was actually received.
async function downloadObjectToSink({ client, remoteConfig, key, sink }) {
    const { signal, cancel } = abortAfter(remoteConfig.downloadTimeoutMs);
    try {
        const response = await client.send(
            new GetObjectCommand({ Bucket: remoteConfig.bucket, Key: key }),
            { abortSignal: signal }
        );
        const hash = crypto.createHash("sha256");
        let bytes = 0;
        await new Promise((resolve, reject) => {
            const body = response.Body;
            body.on("data", (chunk) => {
                hash.update(chunk);
                bytes += chunk.length;
            });
            body.once("error", reject);
            sink.once("error", reject);
            sink.once("finish", resolve);
            body.pipe(sink);
        });
        return { bytes, sha256: hash.digest("hex") };
    } catch (error) {
        if (error?.name === "AbortError" || signal.aborted) {
            throw remoteError("REMOTE_OPERATION_TIMEOUT", "Download did not complete within its configured timeout.");
        }
        throw normalizeRemoteError(error, "GetObject");
    } finally {
        cancel();
    }
}

// Full pagination: loops on ContinuationToken until IsTruncated is false, up
// to a fixed safety cap so a misbehaving provider can never make this loop
// unboundedly - past the cap the result is marked truncatedForSafety rather
// than silently pretending the inventory is complete.
const LIST_SAFETY_CAP = 10_000;
const LIST_PAGE_SIZE = 1000;

async function listAllObjects({ client, remoteConfig, pageSize = LIST_PAGE_SIZE }) {
    const listPrefix = `${remoteConfig.prefix}/`;
    const objects = [];
    let continuationToken;
    let truncatedForSafety = false;
    do {
        const page = await sendWithTimeout(
            client,
            new ListObjectsV2Command({
                Bucket: remoteConfig.bucket,
                Prefix: listPrefix,
                MaxKeys: pageSize,
                ContinuationToken: continuationToken
            }),
            { timeoutMs: remoteConfig.operationTimeoutMs, context: "ListObjectsV2" }
        );
        for (const entry of page.Contents || []) {
            objects.push(entry);
            if (objects.length >= LIST_SAFETY_CAP) {
                truncatedForSafety = true;
                break;
            }
        }
        continuationToken = truncatedForSafety ? undefined : page.NextContinuationToken;
    } while (continuationToken);
    return { objects, truncatedForSafety };
}

module.exports = {
    CONTENT_TYPE,
    LIST_SAFETY_CAP,
    MAX_UPLOAD_BYTES,
    METADATA_ALLOWLIST,
    abortAfter,
    buildMetadata,
    createS3Client,
    deleteObject,
    downloadObjectToSink,
    getBucketVersioningStatus,
    getObjectLockStatus,
    getPublicAccessStatus,
    headBucket,
    headObject,
    listAllObjects,
    normalizeRemoteError,
    remoteError,
    sendWithTimeout,
    uploadObject
};
