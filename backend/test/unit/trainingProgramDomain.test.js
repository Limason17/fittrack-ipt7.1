const test = require("node:test");
const assert = require("node:assert/strict");

const {
    ASSIGNMENT_STATUSES,
    COACHING_STATUSES,
    COACH_ELIGIBLE_ROLES,
    MUTABLE_ASSIGNMENT_STATUSES,
    PROGRAM_STATUSES,
    PROGRAM_VERSION_STATUSES,
    isPositiveInteger
} = require("../../domain/trainingProgramDomain");

test("training program domain exposes the exact fixed status vocabularies", () => {
    assert.deepEqual(COACHING_STATUSES, ["active", "ended"]);
    assert.deepEqual(PROGRAM_STATUSES, ["draft", "active", "archived"]);
    assert.deepEqual(PROGRAM_VERSION_STATUSES, ["draft", "published", "retired"]);
    assert.deepEqual(ASSIGNMENT_STATUSES, ["active", "completed", "cancelled"]);
    assert.deepEqual(MUTABLE_ASSIGNMENT_STATUSES, ["completed", "cancelled"]);
    assert.deepEqual(COACH_ELIGIBLE_ROLES, ["owner", "admin", "trainer"]);
});

test("status vocabularies are frozen and cannot be mutated at runtime", () => {
    assert.throws(() => { COACHING_STATUSES.push("paused"); }, TypeError);
    assert.throws(() => { PROGRAM_STATUSES.push("paused"); }, TypeError);
});

test("isPositiveInteger accepts only safe positive integers", () => {
    assert.equal(isPositiveInteger(1), true);
    assert.equal(isPositiveInteger(42), true);
    assert.equal(isPositiveInteger(0), false);
    assert.equal(isPositiveInteger(-1), false);
    assert.equal(isPositiveInteger(1.5), false);
    assert.equal(isPositiveInteger("1"), false);
    assert.equal(isPositiveInteger(Number.MAX_SAFE_INTEGER + 1), false);
});
