// Deterministic, non-personal remote object key layout for Stage 2B2A:
//
//   <prefix>/<UTC-year>/<UTC-month>/<backup-filename>.ftbackup
//
// The filename itself already carries no operational identifiers (see
// encryptedBackupCreate.js#createBackupFilename - "fittrack-<timestamp>-
// <random>.ftbackup", never the source database name, never a user/studio
// identifier). Only the year/month partition and the filename are derived
// from the backup's own creation time; nothing here ever reads or encodes
// database credentials, user data, or studio data.
const path = require("node:path");

const BACKUP_FILENAME_PATTERN = /^fittrack-\d{8}T\d{6}Z-[0-9a-f]+\.ftbackup$/;

function objectKeyError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function assertBackupFilename(filename) {
    if (!BACKUP_FILENAME_PATTERN.test(filename || "")) {
        throw objectKeyError(
            "REMOTE_OBJECT_KEY_INVALID",
            "Remote upload/download is only supported for the standard fittrack-<timestamp>-<random>.ftbackup filename shape."
        );
    }
    return filename;
}

function isWithinPrefix(prefix, key) {
    const relative = path.posix.relative(prefix, key);
    return relative !== "" && !relative.startsWith("..") && !path.posix.isAbsolute(relative);
}

// Defense in depth on top of backupRemoteConfig.js's own prefix validation:
// even if a caller somehow constructed a key by hand, this refuses to
// operate on anything that does not resolve strictly inside the configured
// prefix - the remote command surface (list/verify/download/delete) must
// never be able to touch objects the operator did not explicitly scope this
// deployment to.
function assertObjectKeyWithinPrefix(prefix, key) {
    if (typeof key !== "string" || key.length === 0) {
        throw objectKeyError("REMOTE_OBJECT_KEY_INVALID", "Remote object key must be a non-empty string.");
    }
    if (key.includes("\\") || key.includes("..") || key.startsWith("/") || key.includes("//")) {
        throw objectKeyError("REMOTE_OBJECT_KEY_INVALID", "Remote object key has an unsafe shape.");
    }
    if (path.posix.extname(key).toLowerCase() !== ".ftbackup") {
        throw objectKeyError("REMOTE_OBJECT_KEY_INVALID", "Remote object key must end in .ftbackup.");
    }
    if (!isWithinPrefix(prefix, key)) {
        throw objectKeyError(
            "REMOTE_OBJECT_KEY_OUTSIDE_PREFIX",
            "Remote object key must be located inside the configured backup prefix."
        );
    }
    return key;
}

// now must be the backup's own createdAt (a real Date, not "Date.now()" at
// upload time) so the year/month partition reflects when the backup was
// actually taken, not when it happened to be uploaded.
function buildRemoteObjectKey({ prefix, filename, now }) {
    assertBackupFilename(filename);
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
        throw objectKeyError("REMOTE_OBJECT_KEY_INVALID", "A valid backup creation Date is required to build a remote object key.");
    }
    const year = String(now.getUTCFullYear());
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    const key = `${prefix}/${year}/${month}/${filename}`;
    return assertObjectKeyWithinPrefix(prefix, key);
}

module.exports = {
    BACKUP_FILENAME_PATTERN,
    assertBackupFilename,
    assertObjectKeyWithinPrefix,
    buildRemoteObjectKey,
    objectKeyError
};
