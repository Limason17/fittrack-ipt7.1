// Strictly validated, providerneutral S3-compatible remote storage
// configuration for Stage 2B2A off-host backup storage. Mirrors the
// fail-closed style of backupCryptoConfig.js/backupTimeoutConfig.js: any
// missing, malformed, or placeholder value throws rather than falling back
// to a default that could silently point at the wrong place.
//
// Deliberately never reads AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/
// AWS_SESSION_TOKEN/AWS_PROFILE or any other generic AWS SDK environment
// variable - only the explicit BACKUP_S3_* names below are ever consulted,
// and the resulting credentials are always passed to the S3 client
// explicitly (see backupRemoteStorage.js#createS3Client), so the SDK's
// default credential provider chain (shared config files, instance
// metadata, SSO, generic env vars) is never reachable from this code.
const { isLoopbackHost } = require("../scripts/databaseSafety");

const BUCKET_PATTERN = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const PREFIX_PATTERN = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;
const PREFIX_MAX_LENGTH = 512;
const REGION_PATTERN = /^[a-z0-9-]{1,32}$/;
const KMS_KEY_ID_PATTERN = /^[A-Za-z0-9:/_-]{1,512}$/;

const SUPPORTED_PROVIDERS = new Set(["s3"]);
const SSE_MODES = new Set(["none", "AES256", "aws:kms"]);

const PLACEHOLDER_VALUES = new Set([
    "",
    "changeme",
    "change-me",
    "example",
    "test",
    "placeholder",
    "todo",
    "your-bucket",
    "your-bucket-name",
    "replace-with-your-bucket-name",
    "replace-with-your-access-key-id",
    "replace-with-your-secret-access-key",
    "fittrack-backups-example"
]);

function configError(message) {
    const error = new Error(message);
    error.code = "INVALID_BACKUP_REMOTE_CONFIG";
    return error;
}

function requiredText(env, name, { maxLength = 255 } = {}) {
    const value = env?.[name];
    if (typeof value !== "string" || value.trim().length === 0) {
        throw configError(`${name} must be explicitly configured.`);
    }
    const trimmed = value.trim();
    if (trimmed.length > maxLength) {
        throw configError(`${name} is longer than the allowed ${maxLength} characters.`);
    }
    if (PLACEHOLDER_VALUES.has(trimmed.toLowerCase())) {
        throw configError(`${name} must not be a placeholder value.`);
    }
    return trimmed;
}

function strictBoolean(env, name, fallback) {
    const value = env?.[name];
    if (value === undefined || value === null || value === "") {
        return fallback;
    }
    if (value === "true") return true;
    if (value === "false") return false;
    throw configError(`${name} must be exactly "true" or "false".`);
}

function timeoutSetting(env, name, { fallback, min, max }) {
    const value = env?.[name];
    if (value === undefined || value === null || value === "") {
        return fallback;
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        throw configError(`${name} must be an integer between ${min} and ${max} milliseconds.`);
    }
    return parsed;
}

function isBackupRemoteEnabled(env = process.env) {
    return env?.BACKUP_REMOTE_ENABLED === "true";
}

function validateBucket(env) {
    const bucket = requiredText(env, "BACKUP_S3_BUCKET", { maxLength: 63 });
    if (!BUCKET_PATTERN.test(bucket)) {
        throw configError(
            "BACKUP_S3_BUCKET must be 3-63 characters of lowercase letters, digits, dots, or hyphens, starting and ending with a letter or digit."
        );
    }
    if (/\.\./.test(bucket) || /^\d{1,3}(\.\d{1,3}){3}$/.test(bucket)) {
        throw configError("BACKUP_S3_BUCKET must not contain consecutive dots or look like an IP address.");
    }
    return bucket;
}

// Rejects '..' segments, backslashes, leading/trailing/duplicate slashes,
// and control characters by construction - PREFIX_PATTERN only ever matches
// a clean sequence of single-slash-separated segments drawn from a safe
// charset, so there is no character position where any of those forbidden
// shapes could hide.
function validatePrefix(env) {
    const raw = requiredText(env, "BACKUP_S3_PREFIX", { maxLength: PREFIX_MAX_LENGTH });
    if (raw.includes("\\")) {
        throw configError("BACKUP_S3_PREFIX must not contain backslashes.");
    }
    if (!PREFIX_PATTERN.test(raw)) {
        throw configError(
            "BACKUP_S3_PREFIX must be a normalized path of alphanumeric/underscore/hyphen segments separated by single slashes, with no leading, trailing, or duplicate slashes and no '..' segments."
        );
    }
    return raw;
}

function validateEndpoint(env) {
    const raw = requiredText(env, "BACKUP_S3_ENDPOINT", { maxLength: 512 });
    let url;
    try {
        url = new URL(raw);
    } catch {
        throw configError("BACKUP_S3_ENDPOINT must be a valid URL.");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw configError("BACKUP_S3_ENDPOINT must use http or https.");
    }
    const isProduction = env.NODE_ENV === "production";
    if (url.protocol === "http:") {
        if (isProduction) {
            throw configError("BACKUP_S3_ENDPOINT must use https in production.");
        }
        if (!isLoopbackHost(url.hostname)) {
            throw configError(
                "BACKUP_S3_ENDPOINT may only use http for an explicit loopback/MinIO test endpoint."
            );
        }
    }
    return url.toString();
}

function validateCredentials(env) {
    const accessKeyId = env?.BACKUP_S3_ACCESS_KEY_ID;
    const secretAccessKey = env?.BACKUP_S3_SECRET_ACCESS_KEY;
    const accessKeyPresent = typeof accessKeyId === "string" && accessKeyId.trim().length > 0;
    const secretPresent = typeof secretAccessKey === "string" && secretAccessKey.trim().length > 0;
    if (accessKeyPresent !== secretPresent) {
        throw configError(
            "BACKUP_S3_ACCESS_KEY_ID and BACKUP_S3_SECRET_ACCESS_KEY must be configured together."
        );
    }
    if (!accessKeyPresent) {
        throw configError(
            "BACKUP_S3_ACCESS_KEY_ID and BACKUP_S3_SECRET_ACCESS_KEY must be explicitly configured - no implicit AWS credential chain is ever used."
        );
    }
    if (PLACEHOLDER_VALUES.has(accessKeyId.trim().toLowerCase()) || PLACEHOLDER_VALUES.has(secretAccessKey.trim().toLowerCase())) {
        throw configError("BACKUP_S3_ACCESS_KEY_ID/BACKUP_S3_SECRET_ACCESS_KEY must not be placeholder values.");
    }
    const sessionTokenRaw = env?.BACKUP_S3_SESSION_TOKEN;
    const sessionToken =
        typeof sessionTokenRaw === "string" && sessionTokenRaw.trim().length > 0
            ? sessionTokenRaw.trim()
            : undefined;
    return {
        accessKeyId: accessKeyId.trim(),
        secretAccessKey: secretAccessKey.trim(),
        sessionToken
    };
}

function validateServerSideEncryption(env) {
    const raw = env?.BACKUP_S3_SERVER_SIDE_ENCRYPTION;
    const mode = typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : "none";
    if (!SSE_MODES.has(mode)) {
        throw configError('BACKUP_S3_SERVER_SIDE_ENCRYPTION must be "none", "AES256", or "aws:kms".');
    }
    let kmsKeyId;
    if (mode === "aws:kms") {
        kmsKeyId = requiredText(env, "BACKUP_S3_KMS_KEY_ID", { maxLength: 512 });
        if (!KMS_KEY_ID_PATTERN.test(kmsKeyId)) {
            throw configError("BACKUP_S3_KMS_KEY_ID contains unsupported characters.");
        }
    }
    return { mode, kmsKeyId };
}

// Returns a frozen, fully validated remote storage configuration. Never
// returns partially-validated state: any single invalid field throws before
// any field is returned. Throws INVALID_BACKUP_REMOTE_CONFIG if
// BACKUP_REMOTE_ENABLED is not exactly "true" - every remote command must
// call this (directly or via assertBackupRemoteEnabled) before touching the
// network.
function readBackupRemoteConfig(env = process.env) {
    if (!isBackupRemoteEnabled(env)) {
        throw configError("BACKUP_REMOTE_ENABLED must be exactly \"true\" to use off-host backup storage.");
    }
    const providerRaw = requiredText(env, "BACKUP_REMOTE_PROVIDER");
    const provider = providerRaw.toLowerCase();
    if (!SUPPORTED_PROVIDERS.has(provider)) {
        throw configError(`BACKUP_REMOTE_PROVIDER "${providerRaw}" is not supported. Supported: s3.`);
    }

    const endpoint = validateEndpoint(env);
    const region = requiredText(env, "BACKUP_S3_REGION", { maxLength: 32 });
    if (!REGION_PATTERN.test(region)) {
        throw configError("BACKUP_S3_REGION must be 1-32 characters of lowercase letters, digits, or hyphens.");
    }
    const bucket = validateBucket(env);
    const prefix = validatePrefix(env);
    const credentials = validateCredentials(env);
    const forcePathStyle = strictBoolean(env, "BACKUP_S3_FORCE_PATH_STYLE", false);
    const requireVersioning = strictBoolean(env, "BACKUP_S3_REQUIRE_VERSIONING", false);
    const requireObjectLock = strictBoolean(env, "BACKUP_S3_REQUIRE_OBJECT_LOCK", false);
    const serverSideEncryption = validateServerSideEncryption(env);

    const uploadTimeoutMs = timeoutSetting(env, "BACKUP_S3_UPLOAD_TIMEOUT_MS", {
        fallback: 600_000,
        min: 5_000,
        max: 3_600_000
    });
    const downloadTimeoutMs = timeoutSetting(env, "BACKUP_S3_DOWNLOAD_TIMEOUT_MS", {
        fallback: 600_000,
        min: 5_000,
        max: 3_600_000
    });
    // Covers the short metadata-only calls (preflight checks, HeadObject,
    // ListObjectsV2 pages, DeleteObject) - deliberately not operator
    // configurable per-operation, mirroring BACKUP_DOCKER_OPERATION_TIMEOUT_MS's
    // single shared budget for comparably cheap calls.
    const operationTimeoutMs = timeoutSetting(env, "BACKUP_S3_OPERATION_TIMEOUT_MS", {
        fallback: 15_000,
        min: 1_000,
        max: 120_000
    });

    return Object.freeze({
        provider,
        endpoint,
        region,
        bucket,
        prefix,
        credentials: Object.freeze(credentials),
        forcePathStyle,
        requireVersioning,
        requireObjectLock,
        serverSideEncryption: Object.freeze(serverSideEncryption),
        uploadTimeoutMs,
        downloadTimeoutMs,
        operationTimeoutMs
    });
}

module.exports = {
    BUCKET_PATTERN,
    PREFIX_PATTERN,
    configError,
    isBackupRemoteEnabled,
    readBackupRemoteConfig
};
