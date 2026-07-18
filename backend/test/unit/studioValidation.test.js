const test = require("node:test");
const assert = require("node:assert/strict");

const { ValidationError } = require("../../errors/AppError");
const {
    normalizeEmail,
    validateCreateStudioPayload,
    validateInvitationPayload,
    validateMembershipPatchPayload,
    validatePagination,
    validateStudioPatchPayload
} = require("../../validation/studioValidation");

test("studio creation accepts only the exact camelCase contract", () => {
    assert.deepEqual(validateCreateStudioPayload({
        name: "  Kraft Zürich  ",
        defaultLocale: "de",
        defaultTimezone: "Europe/Zurich",
        defaultWeightUnit: "kg"
    }), {
        name: "Kraft Zürich",
        slug: "kraft-zurich",
        default_locale: "de",
        default_timezone: "Europe/Zurich",
        default_weight_unit: "kg"
    });
    assert.throws(() => validateCreateStudioPayload({
        name: "Studio",
        role: "owner"
    }), ValidationError);
    assert.throws(() => validateCreateStudioPayload({
        name: "Studio",
        studioId: "123"
    }), ValidationError);
});

test("studio patch rejects status and maps supported fields safely", () => {
    assert.deepEqual(validateStudioPatchPayload({
        name: "Updated",
        defaultWeightUnit: "lb"
    }), { name: "Updated", default_weight_unit: "lb" });
    assert.throws(() => validateStudioPatchPayload({ status: "suspended" }), ValidationError);
    assert.throws(() => validateStudioPatchPayload({}), ValidationError);
});

test("invitation email and role are both required and normalized", () => {
    assert.deepEqual(validateInvitationPayload({
        email: "  MEMBER@Example.Test ",
        role: "trainer"
    }), { email: "member@example.test", role: "trainer" });
    assert.equal(normalizeEmail("A@EXAMPLE.TEST"), "a@example.test");
    assert.throws(() => validateInvitationPayload({ email: "a@example.test" }), ValidationError);
    assert.throws(() => validateInvitationPayload({ role: "member" }), ValidationError);
    assert.throws(() => validateInvitationPayload({
        email: "a@example.test",
        role: "owner"
    }), ValidationError);
    assert.throws(() => validateInvitationPayload({
        email: `${"a".repeat(64)}@${"b".repeat(43)}.example.test`,
        role: "member"
    }), ValidationError);
});

test("membership patch and pagination reject mass assignment and unbounded values", () => {
    assert.deepEqual(validateMembershipPatchPayload({ role: "trainer", status: "active" }), {
        role: "trainer",
        status: "active"
    });
    assert.throws(() => validateMembershipPatchPayload({ userId: 99 }), ValidationError);
    assert.deepEqual(validatePagination({ page: "2", limit: "50" }), {
        page: 2,
        limit: 50,
        offset: 50
    });
    assert.throws(() => validatePagination({ limit: "101" }), ValidationError);
    assert.throws(() => validatePagination({ page: ["1"] }), ValidationError);
    assert.throws(() => validatePagination({ cursor: "secret" }), ValidationError);
});
