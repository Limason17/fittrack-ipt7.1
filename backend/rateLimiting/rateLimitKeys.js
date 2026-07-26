const crypto = require("node:crypto");
const { normalizeIp } = require("../security/clientIp");

function normalizeEmail(rawEmail) {
    if (typeof rawEmail !== "string") {
        return "";
    }
    return rawEmail.trim().toLowerCase();
}

// A stable, HMAC-derived 32-byte key hash - never the raw IP/e-mail/user ID
// itself - is what actually gets persisted (security_rate_limit_buckets.key_hash
// BINARY(32)). HMAC (not a plain hash) is deliberate: a plain SHA-256 of a
// small, guessable IP-address space would be trivially reversible by brute
// force, defeating the point of not storing raw IPs; keying it with a
// server-only secret (RATE_LIMIT_KEY_SECRET) makes that infeasible.
function hashRateLimitKey(secret, rawKey) {
    if (typeof secret !== "string" || secret.length < 16) {
        throw new TypeError("hashRateLimitKey requires a configured RATE_LIMIT_KEY_SECRET.");
    }
    if (typeof rawKey !== "string" || !rawKey) {
        throw new TypeError("hashRateLimitKey requires a non-empty raw key.");
    }
    return crypto.createHmac("sha256", secret).update(rawKey, "utf8").digest();
}

module.exports = {
    hashRateLimitKey,
    normalizeEmail,
    normalizeIp
};
