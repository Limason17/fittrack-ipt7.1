const test = require("node:test");
const assert = require("node:assert/strict");

const { ValidationError } = require("../../errors/AppError");
const {
    validateDate,
    validateProgressPayload,
    validateWorkoutPayload
} = require("../../validation/trainingValidation");

function assertValidationError(callback, expectedField) {
    assert.throws(callback, (error) => {
        assert.ok(error instanceof ValidationError);
        assert.equal(error.code, "VALIDATION_ERROR");
        assert.ok(error.fields[expectedField]);
        return true;
    });
}

test("dates must represent a real calendar day", () => {
    assert.equal(validateDate("2024-02-29"), "2024-02-29");
    assertValidationError(() => validateDate("2025-02-29"), "date");
    assertValidationError(() => validateDate("2025-13-01"), "date");
});

test("workout validation rejects coercible and contradictory metric values", () => {
    const base = {
        title: "Strength",
        workout_date: "2026-07-18",
        notes: "",
        exercises: [{ exercise_id: 1, sets: 3, reps: 8, weight: 100 }]
    };

    assert.deepEqual(validateWorkoutPayload(base), {
        title: "Strength",
        workout_date: "2026-07-18",
        notes: null,
        exercises: [{
            exercise_id: 1,
            sets: 3,
            reps: 8,
            weight: 100,
            duration_minutes: null,
            distance_km: null,
            intensity_level: null
        }]
    });

    assertValidationError(
        () => validateWorkoutPayload({ ...base, exercises: [{ ...base.exercises[0], reps: true }] }),
        "exercises.0.reps"
    );
    assertValidationError(
        () => validateWorkoutPayload({ ...base, exercises: [{ ...base.exercises[0], weight: -1 }] }),
        "exercises.0.weight"
    );
    for (const reps of [false, "", [], Number.POSITIVE_INFINITY]) {
        assertValidationError(
            () => validateWorkoutPayload({ ...base, exercises: [{ ...base.exercises[0], reps }] }),
            "exercises.0.reps"
        );
    }
    assertValidationError(
        () => validateWorkoutPayload({ ...base, title: "x".repeat(101) }),
        "title"
    );
});

test("progress validation rejects arrays, empty numbers and overlong notes-equivalents", () => {
    assertValidationError(
        () => validateProgressPayload({ exercise_id: 1, entry_date: "2026-07-18", sets: 3, reps: [], weight: 10 }),
        "reps"
    );
    assertValidationError(
        () => validateProgressPayload({ exercise_id: 1, entry_date: "not-a-date", sets: 3, reps: 8 }),
        "entry_date"
    );
});
