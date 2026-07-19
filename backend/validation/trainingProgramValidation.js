const { ValidationError } = require("../errors/AppError");
const { isPublicId } = require("../domain/studioDomain");

const LIMITS = Object.freeze({
    programName: 120,
    programDescription: 500,
    versionNotes: 500,
    dayName: 120,
    dayInstructions: 1000,
    exerciseName: 80,
    exerciseInstructions: 500,
    targetSets: 20,
    targetReps: 100,
    targetWeight: 999.99,
    targetDurationMinutes: 600,
    targetDistanceKm: 999.99,
    targetRpe: 10,
    restSeconds: 3600
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

function requiredPublicId(value, field) {
    if (!isPublicId(value)) {
        fail(field, "A UUID v4 public identifier is required.");
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

function optionalPositiveInteger(value, field, max = Number.MAX_SAFE_INTEGER) {
    return optionalNumber(value, field, { integer: true, min: 1, max });
}

function validateDate(value, field) {
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        fail(field, "A valid date in YYYY-MM-DD format is required.");
    }
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
        parsed.getUTCFullYear() !== year ||
        parsed.getUTCMonth() !== month - 1 ||
        parsed.getUTCDate() !== day
    ) {
        fail(field, "The date does not represent a calendar day.");
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

function validatePagination(query = {}) {
    exactKeys(query, ["page", "limit"]);
    const page = positiveQueryInteger(query.page, "page", 1, 1_000_000);
    const limit = positiveQueryInteger(query.limit, "limit", 20, 100);
    return { page, limit, offset: (page - 1) * limit };
}

// ---- Coaching relationships ----

function validateCoachingRelationshipPayload(body) {
    exactKeys(body, ["coachMembershipId", "memberMembershipId"]);
    return {
        coachMembershipId: requiredPublicId(body.coachMembershipId, "coachMembershipId"),
        memberMembershipId: requiredPublicId(body.memberMembershipId, "memberMembershipId")
    };
}

function validateCoachingRelationshipPatchPayload(body) {
    exactKeys(body, ["status"], { atLeastOne: true });
    return {
        status: requiredChoice(body.status, "status", ["ended"])
    };
}

// ---- Training programs ----

function validateCreateProgramPayload(body) {
    exactKeys(body, ["name", "description"]);
    return {
        name: requiredString(body.name, "name", LIMITS.programName),
        description: optionalString(body.description, "description", LIMITS.programDescription)
    };
}

function validateProgramPatchPayload(body) {
    exactKeys(body, ["name", "description", "status"], { atLeastOne: true });
    const result = {};
    if (Object.hasOwn(body, "name")) result.name = requiredString(body.name, "name", LIMITS.programName);
    if (Object.hasOwn(body, "description")) {
        result.description = optionalString(body.description, "description", LIMITS.programDescription);
    }
    if (Object.hasOwn(body, "status")) {
        result.status = requiredChoice(body.status, "status", ["archived"]);
    }
    return result;
}

// ---- Program versions ----

function validateCreateVersionPayload(body) {
    exactKeys(body, ["notes"]);
    return {
        notes: optionalString(body.notes, "notes", LIMITS.versionNotes)
    };
}

function validateVersionPatchPayload(body) {
    exactKeys(body, ["notes"], { atLeastOne: true });
    return {
        notes: optionalString(body.notes, "notes", LIMITS.versionNotes)
    };
}

// ---- Program days ----

function validateCreateDayPayload(body) {
    exactKeys(body, ["name", "instructions"]);
    return {
        name: requiredString(body.name, "name", LIMITS.dayName),
        instructions: optionalString(body.instructions, "instructions", LIMITS.dayInstructions)
    };
}

function validateDayPatchPayload(body) {
    exactKeys(body, ["name", "instructions", "position"], { atLeastOne: true });
    const result = {};
    if (Object.hasOwn(body, "name")) result.name = requiredString(body.name, "name", LIMITS.dayName);
    if (Object.hasOwn(body, "instructions")) {
        result.instructions = optionalString(body.instructions, "instructions", LIMITS.dayInstructions);
    }
    if (Object.hasOwn(body, "position")) {
        result.position = optionalPositiveInteger(body.position, "position", 1000);
        if (result.position === null) fail("position", "This field must be a positive integer.");
    }
    return result;
}

// ---- Program exercises ----

function validateCreateExercisePayload(body) {
    exactKeys(body, [
        "exerciseNameSnapshot",
        "instructions",
        "targetSets",
        "targetRepsMin",
        "targetRepsMax",
        "targetWeight",
        "targetDurationMinutes",
        "targetDistanceKm",
        "targetRpe",
        "restSeconds"
    ]);
    return buildExerciseFields(body, { requireName: true });
}

function validateExercisePatchPayload(body) {
    exactKeys(body, [
        "exerciseNameSnapshot",
        "instructions",
        "targetSets",
        "targetRepsMin",
        "targetRepsMax",
        "targetWeight",
        "targetDurationMinutes",
        "targetDistanceKm",
        "targetRpe",
        "restSeconds",
        "position"
    ], { atLeastOne: true });
    const result = buildExerciseFields(body, { requireName: false, partial: true });
    if (Object.hasOwn(body, "position")) {
        const position = optionalPositiveInteger(body.position, "position", 1000);
        if (position === null) fail("position", "This field must be a positive integer.");
        result.position = position;
    }
    return result;
}

function buildExerciseFields(body, { requireName, partial = false }) {
    const result = {};
    if (requireName || Object.hasOwn(body, "exerciseNameSnapshot")) {
        result.exercise_name_snapshot = requiredString(
            body.exerciseNameSnapshot, "exerciseNameSnapshot", LIMITS.exerciseName
        );
    }
    if (!partial || Object.hasOwn(body, "instructions")) {
        result.instructions = optionalString(body.instructions, "instructions", LIMITS.exerciseInstructions);
    }
    if (!partial || Object.hasOwn(body, "targetSets")) {
        result.target_sets = optionalPositiveInteger(body.targetSets, "targetSets", LIMITS.targetSets);
    }
    if (!partial || Object.hasOwn(body, "targetRepsMin")) {
        result.target_reps_min = optionalPositiveInteger(body.targetRepsMin, "targetRepsMin", LIMITS.targetReps);
    }
    if (!partial || Object.hasOwn(body, "targetRepsMax")) {
        result.target_reps_max = optionalPositiveInteger(body.targetRepsMax, "targetRepsMax", LIMITS.targetReps);
    }
    if (
        result.target_reps_min !== undefined && result.target_reps_max !== undefined &&
        result.target_reps_min !== null && result.target_reps_max !== null &&
        result.target_reps_max < result.target_reps_min
    ) {
        fail("targetRepsMax", "This field must be greater than or equal to targetRepsMin.");
    }
    if (!partial || Object.hasOwn(body, "targetWeight")) {
        result.target_weight = optionalNumber(body.targetWeight, "targetWeight", { max: LIMITS.targetWeight });
    }
    if (!partial || Object.hasOwn(body, "targetDurationMinutes")) {
        result.target_duration_minutes = optionalPositiveInteger(
            body.targetDurationMinutes, "targetDurationMinutes", LIMITS.targetDurationMinutes
        );
    }
    if (!partial || Object.hasOwn(body, "targetDistanceKm")) {
        result.target_distance_km = optionalNumber(
            body.targetDistanceKm, "targetDistanceKm", { max: LIMITS.targetDistanceKm }
        );
    }
    if (!partial || Object.hasOwn(body, "targetRpe")) {
        result.target_rpe = optionalNumber(body.targetRpe, "targetRpe", { max: LIMITS.targetRpe });
    }
    if (!partial || Object.hasOwn(body, "restSeconds")) {
        result.rest_seconds = optionalNumber(
            body.restSeconds, "restSeconds", { integer: true, max: LIMITS.restSeconds }
        );
    }
    return result;
}

// ---- Program assignments ----

function validateCreateAssignmentPayload(body) {
    exactKeys(body, ["programVersionId", "memberMembershipId", "startsOn", "endsOn"]);
    const startsOn = validateDate(body.startsOn, "startsOn");
    const endsOn = validateDate(body.endsOn, "endsOn");
    if (startsOn && endsOn && endsOn < startsOn) {
        fail("endsOn", "This field must be on or after startsOn.");
    }
    return {
        programVersionId: requiredPublicId(body.programVersionId, "programVersionId"),
        memberMembershipId: requiredPublicId(body.memberMembershipId, "memberMembershipId"),
        starts_on: startsOn,
        ends_on: endsOn
    };
}

function validateAssignmentPatchPayload(body) {
    exactKeys(body, ["status"], { atLeastOne: true });
    return {
        status: requiredChoice(body.status, "status", ["completed", "cancelled"])
    };
}

function validatePublicId(value, field = "id") {
    if (!isPublicId(value)) {
        fail(field, "A UUID v4 public identifier is required.");
    }
    return value;
}

module.exports = {
    LIMITS,
    exactKeys,
    plainObject,
    validateAssignmentPatchPayload,
    validateCoachingRelationshipPatchPayload,
    validateCoachingRelationshipPayload,
    validateCreateAssignmentPayload,
    validateCreateDayPayload,
    validateCreateExercisePayload,
    validateCreateProgramPayload,
    validateCreateVersionPayload,
    validateDayPatchPayload,
    validateExercisePatchPayload,
    validatePagination,
    validateProgramPatchPayload,
    validatePublicId,
    validateVersionPatchPayload
};
