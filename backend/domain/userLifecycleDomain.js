const crypto = require("node:crypto");

// Stage 5C1 (docs/STAGE_5C_PERSONAL_DATA_LIFECYCLE_DESIGN.md Section 10,
// ADR 004): exactly two lifecycle states, one allowed transition. No
// `deletion_reason` - this phase has exactly one deletion trigger
// (self-service), see Migration 013's own comment and ADR 004's
// "Consequences" section.
const LIFECYCLE_STATUSES = Object.freeze(["active", "deleted"]);

const ALLOWED_LIFECYCLE_TRANSITIONS = Object.freeze({
    active: Object.freeze(new Set(["deleted"])),
    deleted: Object.freeze(new Set())
});

// The reserved, never-resolvable .invalid TLD (RFC 2606) - a real mail
// server will never route to it, and it can never be legitimately
// registered by anyone, so an anonymized placeholder can never collide
// with a real, deliverable address.
const ANONYMIZED_EMAIL_DOMAIN = "deleted.fittrack.invalid";
const ANONYMIZED_USERNAME_PREFIX = "deleted-user-";
const ANONYMIZED_EMAIL_LOCAL_PREFIX = "deleted-";

const DELETED_MEMBER_DISPLAY_NAME = Object.freeze({
    de: "Gelöschtes Mitglied",
    en: "Deleted member"
});

function isValidLifecycleStatus(value) {
    return LIFECYCLE_STATUSES.includes(value);
}

function isActiveLifecycleStatus(status) {
    return status === "active";
}

function isDeletedLifecycleStatus(status) {
    return status === "deleted";
}

function isTerminalLifecycleStatus(status) {
    return isValidLifecycleStatus(status) && ALLOWED_LIFECYCLE_TRANSITIONS[status].size === 0;
}

function canTransitionLifecycleStatus(from, to) {
    if (!isValidLifecycleStatus(from) || !isValidLifecycleStatus(to)) {
        return false;
    }
    return ALLOWED_LIFECYCLE_TRANSITIONS[from].has(to);
}

// Exact COUNT(*) FROM studio_memberships WHERE user_id=? - Section 8.4's
// "the check must be exact" requirement: even a single historical `left`
// row counts, since the membership row itself still exists and still
// carries the RESTRICT foreign key that blocks a hard delete.
function hasNoStudioHistory(membershipRowCount) {
    if (!Number.isInteger(membershipRowCount) || membershipRowCount < 0) {
        throw new TypeError("membershipRowCount must be a non-negative integer.");
    }
    return membershipRowCount === 0;
}

function isHardDeleteEligible(membershipRowCount) {
    return hasNoStudioHistory(membershipRowCount);
}

// Section 8's retention classification, expressed as a pure lookup so it is
// independently unit-testable (Section 25.1) - the actual deletion
// transaction (accountDeletionService.js) does not dynamically dispatch on
// this map, it hardcodes each step per the Section 18.2 sequence, but the
// classification itself must stay consistent with that hardcoded sequence.
const DELETION_STRATEGY_BY_TABLE = Object.freeze({
    users: "anonymize_or_hard_delete",
    workouts: "hard_delete",
    workout_exercises: "hard_delete",
    progress_entries: "hard_delete",
    // Personal (user_id = actor) rows only - global (user_id IS NULL) rows
    // in this same table are never touched (Merge-gate finding #1: hard-
    // deleting the account without first hard-deleting personal exercises
    // would leak them into the global library via exercises.user_id's
    // ON DELETE SET NULL, since GET /exercises treats every NULL-owner row
    // as globally visible).
    exercises: "hard_delete",
    user_auth_sessions: "hard_delete",
    user_refresh_tokens: "hard_delete",
    user_email_change_requests: "hard_delete",
    studio_memberships: "retain_unchanged",
    studio_coaching_relationships: "retain_unchanged",
    studio_program_assignments: "retain_unchanged",
    studio_assignment_schedule_rules: "retain_unchanged",
    studio_workout_sessions: "retain_unchanged",
    studio_workout_session_exercises: "retain_unchanged",
    studio_workout_session_sets: "retain_unchanged",
    studio_workout_session_feedback: "retain_unchanged",
    training_calendar_entries: "mixed_by_source_type",
    studio_audit_events: "retain_unchanged"
});

function classifyDeletionStrategy(table) {
    const strategy = DELETION_STRATEGY_BY_TABLE[table];
    if (!strategy) {
        throw new TypeError(`No deletion-strategy classification is defined for table "${table}".`);
    }
    return strategy;
}

// Cryptographically random, never derived from the original email/username
// (Section 10/29: "kein Hash oder deterministischer Ableitungswert").
// Collision odds with 16 random bytes (128 bits) are astronomically below
// the "practically never" threshold Section 29 accepts; callers still
// retry on ER_DUP_ENTRY as defense in depth, not because this is expected
// to fire.
function generateAnonymizedUsername(randomBytes = crypto.randomBytes) {
    const suffix = randomBytes(12).toString("hex");
    const username = `${ANONYMIZED_USERNAME_PREFIX}${suffix}`;
    if (username.length > 50) {
        throw new RangeError("Generated anonymized username exceeds users.username's column length.");
    }
    return username;
}

function generateAnonymizedEmail(randomBytes = crypto.randomBytes) {
    const suffix = randomBytes(16).toString("hex");
    const email = `${ANONYMIZED_EMAIL_LOCAL_PREFIX}${suffix}@${ANONYMIZED_EMAIL_DOMAIN}`;
    if (email.length > 120) {
        throw new RangeError("Generated anonymized e-mail exceeds users.email's column length.");
    }
    return email;
}

function isAnonymizedEmail(value) {
    return typeof value === "string" && value.endsWith(`@${ANONYMIZED_EMAIL_DOMAIN}`);
}

// Section 6/30: a deleted account's raw username/e-mail must never appear
// in another user's API view (e.g. a coaching relationship's
// coachDisplayName, a membership listing) - only a fixed, localized label,
// never the internal random placeholder string. Returns null when the
// referenced account is still active, signaling the caller to use the real
// username as it does today; returns the fixed label otherwise. Pure and
// side-effect-free so every read path can share one implementation instead
// of re-deriving this check per endpoint.
function projectMemberDisplayName({ lifecycleStatus }, locale = "de") {
    if (!isDeletedLifecycleStatus(lifecycleStatus)) {
        return null;
    }
    return DELETED_MEMBER_DISPLAY_NAME[locale === "en" ? "en" : "de"];
}

module.exports = {
    ANONYMIZED_EMAIL_DOMAIN,
    DELETED_MEMBER_DISPLAY_NAME,
    LIFECYCLE_STATUSES,
    canTransitionLifecycleStatus,
    classifyDeletionStrategy,
    generateAnonymizedEmail,
    generateAnonymizedUsername,
    hasNoStudioHistory,
    isActiveLifecycleStatus,
    isAnonymizedEmail,
    isDeletedLifecycleStatus,
    isHardDeleteEligible,
    isTerminalLifecycleStatus,
    isValidLifecycleStatus,
    projectMemberDisplayName
};
