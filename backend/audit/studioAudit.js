const {
    STUDIO_ROLES,
    createPublicId,
    isPublicId
} = require("../domain/studioDomain");

const REDACTED = "[REDACTED]";
const SENSITIVE_KEY = /password|passphrase|secret|token|authorization|cookie|credential|jwt|hash/i;
const TOKEN_VALUE = /\b[A-Za-z0-9_-]{43}\b/g;
const MAX_DETAILS_BYTES = 2048;
const SAFE_STUDIO_FIELDS = new Set([
    "name",
    "slug",
    "defaultLocale",
    "defaultTimezone",
    "defaultWeightUnit"
]);
const SAFE_PROGRAM_FIELDS = new Set(["name", "description"]);
const MAX_PROGRAM_NAME_LENGTH = 120;
const SAFE_DETAIL_KEYS = Object.freeze({
    "studio.created": new Set(["role"]),
    "studio.updated": new Set(["fields"]),
    "membership.role_changed": new Set(["before", "after"]),
    "membership.suspended": new Set(["before", "after"]),
    "membership.reactivated": new Set(["before", "after"]),
    "membership.left": new Set(["before", "after"]),
    "invitation.created": new Set(["role", "expiresAt"]),
    "invitation.delivery_failed": new Set(["role"]),
    "invitation.expired": new Set(["role"]),
    "invitation.revoked": new Set(["role"]),
    "invitation.accepted": new Set(["membershipId", "role"]),
    "coaching_relationship.created": new Set(["coachMembershipId", "memberMembershipId"]),
    "coaching_relationship.ended": new Set(["coachMembershipId", "memberMembershipId"]),
    "training_program.created": new Set(["name"]),
    "training_program.updated": new Set(["fields"]),
    "training_program.archived": new Set([]),
    "training_program_version.created": new Set(["versionNumber"]),
    "training_program_version.published": new Set(["versionNumber"]),
    "training_program_assignment.created": new Set(["memberMembershipId", "versionNumber"]),
    "training_program_assignment.completed": new Set(["memberMembershipId"]),
    "training_program_assignment.cancelled": new Set(["memberMembershipId"]),
    "workout_session.started": new Set(["assignmentId", "programDayId", "versionNumber"]),
    "workout_session.completed": new Set([]),
    "workout_session.aborted": new Set([])
});

function sanitizeAuditDetails(value, seen = new WeakSet()) {
    if (value === null || value === undefined) return value;
    if (typeof value === "string") return value.replace(TOKEN_VALUE, REDACTED);
    if (["number", "boolean"].includes(typeof value)) return value;
    if (typeof value !== "object") return String(value);
    if (value instanceof Date) return value.toISOString();
    if (Buffer.isBuffer(value)) return REDACTED;
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    if (Array.isArray(value)) return value.map((entry) => sanitizeAuditDetails(entry, seen));

    return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [
            key,
            SENSITIVE_KEY.test(key) ? REDACTED : sanitizeAuditDetails(entry, seen)
        ])
    );
}

function safeRole(value) {
    if (!STUDIO_ROLES.includes(value)) {
        throw new TypeError("Audit role detail is invalid.");
    }
    return value;
}

function safeMembershipState(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("Audit membership state is invalid.");
    }
    const unknown = Object.keys(value).filter((key) => !["role", "status"].includes(key));
    if (unknown.length > 0) {
        throw new TypeError("Audit membership state contains unsafe details.");
    }
    const result = {};
    if (value.role !== undefined) result.role = safeRole(value.role);
    if (value.status !== undefined) {
        if (!['invited', 'active', 'suspended', 'left'].includes(value.status)) {
            throw new TypeError("Audit membership status is invalid.");
        }
        result.status = value.status;
    }
    return result;
}

function allowlistedAuditDetails(eventType, details) {
    const allowed = SAFE_DETAIL_KEYS[eventType];
    if (!allowed) {
        throw new TypeError("Audit event type does not have a safe detail contract.");
    }
    if (!details || typeof details !== "object" || Array.isArray(details)) {
        throw new TypeError("Audit details must be an object.");
    }
    const unknown = Object.keys(details).filter((key) => !allowed.has(key));
    if (unknown.length > 0) {
        throw new TypeError(`Audit detail ${unknown[0]} is not allowlisted.`);
    }

    const output = {};
    if (details.role !== undefined) output.role = safeRole(details.role);
    if (details.fields !== undefined) {
        const fieldAllowlist = eventType === "training_program.updated"
            ? SAFE_PROGRAM_FIELDS
            : SAFE_STUDIO_FIELDS;
        if (
            !Array.isArray(details.fields) ||
            details.fields.some((field) => !fieldAllowlist.has(field))
        ) {
            throw new TypeError("Audit field list is invalid.");
        }
        output.fields = [...new Set(details.fields)];
    }
    if (details.before !== undefined) output.before = safeMembershipState(details.before);
    if (details.after !== undefined) output.after = safeMembershipState(details.after);
    if (details.membershipId !== undefined) {
        if (!isPublicId(details.membershipId)) {
            throw new TypeError("Audit membership public id is invalid.");
        }
        output.membershipId = details.membershipId;
    }
    if (details.expiresAt !== undefined) {
        const timestamp = new Date(details.expiresAt);
        if (!Number.isFinite(timestamp.getTime())) {
            throw new TypeError("Audit expiration timestamp is invalid.");
        }
        output.expiresAt = timestamp.toISOString();
    }
    if (details.name !== undefined) {
        if (
            typeof details.name !== "string" ||
            !details.name.trim() ||
            details.name.length > MAX_PROGRAM_NAME_LENGTH
        ) {
            throw new TypeError("Audit program name detail is invalid.");
        }
        output.name = details.name;
    }
    if (details.versionNumber !== undefined) {
        if (!Number.isSafeInteger(details.versionNumber) || details.versionNumber < 1) {
            throw new TypeError("Audit version number detail is invalid.");
        }
        output.versionNumber = details.versionNumber;
    }
    if (details.coachMembershipId !== undefined) {
        if (!isPublicId(details.coachMembershipId)) {
            throw new TypeError("Audit coach membership public id is invalid.");
        }
        output.coachMembershipId = details.coachMembershipId;
    }
    if (details.memberMembershipId !== undefined) {
        if (!isPublicId(details.memberMembershipId)) {
            throw new TypeError("Audit member membership public id is invalid.");
        }
        output.memberMembershipId = details.memberMembershipId;
    }
    if (details.assignmentId !== undefined) {
        if (!isPublicId(details.assignmentId)) {
            throw new TypeError("Audit assignment public id is invalid.");
        }
        output.assignmentId = details.assignmentId;
    }
    if (details.programDayId !== undefined) {
        if (!isPublicId(details.programDayId)) {
            throw new TypeError("Audit program day public id is invalid.");
        }
        output.programDayId = details.programDayId;
    }

    const serialized = JSON.stringify(output);
    if (Buffer.byteLength(serialized, "utf8") > MAX_DETAILS_BYTES) {
        throw new TypeError("Audit details exceed the safe size limit.");
    }
    return output;
}

function buildAuditEvent({
    studioId,
    actorUserId,
    eventType,
    targetType,
    targetPublicId,
    details = {},
    publicId
}) {
    if (!Number.isSafeInteger(studioId) || studioId <= 0) {
        throw new TypeError("Audit events require an internal studio id.");
    }
    if (!Number.isSafeInteger(actorUserId) || actorUserId <= 0) {
        throw new TypeError("Audit events require an actor user id.");
    }
    for (const [field, value] of Object.entries({ eventType, targetType, targetPublicId })) {
        if (typeof value !== "string" || !value || value.length > 100) {
            throw new TypeError(`Audit ${field} is invalid.`);
        }
    }
    if (!isPublicId(targetPublicId)) {
        throw new TypeError("Audit target must use a UUID v4 public id.");
    }

    const safeDetails = allowlistedAuditDetails(eventType, details);

    return {
        publicId: publicId || createPublicId(),
        studioId,
        actorUserId,
        eventType,
        targetType,
        targetPublicId,
        detailsJson: JSON.stringify(safeDetails)
    };
}

module.exports = {
    REDACTED,
    SAFE_DETAIL_KEYS,
    allowlistedAuditDetails,
    buildAuditEvent,
    sanitizeAuditDetails
};
