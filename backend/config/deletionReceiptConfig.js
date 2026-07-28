const path = require("node:path");

const KEY_BYTE_LENGTH = 32;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const REPOSITORY_ROOT = path.resolve(__dirname, "../..");

// Mirrors backupCryptoConfig.js's placeholder rejection - a syntactically
// valid but obviously-copied example value is never treated as configured.
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
    error.code = "INVALID_DELETION_RECEIPT_CONFIG";
    return error;
}

function trimmedOrUndefined(env, name) {
    const value = env?.[name];
    if (typeof value !== "string" || value.trim().length === 0) {
        return undefined;
    }
    return value.trim();
}

// Same "outside the repository" check databaseSafety.js's
// assertExternalBackupDirectory already uses for FITTRACK_BACKUP_DIR - a
// receipt directory nested inside the repo would risk being committed, and
// one nested inside the DB backup directory would be captured by the same
// backup cycle the receipt exists specifically to survive (Section 21.3).
function assertOutsideDirectory(candidate, forbidden, { candidateLabel, forbiddenLabel }) {
    const resolvedCandidate = path.resolve(candidate);
    const resolvedForbidden = path.resolve(forbidden);
    const relative = path.relative(resolvedForbidden, resolvedCandidate);
    const isNestedOrEqual = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
    if (isNestedOrEqual) {
        throw configError(`${candidateLabel} must not be inside ${forbiddenLabel}.`);
    }
}

function assertReceiptDirectoryLocation(directory, env) {
    assertOutsideDirectory(directory, REPOSITORY_ROOT, {
        candidateLabel: "DELETION_RECEIPT_DIR",
        forbiddenLabel: "the git repository"
    });

    const backupDir = trimmedOrUndefined(env, "FITTRACK_BACKUP_DIR");
    if (backupDir) {
        assertOutsideDirectory(directory, backupDir, {
            candidateLabel: "DELETION_RECEIPT_DIR",
            forbiddenLabel: "FITTRACK_BACKUP_DIR"
        });
    }
}

// Unlike JWT_SECRET/RATE_LIMIT_KEY_SECRET (which fall back to a fixed
// development secret), this mirrors BACKUP_ENCRYPTION_KEY_B64's posture:
// no silent default ever. The one difference from the backup key is that
// "entirely unconfigured" is a distinct, honest, explicitly-labeled state
// in non-production environments (`configured: false`) rather than a
// startup-time throw - a local checkout that never runs the deletion flow
// should not be forced to mint a receipt key just to boot. Production
// requires `configured: true`; the Deletion Receipt Doctor and readiness
// probe both treat "not configured" as fail-closed only in production
// (Section 18/21 - "keine unsicheren stillen Produktionsfallback").
function readDeletionReceiptConfig(env = process.env) {
    const production = env.NODE_ENV === "production";
    const dirRaw = trimmedOrUndefined(env, "DELETION_RECEIPT_DIR");
    const keyB64Raw = trimmedOrUndefined(env, "DELETION_RECEIPT_HMAC_KEY_B64");
    const keyIdRaw = trimmedOrUndefined(env, "DELETION_RECEIPT_HMAC_KEY_ID");

    if (!dirRaw && !keyB64Raw && !keyIdRaw) {
        if (production) {
            throw configError(
                "DELETION_RECEIPT_DIR, DELETION_RECEIPT_HMAC_KEY_B64, and DELETION_RECEIPT_HMAC_KEY_ID " +
                "must all be configured in production."
            );
        }
        return Object.freeze({ configured: false });
    }

    if (!dirRaw) {
        throw configError("DELETION_RECEIPT_DIR must be explicitly configured.");
    }
    if (!keyB64Raw) {
        throw configError("DELETION_RECEIPT_HMAC_KEY_B64 must be explicitly configured.");
    }
    if (!keyIdRaw) {
        throw configError("DELETION_RECEIPT_HMAC_KEY_ID must be explicitly configured.");
    }

    if (PLACEHOLDER_KEYS_B64.has(keyB64Raw)) {
        throw configError("DELETION_RECEIPT_HMAC_KEY_B64 must not be a placeholder value.");
    }
    if (!BASE64_PATTERN.test(keyB64Raw)) {
        throw configError("DELETION_RECEIPT_HMAC_KEY_B64 must be valid base64.");
    }
    const key = Buffer.from(keyB64Raw, "base64");
    if (key.length !== KEY_BYTE_LENGTH) {
        throw configError(`DELETION_RECEIPT_HMAC_KEY_B64 must decode to exactly ${KEY_BYTE_LENGTH} bytes.`);
    }

    if (!KEY_ID_PATTERN.test(keyIdRaw)) {
        throw configError(
            "DELETION_RECEIPT_HMAC_KEY_ID must be 1-64 characters of letters, digits, underscore, or hyphen."
        );
    }
    if (PLACEHOLDER_KEY_IDS.has(keyIdRaw.toLowerCase())) {
        throw configError("DELETION_RECEIPT_HMAC_KEY_ID must not be a placeholder value.");
    }

    assertReceiptDirectoryLocation(dirRaw, env);

    return Object.freeze({
        configured: true,
        directory: path.resolve(dirRaw),
        key,
        keyId: keyIdRaw
    });
}

module.exports = {
    KEY_BYTE_LENGTH,
    REPOSITORY_ROOT,
    configError,
    readDeletionReceiptConfig
};
