const test = require("node:test");
const assert = require("node:assert/strict");

const {
    PERMISSIONS,
    ROLE_PERMISSIONS,
    canMutateWorkoutSession,
    canStartWorkoutSession,
    hasStudioPermission,
    sessionCompletionEligibility,
    workoutResultReadEligibility
} = require("../../domain/studioPolicy");

function activeAssignment(overrides = {}) {
    return {
        status: "active",
        startsOn: null,
        endsOn: null,
        programVersionId: 5,
        ...overrides
    };
}

function activeRelationship(overrides = {}) {
    return { status: "active", ...overrides };
}

function programDay(overrides = {}) {
    return { programVersionId: 5, ...overrides };
}

test("role permission matrix grants workout self-management to every role and coached reads only to owner/admin/trainer", () => {
    assert.ok(ROLE_PERMISSIONS.owner.has(PERMISSIONS.WORKOUT_SESSION_MANAGE_SELF));
    assert.ok(ROLE_PERMISSIONS.admin.has(PERMISSIONS.WORKOUT_SESSION_MANAGE_SELF));
    assert.ok(ROLE_PERMISSIONS.trainer.has(PERMISSIONS.WORKOUT_SESSION_MANAGE_SELF));
    assert.ok(ROLE_PERMISSIONS.member.has(PERMISSIONS.WORKOUT_SESSION_MANAGE_SELF));

    assert.ok(ROLE_PERMISSIONS.owner.has(PERMISSIONS.WORKOUT_RESULT_READ_COACHED));
    assert.ok(ROLE_PERMISSIONS.admin.has(PERMISSIONS.WORKOUT_RESULT_READ_COACHED));
    assert.ok(ROLE_PERMISSIONS.trainer.has(PERMISSIONS.WORKOUT_RESULT_READ_COACHED));
    assert.ok(
        !ROLE_PERMISSIONS.member.has(PERMISSIONS.WORKOUT_RESULT_READ_COACHED),
        "members never read anyone else's results"
    );
});

test("hasStudioPermission is default-deny for inactive memberships across the new permissions", () => {
    for (const permission of [PERMISSIONS.WORKOUT_SESSION_MANAGE_SELF, PERMISSIONS.WORKOUT_RESULT_READ_COACHED]) {
        assert.equal(hasStudioPermission({ role: "owner", status: "suspended" }, permission), false);
        assert.equal(hasStudioPermission(null, permission), false);
    }
});

test("canStartWorkoutSession allows a same-day start with no date bounds and an active relationship", () => {
    const decision = canStartWorkoutSession({
        assignment: activeAssignment(),
        coachingRelationship: activeRelationship(),
        programDay: programDay(),
        today: "2026-07-19"
    });
    assert.deepEqual(decision, { allowed: true });
});

test("canStartWorkoutSession rejects a cancelled or completed assignment", () => {
    for (const status of ["cancelled", "completed"]) {
        const decision = canStartWorkoutSession({
            assignment: activeAssignment({ status }),
            coachingRelationship: activeRelationship(),
            programDay: programDay(),
            today: "2026-07-19"
        });
        assert.equal(decision.allowed, false);
        assert.equal(decision.reason, "WORKOUT_ASSIGNMENT_NOT_AVAILABLE");
    }
});

test("canStartWorkoutSession enforces starts_on and ends_on boundaries", () => {
    const beforeStart = canStartWorkoutSession({
        assignment: activeAssignment({ startsOn: "2026-08-01" }),
        coachingRelationship: activeRelationship(),
        programDay: programDay(),
        today: "2026-07-19"
    });
    assert.equal(beforeStart.allowed, false);
    assert.equal(beforeStart.reason, "WORKOUT_ASSIGNMENT_NOT_AVAILABLE");

    const afterEnd = canStartWorkoutSession({
        assignment: activeAssignment({ endsOn: "2026-07-01" }),
        coachingRelationship: activeRelationship(),
        programDay: programDay(),
        today: "2026-07-19"
    });
    assert.equal(afterEnd.allowed, false);
    assert.equal(afterEnd.reason, "WORKOUT_ASSIGNMENT_NOT_AVAILABLE");

    const onBoundaryDates = canStartWorkoutSession({
        assignment: activeAssignment({ startsOn: "2026-07-19", endsOn: "2026-07-19" }),
        coachingRelationship: activeRelationship(),
        programDay: programDay(),
        today: "2026-07-19"
    });
    assert.equal(onBoundaryDates.allowed, true, "start and end date are inclusive boundaries");
});

test("canStartWorkoutSession rejects an inactive or missing coaching relationship", () => {
    const ended = canStartWorkoutSession({
        assignment: activeAssignment(),
        coachingRelationship: activeRelationship({ status: "ended" }),
        programDay: programDay(),
        today: "2026-07-19"
    });
    assert.equal(ended.allowed, false);
    assert.equal(ended.reason, "WORKOUT_ASSIGNMENT_NOT_AVAILABLE");

    const missing = canStartWorkoutSession({
        assignment: activeAssignment(),
        coachingRelationship: null,
        programDay: programDay(),
        today: "2026-07-19"
    });
    assert.equal(missing.allowed, false);
    assert.equal(missing.reason, "WORKOUT_ASSIGNMENT_NOT_AVAILABLE");
});

test("canStartWorkoutSession rejects a day that does not belong to the assigned version", () => {
    const wrongVersion = canStartWorkoutSession({
        assignment: activeAssignment({ programVersionId: 5 }),
        coachingRelationship: activeRelationship(),
        programDay: programDay({ programVersionId: 9 }),
        today: "2026-07-19"
    });
    assert.equal(wrongVersion.allowed, false);
    assert.equal(wrongVersion.reason, "WORKOUT_DAY_NOT_AVAILABLE");

    const missingDay = canStartWorkoutSession({
        assignment: activeAssignment(),
        coachingRelationship: activeRelationship(),
        programDay: null,
        today: "2026-07-19"
    });
    assert.equal(missingDay.allowed, false);
    assert.equal(missingDay.reason, "WORKOUT_DAY_NOT_AVAILABLE");
});

test("canMutateWorkoutSession only allows mutation while in_progress", () => {
    assert.equal(canMutateWorkoutSession({ status: "in_progress" }), true);
    assert.equal(canMutateWorkoutSession({ status: "completed" }), false);
    assert.equal(canMutateWorkoutSession({ status: "aborted" }), false);
    assert.equal(canMutateWorkoutSession(null), false);
});

test("sessionCompletionEligibility requires every exercise resolved and at least one completed set", () => {
    assert.deepEqual(
        sessionCompletionEligibility({
            exercises: [{ status: "completed", sets: [{ status: "completed" }] }]
        }),
        { allowed: true }
    );

    const pendingExercise = sessionCompletionEligibility({
        exercises: [{ status: "pending", sets: [] }]
    });
    assert.equal(pendingExercise.allowed, false);
    assert.equal(pendingExercise.reason, "WORKOUT_SESSION_INCOMPLETE");

    const pendingSetOnCompletedExercise = sessionCompletionEligibility({
        exercises: [{ status: "completed", sets: [{ status: "completed" }, { status: "pending" }] }]
    });
    assert.equal(pendingSetOnCompletedExercise.allowed, false);

    const noCompletedSetsAtAll = sessionCompletionEligibility({
        exercises: [{ status: "skipped", sets: [{ status: "skipped" }] }]
    });
    assert.equal(noCompletedSetsAtAll.allowed, false, "a session with zero completed sets cannot complete");

    const emptyExerciseList = sessionCompletionEligibility({ exercises: [] });
    assert.equal(emptyExerciseList.allowed, false);
});

test("sessionCompletionEligibility rejects a skipped exercise that still has a completed set", () => {
    const decision = sessionCompletionEligibility({
        exercises: [{ status: "skipped", sets: [{ status: "completed" }] }]
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "WORKOUT_SESSION_INCOMPLETE");
});

test("workoutResultReadEligibility requires an active coaching relationship for every coach role, no owner/admin bypass", () => {
    for (const role of ["owner", "admin", "trainer"]) {
        assert.equal(
            workoutResultReadEligibility({ actorRole: role, coachingRelationship: activeRelationship() }).allowed,
            true,
            `${role} with an active relationship should be eligible`
        );
        assert.equal(
            workoutResultReadEligibility({ actorRole: role, coachingRelationship: null }).allowed,
            false,
            `${role} without a relationship must not bypass the check`
        );
        assert.equal(
            workoutResultReadEligibility({
                actorRole: role, coachingRelationship: activeRelationship({ status: "ended" })
            }).allowed,
            false
        );
    }
    assert.equal(
        workoutResultReadEligibility({ actorRole: "member", coachingRelationship: activeRelationship() }).allowed,
        false,
        "a member is never a coach reader, even with a relationship row present"
    );
});
