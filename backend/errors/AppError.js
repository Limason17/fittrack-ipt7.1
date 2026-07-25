class AppError extends Error {
    constructor({ status = 500, code = "INTERNAL_ERROR", message, fields, cause } = {}) {
        super(message || "An unexpected error occurred.", cause ? { cause } : undefined);
        this.name = this.constructor.name;
        this.status = status;
        this.code = code;
        this.fields = fields;
        this.expose = status < 500;
    }
}

class ValidationError extends AppError {
    constructor(fields, message = "The request contains invalid values.") {
        super({ status: 400, code: "VALIDATION_ERROR", message, fields });
    }
}

class AuthenticationError extends AppError {
    constructor(message = "Authentication is required.") {
        super({ status: 401, code: "AUTHENTICATION_REQUIRED", message });
    }
}

class AuthorizationError extends AppError {
    constructor(message = "You are not allowed to perform this action.") {
        super({ status: 403, code: "FORBIDDEN", message });
    }
}

class NotFoundError extends AppError {
    constructor(message = "The requested resource was not found.") {
        super({ status: 404, code: "NOT_FOUND", message });
    }
}

class ConflictError extends AppError {
    constructor(message = "The request conflicts with the current resource state.", code = "CONFLICT") {
        super({ status: 409, code, message });
    }
}

class ServiceUnavailableError extends AppError {
    constructor(message = "The service is temporarily unavailable.") {
        super({ status: 503, code: "SERVICE_UNAVAILABLE", message });
    }
}

class RateLimitError extends AppError {
    constructor(message = "Too many requests. Please try again later.", code = "RATE_LIMIT_EXCEEDED") {
        super({ status: 429, code, message });
    }
}

module.exports = {
    AppError,
    AuthenticationError,
    AuthorizationError,
    ConflictError,
    NotFoundError,
    RateLimitError,
    ServiceUnavailableError,
    ValidationError
};
