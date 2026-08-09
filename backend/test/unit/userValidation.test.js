const test = require("node:test");
const assert = require("node:assert/strict");

const { ValidationError } = require("../../errors/AppError");
const {
    validateAccountDeletionRequestPayload,
    validateChangePasswordPayload,
    validateEmailChangeConfirmPayload,
    validateEmailChangeRequestPayload,
    validateLoginPayload,
    validateRegistrationPayload
} = require("../../validation/userValidation");

test("registration normalizes valid e-mail addresses and applies safe limits", () => {
    const value = validateRegistrationPayload({
        username: "  Liam  ",
        email: "  LIAM@example.ch ",
        password: "correct horse battery staple",
        language_preference: "de",
        weight_unit: "kg",
        distance_unit: "km"
    });

    assert.equal(value.username, "Liam");
    assert.equal(value.email, "liam@example.ch");
    assert.equal(value.password, "correct horse battery staple");
});
test("registration rejects malformed e-mail and overlong passwords", () => {
    assert.throws(
        () => validateRegistrationPayload({ username: "Liam", email: "bad", password: "password" }),
        ValidationError
    );
    assert.throws(
        () => validateRegistrationPayload({
            username: "Liam", email: "liam@example.ch", password: "x".repeat(129)
        }),
        ValidationError
    );
});

test("login rejects non-string credentials rather than coercing them", () => {
    assert.throws(() => validateLoginPayload({ email: ["liam@example.ch"], password: true }), ValidationError);
});

test("change-password payload requires all three fields and applies the same password policy as registration", () => {
    const value = validateChangePasswordPayload({
        currentPassword: "old-password",
        newPassword: "new-password-123",
        newPasswordConfirmation: "new-password-123"
    });
    assert.equal(value.currentPassword, "old-password");
    assert.equal(value.newPassword, "new-password-123");
    assert.equal(value.newPasswordConfirmation, "new-password-123");

    assert.throws(
        () => validateChangePasswordPayload({ currentPassword: "", newPassword: "new-password-123", newPasswordConfirmation: "new-password-123" }),
        ValidationError
    );
    assert.throws(
        () => validateChangePasswordPayload({ currentPassword: "old-password", newPassword: "short", newPasswordConfirmation: "short" }),
        ValidationError
    );
});

test("Stage 5C1: account-deletion-request payload requires exactly currentPassword and confirmationPhrase", () => {
    const value = validateAccountDeletionRequestPayload({
        currentPassword: "correct horse battery staple",
        confirmationPhrase: "my-username"
    });
    assert.equal(value.currentPassword, "correct horse battery staple");
    assert.equal(value.confirmationPhrase, "my-username");

    assert.throws(
        () => validateAccountDeletionRequestPayload({ currentPassword: "", confirmationPhrase: "my-username" }),
        ValidationError
    );
    assert.throws(
        () => validateAccountDeletionRequestPayload({ currentPassword: "x", confirmationPhrase: "" }),
        ValidationError
    );
    assert.throws(
        () => validateAccountDeletionRequestPayload({}),
        ValidationError
    );
    assert.throws(() => validateAccountDeletionRequestPayload(null), ValidationError);
});

test("account-deletion-request payload rejects unknown extra fields rather than silently ignoring them", () => {
    assert.throws(
        () => validateAccountDeletionRequestPayload({
            currentPassword: "x", confirmationPhrase: "y", adminOverride: true
        }),
        ValidationError
    );
});

test("change-password payload never trims password fields, unlike username/e-mail fields", () => {
    const value = validateChangePasswordPayload({
        currentPassword: "  padded  ",
        newPassword: "  padded-new-pass  ",
        newPasswordConfirmation: "  padded-new-pass  "
    });
    assert.equal(value.currentPassword, "  padded  ");
    assert.equal(value.newPassword, "  padded-new-pass  ");
});

test("email-change-request payload normalizes the new e-mail and requires the current password", () => {
    const value = validateEmailChangeRequestPayload({
        newEmail: "  NEW@Example.CH ",
        currentPassword: "old-password"
    });
    assert.equal(value.newEmail, "new@example.ch");
    assert.equal(value.currentPassword, "old-password");

    assert.throws(
        () => validateEmailChangeRequestPayload({ newEmail: "not-an-email", currentPassword: "old-password" }),
        ValidationError
    );
    assert.throws(
        () => validateEmailChangeRequestPayload({ newEmail: "new@example.ch", currentPassword: "" }),
        ValidationError
    );
});

test("email-change-confirm payload requires a non-empty token", () => {
    const value = validateEmailChangeConfirmPayload({ token: "abc" });
    assert.equal(value.token, "abc");
    assert.throws(() => validateEmailChangeConfirmPayload({ token: "" }), ValidationError);
    assert.throws(() => validateEmailChangeConfirmPayload({}), ValidationError);
});
