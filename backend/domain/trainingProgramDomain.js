const COACHING_STATUSES = Object.freeze(["active", "ended"]);
const PROGRAM_STATUSES = Object.freeze(["draft", "active", "archived"]);
const PROGRAM_VERSION_STATUSES = Object.freeze(["draft", "published", "retired"]);
const ASSIGNMENT_STATUSES = Object.freeze(["active", "completed", "cancelled"]);
const MUTABLE_ASSIGNMENT_STATUSES = Object.freeze(["completed", "cancelled"]);

const COACH_ELIGIBLE_ROLES = Object.freeze(["owner", "admin", "trainer"]);

function isPositiveInteger(value) {
    return Number.isSafeInteger(value) && value > 0;
}

module.exports = {
    ASSIGNMENT_STATUSES,
    COACHING_STATUSES,
    COACH_ELIGIBLE_ROLES,
    MUTABLE_ASSIGNMENT_STATUSES,
    PROGRAM_STATUSES,
    PROGRAM_VERSION_STATUSES,
    isPositiveInteger
};
