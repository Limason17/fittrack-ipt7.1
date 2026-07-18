const { AppError } = require("./AppError");

class StudioNotFoundError extends AppError {
    constructor() {
        super({ status: 404, code: "STUDIO_NOT_FOUND", message: "Studio not found." });
    }
}

class MembershipNotFoundError extends AppError {
    constructor() {
        super({ status: 404, code: "MEMBERSHIP_NOT_FOUND", message: "Membership not found." });
    }
}

class InsufficientStudioRoleError extends AppError {
    constructor() {
        super({
            status: 403,
            code: "INSUFFICIENT_STUDIO_ROLE",
            message: "The active studio role does not permit this action."
        });
    }
}

class LastOwnerRequiredError extends AppError {
    constructor() {
        super({
            status: 409,
            code: "LAST_OWNER_REQUIRED",
            message: "A studio must retain at least one active owner."
        });
    }
}

class InvitationInvalidError extends AppError {
    constructor() {
        super({ status: 404, code: "INVITATION_INVALID", message: "Invitation is invalid." });
    }
}

module.exports = {
    InsufficientStudioRoleError,
    InvitationInvalidError,
    LastOwnerRequiredError,
    MembershipNotFoundError,
    StudioNotFoundError
};
