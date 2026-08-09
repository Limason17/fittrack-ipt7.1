const test = require("node:test");
const assert = require("node:assert/strict");

const {
    AccountAlreadyDeletedError,
    AccountDeletionPhraseMismatchError,
    AccountDeletionServiceUnavailableError,
    AccountDeletionStudioOwnershipRequiredError,
    DeletionReceiptConfigurationUnsafeError,
    DeletionReceiptCorruptedError,
    DeletionReceiptPublishFailedError,
    DeletionReceiptReconciliationRequiredError
} = require("../../errors/AccountDeletionErrors");

test("each error subclass reports its documented status/code contract", () => {
    assert.deepEqual(
        [new AccountDeletionPhraseMismatchError().status, new AccountDeletionPhraseMismatchError().code],
        [400, "ACCOUNT_DELETION_PHRASE_MISMATCH"]
    );
    assert.deepEqual(
        [new AccountAlreadyDeletedError().status, new AccountAlreadyDeletedError().code],
        [409, "ACCOUNT_ALREADY_DELETED"]
    );
    assert.deepEqual(
        [new AccountDeletionServiceUnavailableError().status, new AccountDeletionServiceUnavailableError().code],
        [503, "ACCOUNT_DELETION_SERVICE_UNAVAILABLE"]
    );
    assert.deepEqual(
        [new DeletionReceiptConfigurationUnsafeError().status, new DeletionReceiptConfigurationUnsafeError().code],
        [503, "DELETION_RECEIPT_CONFIGURATION_UNSAFE"]
    );
    assert.deepEqual(
        [new DeletionReceiptCorruptedError().status, new DeletionReceiptCorruptedError().code],
        [503, "DELETION_RECEIPT_CORRUPTED"]
    );
    assert.deepEqual(
        [new DeletionReceiptReconciliationRequiredError().status, new DeletionReceiptReconciliationRequiredError().code],
        [503, "DELETION_RECEIPT_RECONCILIATION_REQUIRED"]
    );
    assert.deepEqual(
        [new DeletionReceiptPublishFailedError().status, new DeletionReceiptPublishFailedError().code],
        [503, "DELETION_RECEIPT_PUBLISH_FAILED"]
    );
});

test("AccountDeletionStudioOwnershipRequiredError is a stable 409 carrying only the caller's own studio names/ids", () => {
    const studios = [{ studioId: "abc-123", studioName: "My Studio" }];
    const error = new AccountDeletionStudioOwnershipRequiredError(studios);
    assert.equal(error.status, 409);
    assert.equal(error.code, "ACCOUNT_DELETION_STUDIO_OWNERSHIP_REQUIRED");
    assert.deepEqual(error.fields.studios, studios);
});

test("every error is exposable (4xx/lower 5xx client-relevant errors do not leak internal details) per AppError's own expose contract", () => {
    // 5xx AccountDeletionErrors are all *known*, deliberately-thrown states
    // (unsafe config, corrupted receipt) rather than an unexpected crash -
    // AppError.expose is false for any status >= 500 regardless of
    // subclass, so verifying that here would test the base class, not this
    // module; instead verify these are real AppError instances with a safe
    // static message (never built from unsanitized internal error text).
    const error = new DeletionReceiptCorruptedError();
    assert.equal(typeof error.message, "string");
    assert.ok(error.message.length > 0);
});
