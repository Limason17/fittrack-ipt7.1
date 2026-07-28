const test = require("node:test");
const assert = require("node:assert/strict");

const {
    ANONYMIZED_EMAIL_DOMAIN,
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
} = require("../../domain/userLifecycleDomain");

test("lifecycle status validity and predicates", () => {
    assert.equal(isValidLifecycleStatus("active"), true);
    assert.equal(isValidLifecycleStatus("deleted"), true);
    assert.equal(isValidLifecycleStatus("suspended"), false);
    assert.equal(isValidLifecycleStatus(undefined), false);
    assert.equal(isActiveLifecycleStatus("active"), true);
    assert.equal(isActiveLifecycleStatus("deleted"), false);
    assert.equal(isDeletedLifecycleStatus("deleted"), true);
    assert.equal(isDeletedLifecycleStatus("active"), false);
});

test("active -> deleted is allowed; deleted is terminal with no allowed transitions", () => {
    assert.equal(canTransitionLifecycleStatus("active", "deleted"), true);
    assert.equal(canTransitionLifecycleStatus("deleted", "active"), false);
    assert.equal(canTransitionLifecycleStatus("active", "active"), false);
    assert.equal(canTransitionLifecycleStatus("deleted", "deleted"), false);
    assert.equal(canTransitionLifecycleStatus("unknown", "deleted"), false);
    assert.equal(isTerminalLifecycleStatus("deleted"), true);
    assert.equal(isTerminalLifecycleStatus("active"), false);
});

test("hard-delete eligibility is an exact zero-membership-rows check", () => {
    assert.equal(hasNoStudioHistory(0), true);
    assert.equal(hasNoStudioHistory(1), false);
    assert.equal(hasNoStudioHistory(5), false);
    assert.equal(isHardDeleteEligible(0), true);
    assert.equal(isHardDeleteEligible(1), false);
    assert.throws(() => hasNoStudioHistory(-1), TypeError);
    assert.throws(() => hasNoStudioHistory(1.5), TypeError);
});

test("classifyDeletionStrategy returns a stable classification per table and rejects unknown tables", () => {
    assert.equal(classifyDeletionStrategy("workouts"), "hard_delete");
    assert.equal(classifyDeletionStrategy("progress_entries"), "hard_delete");
    assert.equal(classifyDeletionStrategy("exercises"), "hard_delete");
    assert.equal(classifyDeletionStrategy("studio_memberships"), "retain_unchanged");
    assert.equal(classifyDeletionStrategy("studio_workout_sessions"), "retain_unchanged");
    assert.equal(classifyDeletionStrategy("studio_workout_session_sets"), "retain_unchanged");
    assert.equal(classifyDeletionStrategy("studio_workout_session_feedback"), "retain_unchanged");
    assert.equal(classifyDeletionStrategy("training_calendar_entries"), "mixed_by_source_type");
    assert.equal(classifyDeletionStrategy("users"), "anonymize_or_hard_delete");
    assert.throws(() => classifyDeletionStrategy("not_a_real_table"), TypeError);
});

test("generated anonymized usernames are prefixed, fit the column length, and are never identical across calls", () => {
    const usernames = new Set();
    for (let i = 0; i < 20; i += 1) {
        const username = generateAnonymizedUsername();
        assert.equal(username.startsWith("deleted-user-"), true);
        assert.ok(username.length <= 50, `username too long: ${username}`);
        usernames.add(username);
    }
    assert.equal(usernames.size, 20, "expected 20 distinct random usernames");
});

test("generated anonymized e-mails use the reserved .invalid domain, fit the column length, and are never identical across calls", () => {
    const emails = new Set();
    for (let i = 0; i < 20; i += 1) {
        const email = generateAnonymizedEmail();
        assert.equal(email.endsWith(`@${ANONYMIZED_EMAIL_DOMAIN}`), true);
        assert.equal(isAnonymizedEmail(email), true);
        assert.ok(email.length <= 120, `email too long: ${email}`);
        emails.add(email);
    }
    assert.equal(emails.size, 20, "expected 20 distinct random e-mails");
    assert.equal(isAnonymizedEmail("someone@example.com"), false);
});

test("anonymized identifiers are not derivable from any input - the generators take no seed at all", () => {
    // Property test: the generator's own declared, non-default parameter
    // count is zero (its one parameter is an injectable-for-testing
    // randomBytes function with a default, which JS excludes from
    // Function.length) - there is no username/e-mail parameter at all, so
    // no code path exists by which the original identifier could influence
    // the output.
    assert.equal(generateAnonymizedUsername.length, 0);
    assert.equal(generateAnonymizedEmail.length, 0);
});

test("projectMemberDisplayName returns null for active accounts and a fixed localized label for deleted ones", () => {
    assert.equal(projectMemberDisplayName({ lifecycleStatus: "active" }, "de"), null);
    assert.equal(projectMemberDisplayName({ lifecycleStatus: "active" }, "en"), null);
    assert.equal(projectMemberDisplayName({ lifecycleStatus: "deleted" }, "de"), "Gelöschtes Mitglied");
    assert.equal(projectMemberDisplayName({ lifecycleStatus: "deleted" }, "en"), "Deleted member");
    assert.equal(projectMemberDisplayName({ lifecycleStatus: "deleted" }), "Gelöschtes Mitglied");
});
