const { ValidationError } = require("../errors/AppError");
const { CalendarDateRangeInvalidError, CalendarRangeTooLargeError } = require("../errors/TrainingCalendarErrors");
const { isPublicId } = require("../domain/studioDomain");
const {
    DEFAULT_PERSONAL_TIMEZONE,
    MAX_CALENDAR_RANGE_DAYS,
    daysBetween,
    isValidDateOnly,
    isValidTimezone,
    isValidWeekInterval,
    isValidWeekday
} = require("../domain/trainingCalendarDomain");

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
    return value;
}

function requiredDateOnly(value, field) {
    if (!isValidDateOnly(value)) {
        fail(field, "A valid date in YYYY-MM-DD format is required.");
    }
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
        parsed.getUTCFullYear() !== year ||
        parsed.getUTCMonth() !== month - 1 ||
        parsed.getUTCDate() !== day
    ) {
        fail(field, "This date does not exist on the calendar.");
    }
    return value;
}

function optionalDateOnly(value, field) {
    if (value === undefined || value === null) return null;
    return requiredDateOnly(value, field);
}

function optionalTimezone(value, field = "timezone") {
    if (value === undefined || value === null) return DEFAULT_PERSONAL_TIMEZONE;
    if (typeof value !== "string" || !isValidTimezone(value)) {
        fail(field, "A valid IANA timezone is required.");
    }
    return value;
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
    if (value === undefined || value === null) return null;
    return requiredString(value, field, maxLength);
}

function optionalBoolean(value, field, fallback = false) {
    if (value === undefined) return fallback;
    if (typeof value !== "boolean") {
        fail(field, "This field must be a boolean.");
    }
    return value;
}

function requiredPublicId(value, field) {
    if (!isPublicId(value)) {
        fail(field, "A UUID v4 public identifier is required.");
    }
    return value;
}

function requiredInteger(value, field, { min, max } = {}) {
    if (!Number.isInteger(value)) {
        fail(field, "This field must be an integer.");
    }
    if (min !== undefined && value < min) {
        fail(field, `This field must be at least ${min}.`);
    }
    if (max !== undefined && value > max) {
        fail(field, `This field must be at most ${max}.`);
    }
    return value;
}

function requiredExpectedRevision(value) {
    return requiredInteger(value, "expectedRevision", { min: 0 });
}

// ---- Read: GET /api/v1/training-calendar ----

function validateCalendarRangeQuery(query = {}) {
    exactKeys(query, ["from", "to", "timezone"]);
    const from = requiredDateOnly(query.from, "from");
    const to = requiredDateOnly(query.to, "to");
    if (to < from) {
        throw new CalendarDateRangeInvalidError({ to: "This field must be on or after from." });
    }
    const rangeDays = daysBetween(from, to) + 1;
    if (rangeDays > MAX_CALENDAR_RANGE_DAYS) {
        throw new CalendarRangeTooLargeError();
    }
    const timezone = optionalTimezone(query.timezone);
    return { from, to, timezone };
}

// ---- Personal calendar mutations ----

// 255, not an arbitrary larger cap: notes only ever end up persisted via a
// linked workouts.notes column (VARCHAR(255), see trainingValidation.js's
// identical LIMITS.notes), so a longer value here would pass validation and
// then fail - or silently truncate - at insert time. See
// docs/STAGE_5A1_UNIFIED_CALENDAR_BACKEND.md for why training_calendar_entries
// itself has no separate notes column.
const WORKOUT_NOTES_MAX_LENGTH = 255;

function validateCreatePersonalEntryPayload(body) {
    exactKeys(body, ["scheduledDate", "title", "notes", "planAsUpcoming", "timezone"]);
    return {
        scheduledDate: requiredDateOnly(body.scheduledDate, "scheduledDate"),
        title: requiredString(body.title, "title", 160),
        notes: optionalString(body.notes, "notes", WORKOUT_NOTES_MAX_LENGTH),
        planAsUpcoming: optionalBoolean(body.planAsUpcoming, "planAsUpcoming", false),
        timezone: optionalTimezone(body.timezone)
    };
}

function validateUpdatePersonalEntryPayload(body) {
    exactKeys(body, ["title", "expectedRevision"], { atLeastOne: true });
    if (body.expectedRevision === undefined) {
        fail("expectedRevision", "This field is required.");
    }
    const changes = { expectedRevision: requiredExpectedRevision(body.expectedRevision) };
    if (body.title !== undefined) changes.title = requiredString(body.title, "title", 160);
    return changes;
}

function validateReschedulePayload(body) {
    exactKeys(body, ["scheduledDate", "expectedRevision", "timezone"]);
    return {
        scheduledDate: requiredDateOnly(body.scheduledDate, "scheduledDate"),
        expectedRevision: requiredExpectedRevision(body.expectedRevision),
        timezone: optionalTimezone(body.timezone)
    };
}

function validateEntryActionPayload(body) {
    exactKeys(body, ["expectedRevision"]);
    if (body.expectedRevision === undefined) {
        fail("expectedRevision", "This field is required.");
    }
    return { expectedRevision: requiredExpectedRevision(body.expectedRevision) };
}

// ---- Schedule rules ----

function validateCreateScheduleRulePayload(body) {
    exactKeys(body, ["programDayId", "weekday", "weekInterval", "anchorDate", "activeFrom", "activeUntil"]);
    const weekday = requiredInteger(body.weekday, "weekday", { min: 0, max: 6 });
    if (!isValidWeekday(weekday)) fail("weekday", "This field must be an integer between 0 and 6.");
    const weekInterval = body.weekInterval === undefined
        ? 1
        : requiredInteger(body.weekInterval, "weekInterval", { min: 1, max: 52 });
    if (!isValidWeekInterval(weekInterval)) fail("weekInterval", "This field must be an integer between 1 and 52.");
    const activeFrom = requiredDateOnly(body.activeFrom, "activeFrom");
    const activeUntil = optionalDateOnly(body.activeUntil, "activeUntil");
    if (activeUntil && activeUntil < activeFrom) {
        fail("activeUntil", "This field must be on or after activeFrom.");
    }
    // anchorDate defaults to activeFrom, but either way it must itself land
    // on `weekday` - it establishes the unambiguous "week 0" for the
    // weekInterval calculation (see trainingCalendarDomain.js#scheduleRuleOccursOn),
    // so it can never be a day the rule itself would never fire on.
    const anchorDate = optionalDateOnly(body.anchorDate, "anchorDate") || activeFrom;
    return {
        programDayId: requiredPublicId(body.programDayId, "programDayId"),
        weekday,
        weekInterval,
        anchorDate,
        activeFrom,
        activeUntil
    };
}

function validateScheduleRulePatchPayload(body) {
    exactKeys(body, ["weekday", "weekInterval", "anchorDate", "activeFrom", "activeUntil", "status"], { atLeastOne: true });
    const changes = {};
    if (body.weekday !== undefined) {
        changes.weekday = requiredInteger(body.weekday, "weekday", { min: 0, max: 6 });
    }
    if (body.weekInterval !== undefined) {
        changes.weekInterval = requiredInteger(body.weekInterval, "weekInterval", { min: 1, max: 52 });
    }
    if (body.anchorDate !== undefined) {
        changes.anchorDate = requiredDateOnly(body.anchorDate, "anchorDate");
    }
    if (body.activeFrom !== undefined) {
        changes.activeFrom = requiredDateOnly(body.activeFrom, "activeFrom");
    }
    if (body.activeUntil !== undefined) {
        changes.activeUntil = optionalDateOnly(body.activeUntil, "activeUntil");
    }
    if (body.status !== undefined) {
        if (body.status !== "active" && body.status !== "disabled") {
            fail("status", "Allowed values are: active, disabled.");
        }
        changes.status = body.status;
    }
    return changes;
}

module.exports = {
    exactKeys,
    fail,
    plainObject,
    validateCalendarRangeQuery,
    validateCreatePersonalEntryPayload,
    validateCreateScheduleRulePayload,
    validateEntryActionPayload,
    validateReschedulePayload,
    validateScheduleRulePatchPayload,
    validateUpdatePersonalEntryPayload
};
