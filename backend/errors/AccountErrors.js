const { AppError } = require("./AppError");

class CurrentPasswordInvalidError extends AppError {
    constructor() {
        super({
            status: 401,
            code: "CURRENT_PASSWORD_INVALID",
            message: "The current password is incorrect."
        });
    }
}

class NewPasswordSameAsCurrentError extends AppError {
    constructor() {
        super({
            status: 400,
            code: "NEW_PASSWORD_SAME_AS_CURRENT",
            message: "The new password must be different from the current password."
        });
    }
}

class PasswordConfirmationMismatchError extends AppError {
    constructor() {
        super({
            status: 400,
            code: "PASSWORD_CONFIRMATION_MISMATCH",
            message: "The password confirmation does not match the new password.",
            fields: { newPasswordConfirmation: "The password confirmation does not match the new password." }
        });
    }
}

class EmailUnchangedError extends AppError {
    constructor() {
        super({
            status: 400,
            code: "EMAIL_UNCHANGED",
            message: "The new e-mail address must be different from the current one.",
            fields: { newEmail: "The new e-mail address must be different from the current one." }
        });
    }
}

class EmailAlreadyInUseError extends AppError {
    constructor() {
        super({
            status: 409,
            code: "EMAIL_ALREADY_IN_USE",
            message: "This e-mail address is already in use."
        });
    }
}

class EmailChangeRequestNotFoundError extends AppError {
    constructor() {
        super({
            status: 404,
            code: "EMAIL_CHANGE_REQUEST_NOT_FOUND",
            message: "No open e-mail change request was found."
        });
    }
}

class EmailChangeTokenInvalidError extends AppError {
    constructor() {
        super({
            status: 404,
            code: "EMAIL_CHANGE_TOKEN_INVALID",
            message: "The e-mail change confirmation link is invalid."
        });
    }
}

class AuthSessionInvalidatedError extends AppError {
    constructor() {
        super({
            status: 401,
            code: "AUTH_SESSION_INVALIDATED",
            message: "Your session is no longer valid. Please log in again."
        });
    }
}

module.exports = {
    AuthSessionInvalidatedError,
    CurrentPasswordInvalidError,
    EmailAlreadyInUseError,
    EmailChangeRequestNotFoundError,
    EmailChangeTokenInvalidError,
    EmailUnchangedError,
    NewPasswordSameAsCurrentError,
    PasswordConfirmationMismatchError
};
