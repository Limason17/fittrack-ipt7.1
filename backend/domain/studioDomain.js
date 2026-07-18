const crypto = require("node:crypto");

const STUDIO_ROLES = Object.freeze(["owner", "admin", "trainer", "member"]);
const INVITATION_ROLES = Object.freeze(["admin", "trainer", "member"]);
const MEMBERSHIP_STATUSES = Object.freeze(["invited", "active", "suspended", "left"]);
const MUTABLE_MEMBERSHIP_STATUSES = Object.freeze(["active", "suspended", "left"]);
const INVITATION_STATUSES = Object.freeze(["pending", "accepted", "revoked", "expired"]);
const STUDIO_STATUSES = Object.freeze(["active", "suspended"]);
const PUBLIC_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function createPublicId(randomUUID = crypto.randomUUID) {
    const value = randomUUID().toLowerCase();
    if (!PUBLIC_ID_PATTERN.test(value)) {
        throw new TypeError("The public id generator must return a UUID v4.");
    }
    return value;
}

function isPublicId(value) {
    return typeof value === "string" && PUBLIC_ID_PATTERN.test(value);
}

function normalizeStudioSlug(value) {
    if (typeof value !== "string") {
        return "";
    }

    return value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .replace(/-{2,}/g, "");
}

function isStudioSlug(value) {
    return (
        typeof value === "string" &&
        value.length >= 3 &&
        value.length <= 80 &&
        SLUG_PATTERN.test(value)
    );
}

function completedInvitationOlderThan(
    invitation,
    currentTime = new Date(),
    retentionDays = 90
) {
    if (
        !invitation ||
        !["accepted", "revoked", "expired"].includes(invitation.status) ||
        !Number.isSafeInteger(retentionDays) ||
        retentionDays < 1
    ) {
        return false;
    }
    const completedAt =
        invitation.accepted_at || invitation.revoked_at || invitation.expires_at;
    const completedTime = new Date(completedAt).getTime();
    const nowTime = new Date(currentTime).getTime();
    return (
        Number.isFinite(completedTime) &&
        Number.isFinite(nowTime) &&
        completedTime <= nowTime - retentionDays * 24 * 60 * 60 * 1000
    );
}

module.exports = {
    INVITATION_ROLES,
    INVITATION_STATUSES,
    MEMBERSHIP_STATUSES,
    MUTABLE_MEMBERSHIP_STATUSES,
    PUBLIC_ID_PATTERN,
    SLUG_PATTERN,
    STUDIO_ROLES,
    STUDIO_STATUSES,
    completedInvitationOlderThan,
    createPublicId,
    isPublicId,
    isStudioSlug,
    normalizeStudioSlug
};
