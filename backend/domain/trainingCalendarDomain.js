const CALENDAR_ENTRY_STATUSES = Object.freeze(["PLANNED", "IN_PROGRESS", "COMPLETED", "SKIPPED", "CANCELLED"]);
const CALENDAR_DISPLAY_STATUSES = Object.freeze([
    "PLANNED", "DUE_TODAY", "OVERDUE", "IN_PROGRESS", "COMPLETED", "SKIPPED", "CANCELLED"
]);
const CALENDAR_SOURCE_TYPES = Object.freeze(["personal", "studio"]);
const CALENDAR_ENTRY_ACTIONS = Object.freeze([
    "START", "COMPLETE", "SKIP", "CANCEL", "RESCHEDULE", "VIEW_WORKOUT"
]);
const MAX_CALENDAR_RANGE_DAYS = 93;

// No persisted per-user timezone exists anywhere in this schema (see
// docs/STAGE_5A1_UNIFIED_CALENDAR_BACKEND.md, "Zeitzonenvertrag") and Stage
// 5A1 is explicitly not the phase to add one. This mirrors
// studios.default_timezone's own default (005_studio_tenancy_and_rbac.js)
// so a personal event and a studio event created by the same person on the
// same physical day land on the same calendar date by default.
const DEFAULT_PERSONAL_TIMEZONE = "Europe/Zurich";

// Only meaningful when weekInterval > 1: the rule's "week 0" is the ISO week
// containing anchorDate, and anchorDate must fall on `weekday` itself (see
// validateScheduleRulePayload) so "every 2nd week" has one unambiguous
// starting point instead of depending on which day someone happened to open
// the rule-creation form.
function isValidWeekday(value) {
    return Number.isInteger(value) && value >= 0 && value <= 6;
}

function isValidWeekInterval(value) {
    return Number.isInteger(value) && value >= 1 && value <= 52;
}

function isValidDateOnly(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidTimezone(value) {
    if (typeof value !== "string" || value.length === 0 || value.length > 64) {
        return false;
    }
    try {
        // eslint-disable-next-line no-new
        new Intl.DateTimeFormat("en", { timeZone: value }).format();
        return true;
    } catch {
        return false;
    }
}

// Deliberately never `new Date().toISOString().slice(0, 10)` (Section 9 of
// the Stage 5A1 brief forbids exactly that): that always yields the UTC
// calendar date, which is wrong for any zone with a non-zero offset near
// midnight. The en-CA locale formats as YYYY-MM-DD directly, so no manual
// component reordering or arithmetic is needed, and Intl's own tz database
// (not this code) resolves DST - verified against both a DST-transition
// instant and a late-night-UTC/already-next-day-locally instant in this
// module's own unit tests.
function todayInTimezone(timezone, now = new Date()) {
    if (!isValidTimezone(timezone)) {
        throw new TypeError("todayInTimezone requires a valid IANA timezone.");
    }
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).format(now);
}

// PLANNED is the only persisted status with a date-dependent display form;
// every other persisted status is already an unambiguous terminal or active
// state and passes through unchanged. Never written back to the database -
// see docs/STAGE_5A1_UNIFIED_CALENDAR_BACKEND.md, "Display Status".
function deriveDisplayStatus(status, scheduledDate, today) {
    if (status !== "PLANNED") {
        return status;
    }
    if (scheduledDate === today) {
        return "DUE_TODAY";
    }
    if (scheduledDate < today) {
        return "OVERDUE";
    }
    return "PLANNED";
}

// Central status-transition matrix (Section 14). IN_PROGRESS -> PLANNED
// models a workout-session abort reverting an occurrence back to plannable
// (see workoutSessionService.js integration) rather than leaving it stuck.
// COMPLETED/SKIPPED/CANCELLED are all terminal for this phase - no
// "reschedule a skipped/cancelled entry" support is implemented yet
// (Section 14 marks that transition as optional/"nur falls ausdrücklich
// unterstützt", and this phase does not build explicit support for it).
const ALLOWED_TRANSITIONS = Object.freeze({
    PLANNED: Object.freeze(new Set(["PLANNED", "IN_PROGRESS", "COMPLETED", "SKIPPED", "CANCELLED"])),
    IN_PROGRESS: Object.freeze(new Set(["COMPLETED", "PLANNED"])),
    COMPLETED: Object.freeze(new Set()),
    SKIPPED: Object.freeze(new Set()),
    CANCELLED: Object.freeze(new Set())
});

function canTransitionCalendarStatus(fromStatus, toStatus) {
    const allowed = ALLOWED_TRANSITIONS[fromStatus];
    return Boolean(allowed && allowed.has(toStatus));
}

// Section 4's personal default-status rules, centralized so both the create
// and the (future) status-recompute paths use one implementation. A
// personal entry never passes through IN_PROGRESS - there is no session
// concept for a manually-logged entry (see docs, "Persönliche
// Workout-Integration"). `planAsUpcoming` is the "ausdrückliche Option"
// required by Section 4 for today; it is inert for past/future dates -
// the future is always PLANNED and the past is always COMPLETED regardless
// of what a client sends, which is what keeps this server-authoritative.
function resolvePersonalCreationStatus({ scheduledDate, today, planAsUpcoming = false }) {
    if (scheduledDate > today) {
        return "PLANNED";
    }
    if (scheduledDate === today) {
        return planAsUpcoming ? "PLANNED" : "COMPLETED";
    }
    return "COMPLETED";
}

// weekday: 0=Monday..6=Sunday, matching the existing Monday-first convention
// already used by frontend/src/views/WorkoutsView.vue's calendar grid
// (`(firstDay.getDay() + 6) % 7`) - kept identical so a future shared
// frontend calendar component never has to reconcile two different weekday
// numbering schemes for the same product.
function isoWeekdayOf(dateOnly) {
    const date = new Date(`${dateOnly}T00:00:00Z`);
    return (date.getUTCDay() + 6) % 7;
}

function addDays(dateOnly, days) {
    const date = new Date(`${dateOnly}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function daysBetween(fromDateOnly, toDateOnly) {
    const from = new Date(`${fromDateOnly}T00:00:00Z`).getTime();
    const to = new Date(`${toDateOnly}T00:00:00Z`).getTime();
    return Math.round((to - from) / 86400000);
}

// Pure decision: does this recurring rule produce an occurrence on this
// specific calendar date? Used both by materialization (Section 7/8) and by
// tests exercising the weekday/interval math in isolation, without ever
// touching a database.
function scheduleRuleOccursOn(rule, dateOnly) {
    if (dateOnly < rule.activeFrom) return false;
    if (rule.activeUntil && dateOnly > rule.activeUntil) return false;
    if (isoWeekdayOf(dateOnly) !== rule.weekday) return false;
    if (rule.weekInterval <= 1) return true;
    const diffDays = daysBetween(rule.anchorDate, dateOnly);
    const diffWeeks = Math.floor(diffDays / 7);
    return ((diffWeeks % rule.weekInterval) + rule.weekInterval) % rule.weekInterval === 0;
}

// Bounded by construction: callers always pass a [from, to] pair already
// capped at MAX_CALENDAR_RANGE_DAYS (Section 11), so this is at most ~93
// iterations per rule, never unbounded - see "Vermeidung unendlicher
// Materialisierung" in the Stage 5A1 doc for the full argument.
function scheduleRuleDatesInRange(rule, rangeFrom, rangeTo) {
    const start = rangeFrom > rule.activeFrom ? rangeFrom : rule.activeFrom;
    const end = rule.activeUntil && rule.activeUntil < rangeTo ? rule.activeUntil : rangeTo;
    const dates = [];
    if (start > end) return dates;
    let cursor = start;
    while (cursor <= end) {
        if (scheduleRuleOccursOn(rule, cursor)) {
            dates.push(cursor);
        }
        cursor = addDays(cursor, 1);
    }
    return dates;
}

// Server-derived, never trusted from the client (Section 11: "Keine
// UI-Berechtigungslogik als einzige Schutzschicht"). `hasLinkedWorkout`
// covers both a real training_calendar_entries.personal_workout_id/
// studio_workout_session_id link AND the synthesized legacy-workout rows
// from the unified read model (Section 15) - both render VIEW_WORKOUT
// identically from the client's perspective.
function deriveAvailableActions({ displayStatus, sourceType, hasLinkedWorkout = false }) {
    switch (displayStatus) {
        case "PLANNED":
        case "DUE_TODAY":
        case "OVERDUE":
            return sourceType === "studio"
                ? Object.freeze(["START", "SKIP", "CANCEL"])
                : Object.freeze(["COMPLETE", "SKIP", "CANCEL", "RESCHEDULE"]);
        case "IN_PROGRESS":
            return Object.freeze(["COMPLETE", "VIEW_WORKOUT"]);
        case "COMPLETED":
            return hasLinkedWorkout ? Object.freeze(["VIEW_WORKOUT"]) : Object.freeze([]);
        case "SKIPPED":
        case "CANCELLED":
        default:
            return Object.freeze([]);
    }
}

module.exports = {
    ALLOWED_TRANSITIONS,
    CALENDAR_DISPLAY_STATUSES,
    CALENDAR_ENTRY_ACTIONS,
    CALENDAR_ENTRY_STATUSES,
    CALENDAR_SOURCE_TYPES,
    DEFAULT_PERSONAL_TIMEZONE,
    MAX_CALENDAR_RANGE_DAYS,
    addDays,
    canTransitionCalendarStatus,
    daysBetween,
    deriveAvailableActions,
    deriveDisplayStatus,
    isValidDateOnly,
    isValidTimezone,
    isValidWeekInterval,
    isValidWeekday,
    isoWeekdayOf,
    resolvePersonalCreationStatus,
    scheduleRuleDatesInRange,
    scheduleRuleOccursOn,
    todayInTimezone
};
