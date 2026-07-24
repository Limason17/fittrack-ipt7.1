const crypto = require("node:crypto");

function hashEmailChangeToken(token) {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
        const error = new Error("Email change token format is invalid.");
        error.code = "INVALID_EMAIL_CHANGE_TOKEN";
        throw error;
    }
    return crypto.createHash("sha256").update(token, "utf8").digest();
}

function createEmailChangeToken(randomBytes = crypto.randomBytes) {
    const secret = randomBytes(32);
    if (!Buffer.isBuffer(secret) || secret.length !== 32) {
        throw new TypeError("Email change token entropy source must return 32 bytes.");
    }
    const token = secret.toString("base64url");
    return { token, tokenHash: hashEmailChangeToken(token) };
}

module.exports = { createEmailChangeToken, hashEmailChangeToken };
