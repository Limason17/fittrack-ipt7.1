const test = require("node:test");
const assert = require("node:assert/strict");

const {
    SESSION_EXERCISE_STATUSES,
    SESSION_SET_STATUSES,
    SESSION_STATUSES,
    TERMINAL_SESSION_STATUSES,
    hasAnyResultMetric,
    isPositiveInteger,
    isTerminalSessionStatus
} = require("../../domain/workoutSessionDomain");

test("workout session domain exposes the exact fixed status vocabularies", () => {
    assert.deepEqual(SESSION_STATUSES, ["in_progress", "completed", "aborted"]);
    assert.deepEqual(TERMINAL_SESSION_STATUSES, ["completed", "aborted"]);
    assert.deepEqual(SESSION_EXERCISE_STATUSES, ["pending", "completed", "skipped"]);
    assert.deepEqual(SESSION_SET_STATUSES, ["pending", "completed", "skipped"]);
});

test("status vocabularies are frozen and cannot be mutated at runtime", () => {
    assert.throws(() => { SESSION_STATUSES.push("paused"); }, TypeError);
    assert.throws(() => { TERMINAL_SESSION_STATUSES.push("paused"); }, TypeError);
});

test("isTerminalSessionStatus recognizes only completed and aborted", () => {
    assert.equal(isTerminalSessionStatus("completed"), true);
    assert.equal(isTerminalSessionStatus("aborted"), true);
    assert.equal(isTerminalSessionStatus("in_progress"), false);
    assert.equal(isTerminalSessionStatus("unknown"), false);
});

test("isPositiveInteger accepts only safe positive integers", () => {
    assert.equal(isPositiveInteger(1), true);
    assert.equal(isPositiveInteger(0), false);
    assert.equal(isPositiveInteger(-1), false);
    assert.equal(isPositiveInteger(1.5), false);
    assert.equal(isPositiveInteger("1"), false);
});

test("hasAnyResultMetric requires at least one non-null actual metric", () => {
    assert.equal(hasAnyResultMetric({
        actualReps: null, actualWeight: null, actualDurationMinutes: null,
        actualDistanceKm: null, actualRpe: null
    }), false);
    assert.equal(hasAnyResultMetric({
        actualReps: 8, actualWeight: null, actualDurationMinutes: null,
        actualDistanceKm: null, actualRpe: null
    }), true);
    assert.equal(hasAnyResultMetric({
        actualReps: null, actualWeight: null, actualDurationMinutes: null,
        actualDistanceKm: null, actualRpe: 7.5
    }), true);
    assert.equal(hasAnyResultMetric({
        actualReps: undefined, actualWeight: undefined, actualDurationMinutes: undefined,
        actualDistanceKm: undefined, actualRpe: undefined
    }), false);
    assert.equal(hasAnyResultMetric({
        actualReps: 0, actualWeight: null, actualDurationMinutes: null,
        actualDistanceKm: null, actualRpe: null
    }), true, "a logged zero is still a meaningful, present metric");
});
