const test = require("node:test");
const assert = require("node:assert/strict");

const {
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
    validateListOwnCoachingRelationshipsQuery,
    validatePagination,
    validateProgramPatchPayload
} = require("../../validation/trainingProgramValidation");

const VALID_UUID_A = "123e4567-e89b-42d3-a456-426614174000";
const VALID_UUID_B = "223e4567-e89b-42d3-a456-426614174000";
const VALID_UUID_C = "323e4567-e89b-42d3-a456-426614174000";

function expectValidationError(fn, field) {
    assert.throws(fn, (error) => {
        assert.equal(error.code, "VALIDATION_ERROR");
        assert.ok(Object.hasOwn(error.fields, field), `expected a validation error on ${field}`);
        return true;
    });
}

test("validateCoachingRelationshipPayload requires exactly two public ids and rejects mass assignment", () => {
    assert.deepEqual(
        validateCoachingRelationshipPayload({ coachMembershipId: VALID_UUID_A, memberMembershipId: VALID_UUID_B }),
        { coachMembershipId: VALID_UUID_A, memberMembershipId: VALID_UUID_B }
    );
    expectValidationError(() => validateCoachingRelationshipPayload({ coachMembershipId: "not-a-uuid", memberMembershipId: VALID_UUID_B }), "coachMembershipId");
    expectValidationError(() => validateCoachingRelationshipPayload({ coachMembershipId: VALID_UUID_A, memberMembershipId: VALID_UUID_B, role: "owner" }), "role");
});

test("validateCoachingRelationshipPatchPayload only accepts ending the relationship", () => {
    assert.deepEqual(validateCoachingRelationshipPatchPayload({ status: "ended" }), { status: "ended" });
    expectValidationError(() => validateCoachingRelationshipPatchPayload({ status: "active" }), "status");
    expectValidationError(() => validateCoachingRelationshipPatchPayload({}), "body");
});

test("validateListOwnCoachingRelationshipsQuery defaults to status=active for the results view", () => {
    assert.deepEqual(
        validateListOwnCoachingRelationshipsQuery({}),
        { page: 1, limit: 20, offset: 0, status: "active" }
    );
    assert.deepEqual(
        validateListOwnCoachingRelationshipsQuery({ status: "ended" }),
        { page: 1, limit: 20, offset: 0, status: "ended" }
    );
    assert.deepEqual(
        validateListOwnCoachingRelationshipsQuery({ page: "2", limit: "5", status: "active" }),
        { page: 2, limit: 5, offset: 5, status: "active" }
    );
});

test("validateListOwnCoachingRelationshipsQuery rejects an unknown status or query parameter", () => {
    expectValidationError(() => validateListOwnCoachingRelationshipsQuery({ status: "pending" }), "status");
    expectValidationError(() => validateListOwnCoachingRelationshipsQuery({ coachMembershipId: VALID_UUID_A }), "coachMembershipId");
});

test("validateCreateProgramPayload requires a bounded name and rejects unknown fields", () => {
    assert.deepEqual(
        validateCreateProgramPayload({ name: "Beginner Strength" }),
        { name: "Beginner Strength", description: null }
    );
    expectValidationError(() => validateCreateProgramPayload({ name: "" }), "name");
    expectValidationError(() => validateCreateProgramPayload({ name: "x".repeat(121) }), "name");
    expectValidationError(() => validateCreateProgramPayload({ name: "Valid", status: "active" }), "status");
});

test("validateProgramPatchPayload only allows archiving as a status transition", () => {
    assert.deepEqual(validateProgramPatchPayload({ status: "archived" }), { status: "archived" });
    expectValidationError(() => validateProgramPatchPayload({ status: "draft" }), "status");
    expectValidationError(() => validateProgramPatchPayload({}), "body");
});

test("validateCreateVersionPayload accepts only optional bounded notes", () => {
    assert.deepEqual(validateCreateVersionPayload({}), { notes: null });
    assert.deepEqual(validateCreateVersionPayload({ notes: "First cut" }), { notes: "First cut" });
    expectValidationError(() => validateCreateVersionPayload({ notes: "x".repeat(501) }), "notes");
    expectValidationError(() => validateCreateVersionPayload({ versionNumber: 5 }), "versionNumber");
});

test("validateCreateDayPayload requires a name and bounds instructions", () => {
    assert.deepEqual(
        validateCreateDayPayload({ name: "Day 1" }),
        { name: "Day 1", instructions: null }
    );
    expectValidationError(() => validateCreateDayPayload({ name: "" }), "name");
});

test("validateDayPatchPayload validates position as a positive integer when present", () => {
    assert.deepEqual(validateDayPatchPayload({ position: 2 }), { position: 2 });
    expectValidationError(() => validateDayPatchPayload({ position: 0 }), "position");
    expectValidationError(() => validateDayPatchPayload({ position: 1.5 }), "position");
});

test("validateCreateExercisePayload requires an exercise name snapshot and validates numeric ranges", () => {
    const result = validateCreateExercisePayload({
        exerciseNameSnapshot: "Bench Press",
        targetSets: 4,
        targetRepsMin: 6,
        targetRepsMax: 8,
        targetWeight: 60,
        restSeconds: 90
    });
    assert.equal(result.exercise_name_snapshot, "Bench Press");
    assert.equal(result.target_sets, 4);
    assert.equal(result.target_reps_min, 6);
    assert.equal(result.target_reps_max, 8);
    assert.equal(result.target_weight, 60);
    assert.equal(result.rest_seconds, 90);

    expectValidationError(() => validateCreateExercisePayload({ exerciseNameSnapshot: "" }), "exerciseNameSnapshot");
});

test("validateCreateExercisePayload rejects an inverted reps range", () => {
    expectValidationError(() => validateCreateExercisePayload({
        exerciseNameSnapshot: "Squat",
        targetRepsMin: 12,
        targetRepsMax: 8
    }), "targetRepsMax");
});

test("validateExercisePatchPayload accepts a partial update including position", () => {
    assert.deepEqual(validateExercisePatchPayload({ targetSets: 5 }), { target_sets: 5 });
    assert.deepEqual(validateExercisePatchPayload({ position: 3 }), { position: 3 });
    expectValidationError(() => validateExercisePatchPayload({}), "body");
});

test("validateCreateAssignmentPayload requires all three public ids and validates the date range", () => {
    const result = validateCreateAssignmentPayload({
        programVersionId: VALID_UUID_A,
        memberMembershipId: VALID_UUID_B,
        coachingRelationshipId: VALID_UUID_C,
        startsOn: "2026-01-01",
        endsOn: "2026-02-01"
    });
    assert.equal(result.programVersionId, VALID_UUID_A);
    assert.equal(result.memberMembershipId, VALID_UUID_B);
    assert.equal(result.coachingRelationshipId, VALID_UUID_C);
    assert.equal(result.starts_on, "2026-01-01");
    assert.equal(result.ends_on, "2026-02-01");

    expectValidationError(() => validateCreateAssignmentPayload({
        programVersionId: VALID_UUID_A,
        memberMembershipId: VALID_UUID_B,
        coachingRelationshipId: VALID_UUID_C,
        startsOn: "2026-02-01",
        endsOn: "2026-01-01"
    }), "endsOn");

    expectValidationError(() => validateCreateAssignmentPayload({
        programVersionId: "not-a-uuid",
        memberMembershipId: VALID_UUID_B,
        coachingRelationshipId: VALID_UUID_C
    }), "programVersionId");

    expectValidationError(() => validateCreateAssignmentPayload({
        programVersionId: VALID_UUID_A,
        memberMembershipId: VALID_UUID_B
    }), "coachingRelationshipId");

    expectValidationError(() => validateCreateAssignmentPayload({
        programVersionId: VALID_UUID_A,
        memberMembershipId: VALID_UUID_B,
        coachingRelationshipId: "not-a-uuid"
    }), "coachingRelationshipId");

    expectValidationError(() => validateCreateAssignmentPayload({
        programVersionId: VALID_UUID_A,
        memberMembershipId: VALID_UUID_B,
        coachingRelationshipId: VALID_UUID_C,
        role: "trainer"
    }), "role");
});

test("validateAssignmentPatchPayload only allows completing or cancelling", () => {
    assert.deepEqual(validateAssignmentPatchPayload({ status: "completed" }), { status: "completed" });
    assert.deepEqual(validateAssignmentPatchPayload({ status: "cancelled" }), { status: "cancelled" });
    expectValidationError(() => validateAssignmentPatchPayload({ status: "active" }), "status");
});

test("validatePagination bounds page and limit and rejects unknown query fields", () => {
    assert.deepEqual(validatePagination({}), { page: 1, limit: 20, offset: 0 });
    assert.deepEqual(validatePagination({ page: "2", limit: "10" }), { page: 2, limit: 10, offset: 10 });
    expectValidationError(() => validatePagination({ limit: "1000" }), "limit");
    expectValidationError(() => validatePagination({ sort: "asc" }), "sort");
});
