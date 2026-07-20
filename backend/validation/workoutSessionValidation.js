const { ValidationError } = require("../errors/AppError");
const { isPublicId } = require("../domain/studioDomain");

const LIMITS = Object.freeze({
    memberNote: 500,
    clientStartKey: 100,
    actualReps: 100,
    actualWeight: 999.99,
    actualDurationMinutes: 600,
    actualDistanceKm: 999.99,
    actualRpe: 10
});

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

function optionalString(value, field, maxLength) {
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value !== "string") {
        fail(field, "This field must be a string.");
    }
    const normalized = value.trim();
    if (normalized.length > maxLength) {
        fail(field, `This field must contain at most ${maxLength} characters.`);
    }
    return normalized || null;
}

function requiredChoice(value, field, allowed) {
    if (typeof value !== "string" || !allowed.includes(value)) {
        fail(field, `Allowed values are: ${allowed.join(", ")}.`);
    }
    return value;
}

function requiredPublicId(value, field) {
    if (!isPublicId(value)) {
        fail(field, "A UUID v4 public identifier is required.");
    }
    return value;
}

function requiredNonNegativeInteger(value, field) {
    if (!Number.isSafeInteger(value) || value < 0) {
        fail(field, "This field must be a non-negative integer.");
    }
    return value;
}

function optionalNumber(value, field, { integer = false, min = 0, max } = {}) {
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
        fail(field, "This field must be a finite number.");
    }
    if (integer && !Number.isInteger(value)) {
        fail(field, "This field must be an integer.");
    }
    if (value < min || (max !== undefined && value > max)) {
        const range = max === undefined ? `at least ${min}` : `between ${min} and ${max}`;
        fail(field, `This field must be ${range}.`);
    }
    return value;
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

// ---- Start a workout session ----

function validateStartSessionPayload(body) {
    exactKeys(body, ["programDayId", "clientStartKey"]);
    return {
        programDayId: requiredPublicId(body.programDayId, "programDayId"),
        clientStartKey: requiredString(body.clientStartKey, "clientStartKey", LIMITS.clientStartKey)
    };
}

// ---- List own workout sessions ----

function validateListOwnSessionsQuery(query = {}) {
    exactKeys(query, ["page", "limit", "status", "assignmentId", "programDayId"]);
    const page = positiveQueryInteger(query.page, "page", 1, 1_000_000);
    const limit = positiveQueryInteger(query.limit, "limit", 20, 100);
    const result = { page, limit, offset: (page - 1) * limit };
    if (Object.hasOwn(query, "status")) {
        result.status = requiredChoice(query.status, "status", ["in_progress", "completed", "aborted"]);
    }
    if (Object.hasOwn(query, "assignmentId")) {
        result.assignmentId = requiredPublicId(query.assignmentId, "assignmentId");
    }
    if (Object.hasOwn(query, "programDayId")) {
        result.programDayId = requiredPublicId(query.programDayId, "programDayId");
    }
    return result;
}

// ---- Session note (autosave) ----

function validateSessionPatchPayload(body) {
    exactKeys(body, ["memberNote", "expectedRevision"]);
    if (!Object.hasOwn(body, "expectedRevision")) {
        fail("expectedRevision", "This field is required.");
    }
    if (!Object.hasOwn(body, "memberNote")) {
        fail("memberNote", "This field is required.");
    }
    return {
        member_note: optionalString(body.memberNote, "memberNote", LIMITS.memberNote),
        expectedRevision: requiredNonNegativeInteger(body.expectedRevision, "expectedRevision")
    };
}

// ---- Session exercise ----

function validateSessionExercisePatchPayload(body) {
    exactKeys(body, ["status", "memberNote", "expectedRevision"]);
    if (!Object.hasOwn(body, "expectedRevision")) {
        fail("expectedRevision", "This field is required.");
    }
    if (!Object.hasOwn(body, "status") && !Object.hasOwn(body, "memberNote")) {
        fail("body", "At least one of status or memberNote is required.");
    }
    const result = { expectedRevision: requiredNonNegativeInteger(body.expectedRevision, "expectedRevision") };
    if (Object.hasOwn(body, "status")) {
        result.status = requiredChoice(body.status, "status", ["pending", "completed", "skipped"]);
    }
    if (Object.hasOwn(body, "memberNote")) {
        result.member_note = optionalString(body.memberNote, "memberNote", LIMITS.memberNote);
    }
    return result;
}

// ---- Session set ----

function validateCreateSetPayload(body) {
    exactKeys(body, []);
    return {};
}

function validateSessionSetPatchPayload(body) {
    exactKeys(body, [
        "status",
        "actualReps",
        "actualWeight",
        "actualDurationMinutes",
        "actualDistanceKm",
        "actualRpe",
        "memberNote",
        "expectedRevision"
    ]);
    if (!Object.hasOwn(body, "expectedRevision")) {
        fail("expectedRevision", "This field is required.");
    }
    const contentFields = [
        "status", "actualReps", "actualWeight", "actualDurationMinutes", "actualDistanceKm", "actualRpe", "memberNote"
    ];
    if (!contentFields.some((field) => Object.hasOwn(body, field))) {
        fail("body", "At least one result field is required.");
    }

    const result = { expectedRevision: requiredNonNegativeInteger(body.expectedRevision, "expectedRevision") };
    if (Object.hasOwn(body, "status")) {
        result.status = requiredChoice(body.status, "status", ["pending", "completed", "skipped"]);
    }
    if (Object.hasOwn(body, "actualReps")) {
        result.actual_reps = optionalNumber(body.actualReps, "actualReps", { integer: true, max: LIMITS.actualReps });
    }
    if (Object.hasOwn(body, "actualWeight")) {
        result.actual_weight = optionalNumber(body.actualWeight, "actualWeight", { max: LIMITS.actualWeight });
    }
    if (Object.hasOwn(body, "actualDurationMinutes")) {
        result.actual_duration_minutes = optionalNumber(
            body.actualDurationMinutes, "actualDurationMinutes", { integer: true, max: LIMITS.actualDurationMinutes }
        );
    }
    if (Object.hasOwn(body, "actualDistanceKm")) {
        result.actual_distance_km = optionalNumber(body.actualDistanceKm, "actualDistanceKm", { max: LIMITS.actualDistanceKm });
    }
    if (Object.hasOwn(body, "actualRpe")) {
        result.actual_rpe = optionalNumber(body.actualRpe, "actualRpe", { max: LIMITS.actualRpe });
    }
    if (Object.hasOwn(body, "memberNote")) {
        result.member_note = optionalString(body.memberNote, "memberNote", LIMITS.memberNote);
    }
    return result;
}

// ---- List a coached member's workout sessions ----

function validateListCoachedSessionsQuery(query = {}) {
    exactKeys(query, ["page", "limit", "status"]);
    const page = positiveQueryInteger(query.page, "page", 1, 1_000_000);
    const limit = positiveQueryInteger(query.limit, "limit", 20, 100);
    const result = { page, limit, offset: (page - 1) * limit };
    if (Object.hasOwn(query, "status")) {
        result.status = requiredChoice(query.status, "status", ["in_progress", "completed", "aborted"]);
    }
    return result;
}

module.exports = {
    LIMITS,
    validateCreateSetPayload,
    validateListCoachedSessionsQuery,
    validateListOwnSessionsQuery,
    validateSessionExercisePatchPayload,
    validateSessionPatchPayload,
    validateSessionSetPatchPayload,
    validateStartSessionPayload
};
