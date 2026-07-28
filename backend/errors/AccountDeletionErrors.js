const { AppError } = require("./AppError");

class AccountDeletionPhraseMismatchError extends AppError {
    constructor() {
        super({
            status: 400,
            code: "ACCOUNT_DELETION_PHRASE_MISMATCH",
            message: "The confirmation phrase does not match your username.",
            fields: { confirmationPhrase: "The confirmation phrase does not match your username." }
        });
    }
}

// Mirrors LastOwnerRequiredError's precedent (StudioErrors.js) at account
// scope: fields carry only the deleting user's own studio names/ids, never
// data belonging to another person (Section 11.6/24).
class AccountDeletionStudioOwnershipRequiredError extends AppError {
    constructor(studios) {
        super({
            status: 409,
            code: "ACCOUNT_DELETION_STUDIO_OWNERSHIP_REQUIRED",
            message: "Delete your account only after appointing another owner in every studio you currently own alone.",
            fields: { studios }
        });
    }
}

class AccountAlreadyDeletedError extends AppError {
    constructor() {
        super({
            status: 409,
            code: "ACCOUNT_ALREADY_DELETED",
            message: "This account has already been deleted."
        });
    }
}

// Section 18.3/21.5: thrown by a pre-flight check before the deletion
// transaction ever begins, when the deletion-receipt subsystem itself is
// known to be unsafe (unconfigured in production, or a prior consistency
// check found an unresolved reconciliation case) - distinct from a receipt
// WRITE failing after a successful commit, which never fails the HTTP
// response (Section 18.3's "ein Fehlschlag dieses Schritts allein lässt die
// HTTP-Antwort nicht scheitern").
class AccountDeletionServiceUnavailableError extends AppError {
    constructor(message = "Account deletion is temporarily unavailable. Please try again later.") {
        super({ status: 503, code: "ACCOUNT_DELETION_SERVICE_UNAVAILABLE", message });
    }
}

class DeletionReceiptConfigurationUnsafeError extends AppError {
    constructor(message = "Deletion receipt configuration is unsafe.") {
        super({ status: 503, code: "DELETION_RECEIPT_CONFIGURATION_UNSAFE", message });
    }
}

// Receipt-first commit protocol (merge-gate follow-up): thrown when the
// receipt subsystem is configured and reachable, but the actual atomic
// file publication itself fails (disk full, permission denied, etc.) -
// before the database transaction is ever committed. The caller rolls the
// whole transaction back; no account data is ever changed and no receipt
// is left behind. Distinct from DeletionReceiptConfigurationUnsafeError
// (a configuration-level problem, caught before any filesystem write is
// even attempted) and from DeletionReceiptReconciliationRequiredError
// (thrown when the receipt already exists/was already published but the
// commit that was supposed to follow it failed).
class DeletionReceiptPublishFailedError extends AppError {
    constructor(message = "Account deletion is unavailable: the deletion receipt could not be published.") {
        super({ status: 503, code: "DELETION_RECEIPT_PUBLISH_FAILED", message });
    }
}

class DeletionReceiptCorruptedError extends AppError {
    constructor(message = "A deletion receipt failed its integrity check.") {
        super({ status: 503, code: "DELETION_RECEIPT_CORRUPTED", message });
    }
}

class DeletionReceiptReconciliationRequiredError extends AppError {
    constructor(message = "A deletion receipt inconsistency requires operator reconciliation.") {
        super({ status: 503, code: "DELETION_RECEIPT_RECONCILIATION_REQUIRED", message });
    }
}

module.exports = {
    AccountAlreadyDeletedError,
    AccountDeletionPhraseMismatchError,
    AccountDeletionServiceUnavailableError,
    AccountDeletionStudioOwnershipRequiredError,
    DeletionReceiptConfigurationUnsafeError,
    DeletionReceiptCorruptedError,
    DeletionReceiptPublishFailedError,
    DeletionReceiptReconciliationRequiredError
};
