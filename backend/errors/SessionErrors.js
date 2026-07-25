const { AppError } = require("./AppError");

// All fixed status/code/message, no per-instance parameters - mirrors
// AccountErrors.js's style exactly (each represents one precise failure
// mode; none of these need to vary by call site).

class AuthRefreshTokenInvalidError extends AppError {
    constructor() {
        super({
            status: 401,
            code: "AUTH_REFRESH_TOKEN_INVALID",
            message: "The refresh session is invalid. Please log in again."
        });
    }
}

class AuthRefreshTokenExpiredError extends AppError {
    constructor() {
        super({
            status: 401,
            code: "AUTH_REFRESH_TOKEN_EXPIRED",
            message: "The refresh session has expired. Please log in again."
        });
    }
}

class AuthRefreshReuseDetectedError extends AppError {
    constructor() {
        super({
            status: 401,
            code: "AUTH_REFRESH_REUSE_DETECTED",
            message: "The refresh session was invalidated for security reasons. Please log in again."
        });
    }
}

class AuthCsrfInvalidError extends AppError {
    constructor() {
        super({
            status: 403,
            code: "AUTH_CSRF_INVALID",
            message: "The request could not be verified. Please reload and try again."
        });
    }
}

class AuthOriginNotAllowedError extends AppError {
    constructor() {
        super({
            status: 403,
            code: "AUTH_ORIGIN_NOT_ALLOWED",
            message: "The request could not be verified. Please reload and try again."
        });
    }
}

class AuthSessionLimitReachedError extends AppError {
    constructor() {
        super({
            status: 409,
            code: "AUTH_SESSION_LIMIT_REACHED",
            message: "Too many active sessions. Please log out of another device and try again."
        });
    }
}

module.exports = {
    AuthCsrfInvalidError,
    AuthOriginNotAllowedError,
    AuthRefreshReuseDetectedError,
    AuthRefreshTokenExpiredError,
    AuthRefreshTokenInvalidError,
    AuthSessionLimitReachedError
};
