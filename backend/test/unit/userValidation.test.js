const test = require("node:test");
const assert = require("node:assert/strict");

const { ValidationError } = require("../../errors/AppError");
const {
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

