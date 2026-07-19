const SESSION_STATUSES = Object.freeze(["in_progress", "completed", "aborted"]);
const TERMINAL_SESSION_STATUSES = Object.freeze(["completed", "aborted"]);
const SESSION_EXERCISE_STATUSES = Object.freeze(["pending", "completed", "skipped"]);
const SESSION_SET_STATUSES = Object.freeze(["pending", "completed", "skipped"]);

function isPositiveInteger(value) {
    return Number.isSafeInteger(value) && value > 0;
}

function isTerminalSessionStatus(status) {
    return TERMINAL_SESSION_STATUSES.includes(status);
}

function hasAnyResultMetric(set) {
    return (
        set.actualReps !== null && set.actualReps !== undefined ||
        set.actualWeight !== null && set.actualWeight !== undefined ||
        set.actualDurationMinutes !== null && set.actualDurationMinutes !== undefined ||
        set.actualDistanceKm !== null && set.actualDistanceKm !== undefined ||
        set.actualRpe !== null && set.actualRpe !== undefined
    );
}

module.exports = {
    SESSION_EXERCISE_STATUSES,
    SESSION_SET_STATUSES,
    SESSION_STATUSES,
    TERMINAL_SESSION_STATUSES,
    hasAnyResultMetric,
    isPositiveInteger,
    isTerminalSessionStatus
};
