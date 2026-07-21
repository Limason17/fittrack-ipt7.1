const KEY_BYTE_LENGTH = 32;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// Values that are obviously copy-pasted example/placeholder content rather
// than a real generated key or key identifier. Rejected regardless of
// whether they happen to be syntactically valid, since a placeholder is
// never a valid configuration - mirrors config/smtpConfig.js's approach.
const PLACEHOLDER_KEY_IDS = new Set([
    "changeme",
    "change-me",
    "example",
    "test",
    "placeholder",
    "todo",
    "local-key-id",
    "replace-with-a-key-id"
]);

const PLACEHOLDER_KEYS_B64 = new Set([
    "",
    "changeme",
    "replace-with-a-base64-encoded-32-byte-key",
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    "0000000000000000000000000000000000000000000000"
]);

function configError(message) {
    const error = new Error(message);
    error.code = "INVALID_BACKUP_CRYPTO_CONFIG";
    return error;
}

function requiredText(env, name) {
    const value = env?.[name];
    if (typeof value !== "string" || value.trim().length === 0) {
        throw configError(`${name} must be explicitly configured.`);
    }
    return value.trim();
}

// Returns the raw 32-byte key Buffer and the key id. Never reads a
// fallback/default key from anywhere - a missing or invalid value always
// throws, fail-closed. Callers must treat the returned key as sensitive:
// never log it, never persist it, never include it in a backup's own
// header/metadata. Deliberately does NOT also require
// BACKUP_OUTPUT_DIRECTORY: that variable only matters to the create command
// (which resolves and validates it itself via databaseSafety.js's
// assertExternalBackupDirectory, already the authoritative check including
// its own "must be set" error) - verify and restore operate on an
// already-named file and have no use for an output directory at all, so
// bundling it in here would force every command to configure a variable
// most of them ignore.
function readBackupCryptoConfig(env = process.env) {
    const keyB64 = requiredText(env, "BACKUP_ENCRYPTION_KEY_B64");
    if (PLACEHOLDER_KEYS_B64.has(keyB64)) {
        throw configError("BACKUP_ENCRYPTION_KEY_B64 must not be a placeholder value.");
    }
    if (!BASE64_PATTERN.test(keyB64)) {
        throw configError("BACKUP_ENCRYPTION_KEY_B64 must be valid base64.");
    }
    const key = Buffer.from(keyB64, "base64");
    if (key.length !== KEY_BYTE_LENGTH) {
        throw configError(
            `BACKUP_ENCRYPTION_KEY_B64 must decode to exactly ${KEY_BYTE_LENGTH} bytes.`
        );
    }

    const keyId = requiredText(env, "BACKUP_ENCRYPTION_KEY_ID");
    if (!KEY_ID_PATTERN.test(keyId)) {
        throw configError(
            "BACKUP_ENCRYPTION_KEY_ID must be 1-64 characters of letters, digits, underscore, or hyphen."
        );
    }
    if (PLACEHOLDER_KEY_IDS.has(keyId.toLowerCase())) {
        throw configError("BACKUP_ENCRYPTION_KEY_ID must not be a placeholder value.");
    }

    return Object.freeze({ key, keyId });
}

module.exports = {
    KEY_BYTE_LENGTH,
    configError,
    readBackupCryptoConfig
};
