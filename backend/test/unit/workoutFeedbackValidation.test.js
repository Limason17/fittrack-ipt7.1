const test = require("node:test");
const assert = require("node:assert/strict");

const { LIMITS, validateCreateFeedbackPayload } = require("../../validation/workoutFeedbackValidation");

const VALID_UUID = "123e4567-e89b-42d3-a456-426614174000";

function expectValidationError(fn, field) {
    assert.throws(fn, (error) => {
        assert.equal(error.code, "VALIDATION_ERROR");
        assert.ok(Object.hasOwn(error.fields, field), `expected a validation error on ${field}`);
        return true;
    });
}

test("validateCreateFeedbackPayload accepts a clientFeedbackKey and a trimmed body", () => {
    assert.deepEqual(
        validateCreateFeedbackPayload({ clientFeedbackKey: VALID_UUID, body: "  Great session!  " }),
        { clientFeedbackKey: VALID_UUID, body: "Great session!" }
    );
});

test("validateCreateFeedbackPayload rejects a missing or malformed clientFeedbackKey", () => {
    expectValidationError(() => validateCreateFeedbackPayload({ body: "x" }), "clientFeedbackKey");
    expectValidationError(
        () => validateCreateFeedbackPayload({ clientFeedbackKey: "not-a-uuid", body: "x" }),
        "clientFeedbackKey"
    );
});

test("validateCreateFeedbackPayload rejects an empty or whitespace-only body", () => {
    expectValidationError(() => validateCreateFeedbackPayload({ clientFeedbackKey: VALID_UUID }), "body");
    expectValidationError(
        () => validateCreateFeedbackPayload({ clientFeedbackKey: VALID_UUID, body: "" }),
        "body"
    );
    expectValidationError(
        () => validateCreateFeedbackPayload({ clientFeedbackKey: VALID_UUID, body: "   " }),
        "body"
    );
    expectValidationError(
        () => validateCreateFeedbackPayload({ clientFeedbackKey: VALID_UUID, body: 42 }),
        "body"
    );
});

test("validateCreateFeedbackPayload enforces the maximum body length", () => {
    const maxBody = "x".repeat(LIMITS.body);
    assert.deepEqual(
        validateCreateFeedbackPayload({ clientFeedbackKey: VALID_UUID, body: maxBody }),
        { clientFeedbackKey: VALID_UUID, body: maxBody }
    );
    expectValidationError(
        () => validateCreateFeedbackPayload({ clientFeedbackKey: VALID_UUID, body: "x".repeat(LIMITS.body + 1) }),
        "body"
    );
});

test("validateCreateFeedbackPayload rejects mass assignment of unknown fields", () => {
    expectValidationError(
        () => validateCreateFeedbackPayload({ clientFeedbackKey: VALID_UUID, body: "x", coachMembershipId: VALID_UUID }),
        "coachMembershipId"
    );
    expectValidationError(
        () => validateCreateFeedbackPayload({ clientFeedbackKey: VALID_UUID, body: "x", authorUserId: 1 }),
        "authorUserId"
    );
});

test("validateCreateFeedbackPayload treats HTML content in the body as inert plain text, never parsed or stripped", () => {
    const markup = "<script>alert(1)</script> <b>bold</b>";
    assert.deepEqual(
        validateCreateFeedbackPayload({ clientFeedbackKey: VALID_UUID, body: markup }),
        { clientFeedbackKey: VALID_UUID, body: markup }
    );
});
