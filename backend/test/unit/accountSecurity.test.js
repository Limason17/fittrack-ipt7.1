const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const { createEmailChangeToken, hashEmailChangeToken } = require("../../security/accountTokens");
const {
    AuthSessionInvalidatedError,
    CurrentPasswordInvalidError,
    EmailAlreadyInUseError,
    EmailChangeRequestNotFoundError,
    EmailChangeTokenInvalidError,
    EmailUnchangedError,
    NewPasswordSameAsCurrentError,
    PasswordConfirmationMismatchError
} = require("../../errors/AccountErrors");

test("email change tokens use exactly 32 random bytes and SHA-256 binary hashes", () => {
    const bytes = Buffer.alloc(32, 7);
    const generated = createEmailChangeToken((size) => {
        assert.equal(size, 32);
        return bytes;
    });
    assert.match(generated.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(generated.tokenHash.length, 32);
    assert.deepEqual(generated.tokenHash, crypto.createHash("sha256").update(generated.token).digest());
    assert.deepEqual(hashEmailChangeToken(generated.token), generated.tokenHash);
});

test("hashEmailChangeToken rejects malformed token shapes instead of hashing garbage", () => {
    assert.throws(() => hashEmailChangeToken("short"), (error) => error.code === "INVALID_EMAIL_CHANGE_TOKEN");
    assert.throws(() => hashEmailChangeToken(""), (error) => error.code === "INVALID_EMAIL_CHANGE_TOKEN");
    assert.throws(() => hashEmailChangeToken(123), (error) => error.code === "INVALID_EMAIL_CHANGE_TOKEN");
    assert.throws(
        () => hashEmailChangeToken("not-base64url-because-it-has-a-slash/-and-is-too-shortXX"),
        (error) => error.code === "INVALID_EMAIL_CHANGE_TOKEN"
    );
});

test("createEmailChangeToken rejects an entropy source that does not return exactly 32 bytes", () => {
    assert.throws(() => createEmailChangeToken(() => Buffer.alloc(16)), TypeError);
});

test("account error classes carry the documented stable status/code/message contract", () => {
    assert.equal(new CurrentPasswordInvalidError().status, 401);
    assert.equal(new CurrentPasswordInvalidError().code, "CURRENT_PASSWORD_INVALID");
    assert.equal(new NewPasswordSameAsCurrentError().status, 400);
    assert.equal(new NewPasswordSameAsCurrentError().code, "NEW_PASSWORD_SAME_AS_CURRENT");
    assert.equal(new PasswordConfirmationMismatchError().status, 400);
    assert.equal(new PasswordConfirmationMismatchError().code, "PASSWORD_CONFIRMATION_MISMATCH");
    assert.deepEqual(new PasswordConfirmationMismatchError().fields, {
        newPasswordConfirmation: "The password confirmation does not match the new password."
    });
    assert.equal(new EmailUnchangedError().status, 400);
    assert.equal(new EmailUnchangedError().code, "EMAIL_UNCHANGED");
    assert.equal(new EmailAlreadyInUseError().status, 409);
    assert.equal(new EmailAlreadyInUseError().code, "EMAIL_ALREADY_IN_USE");
    assert.equal(new EmailChangeRequestNotFoundError().status, 404);
    assert.equal(new EmailChangeRequestNotFoundError().code, "EMAIL_CHANGE_REQUEST_NOT_FOUND");
    assert.equal(new EmailChangeTokenInvalidError().status, 404);
    assert.equal(new EmailChangeTokenInvalidError().code, "EMAIL_CHANGE_TOKEN_INVALID");
    assert.equal(new AuthSessionInvalidatedError().status, 401);
    assert.equal(new AuthSessionInvalidatedError().code, "AUTH_SESSION_INVALIDATED");
});

test("none of the account error messages ever mention a password value or token", () => {
    const errors = [
        new CurrentPasswordInvalidError(),
        new NewPasswordSameAsCurrentError(),
        new PasswordConfirmationMismatchError(),
        new EmailUnchangedError(),
        new EmailAlreadyInUseError(),
        new EmailChangeRequestNotFoundError(),
        new EmailChangeTokenInvalidError(),
        new AuthSessionInvalidatedError()
    ];
    for (const error of errors) {
        assert.equal(/password[^ ]*[:=]|token[^ ]*[:=]/i.test(error.message), false, error.code);
    }
});
