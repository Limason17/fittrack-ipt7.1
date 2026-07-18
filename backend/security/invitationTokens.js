const crypto = require("node:crypto");

function hashInvitationToken(token) {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
        const error = new Error("Invitation token format is invalid.");
        error.code = "INVALID_INVITATION_TOKEN";
        throw error;
    }
    return crypto.createHash("sha256").update(token, "utf8").digest();
}

function createInvitationToken(randomBytes = crypto.randomBytes) {
    const secret = randomBytes(32);
    if (!Buffer.isBuffer(secret) || secret.length !== 32) {
        throw new TypeError("Invitation token entropy source must return 32 bytes.");
    }
    const token = secret.toString("base64url");
    return {
        token,
        tokenHash: hashInvitationToken(token)
    };
}

function invitationTokenHashesEqual(left, right) {
    return (
        Buffer.isBuffer(left) &&
        Buffer.isBuffer(right) &&
        left.length === 32 &&
        right.length === 32 &&
        crypto.timingSafeEqual(left, right)
    );
}

module.exports = {
    createInvitationToken,
    hashInvitationToken,
    invitationTokenHashesEqual
};
