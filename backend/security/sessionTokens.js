const crypto = require("node:crypto");

// Mirrors security/accountTokens.js / security/invitationTokens.js exactly:
// 32 random bytes, base64url-encoded (43 characters), SHA-256 hash stored as
// a raw 32-byte Buffer - the same shape the logger's redaction regex
// already catches structurally (see startup/logger.js), and the same
// index-lookup-by-hash pattern used everywhere else in this codebase.

function hashOpaqueToken(token) {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
        const error = new Error("Token format is invalid.");
        error.code = "INVALID_OPAQUE_TOKEN";
        throw error;
    }
    return crypto.createHash("sha256").update(token, "utf8").digest();
}

function createOpaqueToken(randomBytes = crypto.randomBytes) {
    const secret = randomBytes(32);
    if (!Buffer.isBuffer(secret) || secret.length !== 32) {
        throw new TypeError("Token entropy source must return 32 bytes.");
    }
    const token = secret.toString("base64url");
    return { token, tokenHash: hashOpaqueToken(token) };
}

function timingSafeHashesEqual(left, right) {
    return (
        Buffer.isBuffer(left) && Buffer.isBuffer(right) &&
        left.length === right.length &&
        crypto.timingSafeEqual(left, right)
    );
}

module.exports = {
    createOpaqueToken,
    hashOpaqueToken,
    timingSafeHashesEqual
};
