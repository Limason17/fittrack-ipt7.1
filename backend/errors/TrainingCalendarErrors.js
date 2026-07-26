const { AppError } = require("./AppError");

class CalendarDateRangeInvalidError extends AppError {
    constructor(fields) {
        super({
            status: 400,
            code: "CALENDAR_DATE_RANGE_INVALID",
            message: "from/to must be valid dates with from on or before to.",
            fields
        });
    }
}

class CalendarRangeTooLargeError extends AppError {
    constructor() {
        super({
            status: 400,
            code: "CALENDAR_RANGE_TOO_LARGE",
            message: "The requested date range is too large."
        });
    }
}

// Deliberately identical for "does not exist" and "exists but is not yours
// or not visible in this context" - matches the rest of this codebase's
// tenant/ownership 404 convention (see studioService.js#loadStudioContext),
// so a calendar entry ID never discloses whether it belongs to someone
// else.
class CalendarEntryNotFoundError extends AppError {
    constructor() {
        super({ status: 404, code: "CALENDAR_ENTRY_NOT_FOUND", message: "Calendar entry not found." });
    }
}

// Reserved for a role/relationship-based rejection where the actor's
// membership itself is visible and legitimate (mirrors
// InsufficientStudioRoleError) - never used for "this belongs to a
// different user", which is always CalendarEntryNotFoundError instead.
class CalendarEntryForbiddenError extends AppError {
    constructor() {
        super({ status: 403, code: "CALENDAR_ENTRY_FORBIDDEN", message: "Not allowed to manage this calendar resource." });
    }
}

class CalendarInvalidTransitionError extends AppError {
    constructor() {
        super({
            status: 409,
            code: "CALENDAR_INVALID_TRANSITION",
            message: "This status change is not allowed for the current entry state."
        });
    }
}

class CalendarEntryConflictError extends AppError {
    constructor() {
        super({
            status: 409,
            code: "CALENDAR_ENTRY_CONFLICT",
            message: "The calendar entry was changed by another request. Reload and try again."
        });
    }
}

class CalendarWorkoutAlreadyLinkedError extends AppError {
    constructor() {
        super({
            status: 409,
            code: "CALENDAR_WORKOUT_ALREADY_LINKED",
            message: "This calendar entry is already linked to a different workout."
        });
    }
}

class CalendarScheduleRuleConflictError extends AppError {
    constructor() {
        super({
            status: 409,
            code: "CALENDAR_SCHEDULE_RULE_CONFLICT",
            message: "An active schedule rule already covers this program day and weekday."
        });
    }
}

class CalendarScheduleRuleNotFoundError extends AppError {
    constructor() {
        super({ status: 404, code: "CALENDAR_SCHEDULE_RULE_NOT_FOUND", message: "Schedule rule not found." });
    }
}

class CalendarAssignmentInactiveError extends AppError {
    constructor() {
        super({
            status: 409,
            code: "CALENDAR_ASSIGNMENT_INACTIVE",
            message: "This program assignment is not active."
        });
    }
}

class CalendarProgramDayInvalidError extends AppError {
    constructor() {
        super({
            status: 409,
            code: "CALENDAR_PROGRAM_DAY_INVALID",
            message: "The referenced program day does not belong to this assignment's program version."
        });
    }
}

class CalendarTimezoneInvalidError extends AppError {
    constructor(fields) {
        super({
            status: 400,
            code: "CALENDAR_TIMEZONE_INVALID",
            message: "A valid IANA timezone is required.",
            fields
        });
    }
}

module.exports = {
    CalendarAssignmentInactiveError,
    CalendarDateRangeInvalidError,
    CalendarEntryConflictError,
    CalendarEntryForbiddenError,
    CalendarEntryNotFoundError,
    CalendarInvalidTransitionError,
    CalendarProgramDayInvalidError,
    CalendarRangeTooLargeError,
    CalendarScheduleRuleConflictError,
    CalendarScheduleRuleNotFoundError,
    CalendarTimezoneInvalidError,
    CalendarWorkoutAlreadyLinkedError
};
