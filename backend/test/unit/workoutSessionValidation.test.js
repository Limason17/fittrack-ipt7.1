const test = require("node:test");
const assert = require("node:assert/strict");

const {
    LIMITS,
    validateCreateSetPayload,
    validateSessionExercisePatchPayload,
    validateSessionPatchPayload,
    validateSessionSetPatchPayload,
    validateStartSessionPayload
} = require("../../validation/workoutSessionValidation");

const VALID_UUID_A = "123e4567-e89b-42d3-a456-426614174000";

function expectValidationError(fn, field) {
    assert.throws(fn, (error) => {
        assert.equal(error.code, "VALIDATION_ERROR");
        assert.ok(Object.hasOwn(error.fields, field), `expected a validation error on ${field}`);
        return true;
    });
}

test("validateStartSessionPayload requires a program day public id and a bounded client start key", () => {
    assert.deepEqual(
        validateStartSessionPayload({ programDayId: VALID_UUID_A, clientStartKey: "device-abc-1" }),
        { programDayId: VALID_UUID_A, clientStartKey: "device-abc-1" }
    );
    expectValidationError(() => validateStartSessionPayload({ programDayId: "not-a-uuid", clientStartKey: "k" }), "programDayId");
    expectValidationError(() => validateStartSessionPayload({ programDayId: VALID_UUID_A, clientStartKey: "" }), "clientStartKey");
    expectValidationError(
        () => validateStartSessionPayload({ programDayId: VALID_UUID_A, clientStartKey: "x".repeat(LIMITS.clientStartKey + 1) }),
        "clientStartKey"
    );
    expectValidationError(
        () => validateStartSessionPayload({ programDayId: VALID_UUID_A, clientStartKey: "k", extra: true }),
        "extra"
    );
    expectValidationError(() => validateStartSessionPayload({ clientStartKey: "k" }), "programDayId");
});

test("validateSessionPatchPayload requires both memberNote and expectedRevision keys, even when memberNote is null", () => {
    assert.deepEqual(
        validateSessionPatchPayload({ memberNote: "Felt strong today", expectedRevision: 3 }),
        { member_note: "Felt strong today", expectedRevision: 3 }
    );
    assert.deepEqual(
        validateSessionPatchPayload({ memberNote: null, expectedRevision: 0 }),
        { member_note: null, expectedRevision: 0 }
    );
    expectValidationError(() => validateSessionPatchPayload({ memberNote: "x" }), "expectedRevision");
    expectValidationError(() => validateSessionPatchPayload({ expectedRevision: 1 }), "memberNote");
    expectValidationError(
        () => validateSessionPatchPayload({ memberNote: "x".repeat(LIMITS.memberNote + 1), expectedRevision: 1 }),
        "memberNote"
    );
    expectValidationError(() => validateSessionPatchPayload({ memberNote: "x", expectedRevision: -1 }), "expectedRevision");
});

test("validateSessionExercisePatchPayload requires expectedRevision and at least one of status or memberNote", () => {
    assert.deepEqual(
        validateSessionExercisePatchPayload({ status: "completed", expectedRevision: 1 }),
        { status: "completed", expectedRevision: 1 }
    );
    assert.deepEqual(
        validateSessionExercisePatchPayload({ memberNote: "note", expectedRevision: 2 }),
        { member_note: "note", expectedRevision: 2 }
    );
    expectValidationError(() => validateSessionExercisePatchPayload({ status: "completed" }), "expectedRevision");
    expectValidationError(() => validateSessionExercisePatchPayload({ expectedRevision: 1 }), "body");
    expectValidationError(() => validateSessionExercisePatchPayload({ status: "invalid", expectedRevision: 1 }), "status");
});

test("validateCreateSetPayload rejects any body content", () => {
    assert.deepEqual(validateCreateSetPayload({}), {});
    expectValidationError(() => validateCreateSetPayload({ actualReps: 8 }), "actualReps");
});

test("validateSessionSetPatchPayload requires expectedRevision and at least one result field, mapping to snake_case", () => {
    const result = validateSessionSetPatchPayload({
        status: "completed",
        actualReps: 8,
        actualWeight: 60.5,
        actualDurationMinutes: 10,
        actualDistanceKm: 2.5,
        actualRpe: 7,
        memberNote: "hard set",
        expectedRevision: 4
    });
    assert.deepEqual(result, {
        expectedRevision: 4,
        status: "completed",
        actual_reps: 8,
        actual_weight: 60.5,
        actual_duration_minutes: 10,
        actual_distance_km: 2.5,
        actual_rpe: 7,
        member_note: "hard set"
    });

    expectValidationError(() => validateSessionSetPatchPayload({ status: "completed" }), "expectedRevision");
    expectValidationError(() => validateSessionSetPatchPayload({ expectedRevision: 1 }), "body");
    expectValidationError(() => validateSessionSetPatchPayload({ actualReps: -1, expectedRevision: 1 }), "actualReps");
    expectValidationError(
        () => validateSessionSetPatchPayload({ actualReps: LIMITS.actualReps + 1, expectedRevision: 1 }),
        "actualReps"
    );
    expectValidationError(
        () => validateSessionSetPatchPayload({ actualWeight: LIMITS.actualWeight + 1, expectedRevision: 1 }),
        "actualWeight"
    );
    expectValidationError(() => validateSessionSetPatchPayload({ status: "bogus", expectedRevision: 1 }), "status");
});

test("all workout session validators reject unknown mass-assignment fields", () => {
    expectValidationError(
        () => validateSessionPatchPayload({ memberNote: null, expectedRevision: 1, status: "completed" }),
        "status"
    );
    expectValidationError(
        () => validateSessionExercisePatchPayload({ expectedRevision: 1, status: "completed", sessionId: VALID_UUID_A }),
        "sessionId"
    );
    expectValidationError(
        () => validateSessionSetPatchPayload({ expectedRevision: 1, actualReps: 5, revision: 9 }),
        "revision"
    );
});
