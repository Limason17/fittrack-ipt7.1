const { ValidationError } = require("../errors/AppError");
const { LIMITS: USER_LIMITS } = require("./userValidation");
const {
    INVITATION_ROLES,
    MUTABLE_MEMBERSHIP_STATUSES,
    STUDIO_ROLES,
    isPublicId,
    isStudioSlug,
    normalizeStudioSlug
} = require("../domain/studioDomain");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function fail(field, message) {
    throw new ValidationError({ [field]: message });
}

function plainObject(value, field = "body") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        fail(field, "A JSON object is required.");
    }
    return value;
}

function exactKeys(value, allowed, { atLeastOne = false } = {}) {
    plainObject(value);
    const keys = Object.keys(value);
    const unknown = keys.filter((key) => !allowed.includes(key));
    if (unknown.length > 0) {
        fail(unknown[0], "This field is not allowed.");
    }
    if (atLeastOne && keys.length === 0) {
        fail("body", "At least one supported field is required.");
    }
}

function requiredString(value, field, maxLength) {
    if (typeof value !== "string") {
        fail(field, "This field must be a string.");
    }
    const normalized = value.trim();
    if (!normalized) {
        fail(field, "This field is required.");
    }
    if (normalized.length > maxLength) {
        fail(field, `This field must contain at most ${maxLength} characters.`);
    }
    return normalized;
}

function optionalChoice(value, field, allowed, fallback) {
    if (value === undefined) return fallback;
    if (typeof value !== "string" || !allowed.includes(value)) {
        fail(field, `Allowed values are: ${allowed.join(", ")}.`);
    }
    return value;
}

function requiredChoice(value, field, allowed) {
    if (typeof value !== "string" || !allowed.includes(value)) {
        fail(field, `Allowed values are: ${allowed.join(", ")}.`);
    }
    return value;
}

function validateTimezone(value, fallback = "Europe/Zurich") {
    if (value === undefined) return fallback;
    const timezone = requiredString(value, "defaultTimezone", 64);
    try {
        new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
    } catch (error) {
        fail("defaultTimezone", "A valid IANA timezone is required.");
    }
    return timezone;
}

function validateSlug(value, fallbackName) {
    const normalized = normalizeStudioSlug(value === undefined ? fallbackName : value);
    if (!isStudioSlug(normalized)) {
        fail("slug", "Use 3 to 80 lowercase letters, numbers, or single hyphens.");
    }
    return normalized;
}

function validateCreateStudioPayload(body) {
    exactKeys(body, [
        "name",
        "slug",
        "defaultLocale",
        "defaultTimezone",
        "defaultWeightUnit"
    ]);
    const name = requiredString(body.name, "name", 100);
    return {
        name,
        slug: validateSlug(body.slug, name),
        default_locale: optionalChoice(body.defaultLocale, "defaultLocale", ["de", "en"], "de"),
        default_timezone: validateTimezone(body.defaultTimezone),
        default_weight_unit: optionalChoice(
            body.defaultWeightUnit,
            "defaultWeightUnit",
            ["kg", "lb"],
            "kg"
        )
    };
}

function validateStudioPatchPayload(body) {
    const allowed = [
        "name",
        "slug",
        "defaultLocale",
        "defaultTimezone",
        "defaultWeightUnit"
    ];
    exactKeys(body, allowed, { atLeastOne: true });
    const result = {};
    if (Object.hasOwn(body, "name")) result.name = requiredString(body.name, "name", 100);
    if (Object.hasOwn(body, "slug")) result.slug = validateSlug(body.slug, "");
    if (Object.hasOwn(body, "defaultLocale")) {
        result.default_locale = optionalChoice(body.defaultLocale, "defaultLocale", ["de", "en"]);
    }
    if (Object.hasOwn(body, "defaultTimezone")) {
        result.default_timezone = validateTimezone(body.defaultTimezone);
    }
    if (Object.hasOwn(body, "defaultWeightUnit")) {
        result.default_weight_unit = optionalChoice(
            body.defaultWeightUnit,
            "defaultWeightUnit",
            ["kg", "lb"]
        );
    }
    return result;
}

function validateMembershipPatchPayload(body) {
    exactKeys(body, ["role", "status"], { atLeastOne: true });
    const result = {};
    if (Object.hasOwn(body, "role")) {
        result.role = optionalChoice(body.role, "role", STUDIO_ROLES);
    }
    if (Object.hasOwn(body, "status")) {
        result.status = optionalChoice(body.status, "status", MUTABLE_MEMBERSHIP_STATUSES);
    }
    return result;
}

function normalizeEmail(value) {
    const email = requiredString(value, "email", USER_LIMITS.email).toLowerCase();
    const [localPart] = email.split("@");
    if (!EMAIL_PATTERN.test(email) || localPart.length > 64) {
        fail("email", "A valid e-mail address is required.");
    }
    return email;
}

function validateInvitationPayload(body) {
    exactKeys(body, ["email", "role"]);
    return {
        email: normalizeEmail(body.email),
        role: requiredChoice(body.role, "role", INVITATION_ROLES)
    };
}

function positiveQueryInteger(value, field, fallback, maximum) {
    if (value === undefined) return fallback;
    if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
        fail(field, "A positive integer is required.");
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed > maximum) {
        fail(field, `This field must be at most ${maximum}.`);
    }
    return parsed;
}

function validatePagination(query = {}) {
    exactKeys(query, ["page", "limit"]);
    const page = positiveQueryInteger(query.page, "page", 1, 1_000_000);
    const limit = positiveQueryInteger(query.limit, "limit", 20, 100);
    return { page, limit, offset: (page - 1) * limit };
}

function validatePublicId(value, field = "id") {
    if (!isPublicId(value)) {
        fail(field, "A UUID v4 public identifier is required.");
    }
    return value;
}

function validateInvitationToken(value) {
    if (typeof value !== "string" || !INVITATION_TOKEN_PATTERN.test(value)) {
        fail("token", "The invitation token is invalid.");
    }
    return value;
}

module.exports = {
    EMAIL_PATTERN,
    INVITATION_TOKEN_PATTERN,
    exactKeys,
    normalizeEmail,
    plainObject,
    validateCreateStudioPayload,
    validateInvitationPayload,
    validateInvitationToken,
    validateMembershipPatchPayload,
    validatePagination,
    validatePublicId,
    validateStudioPatchPayload,
    validateTimezone
};
