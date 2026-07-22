const { ValidationError } = require("../errors/AppError");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LIMITS = Object.freeze({
    username: 50,
    email: 120,
    passwordMin: 6,
    passwordMax: 128
});

function invalid(field, message) {
    throw new ValidationError({ [field]: message });
}

function requiredString(value, field, maxLength) {
    if (typeof value !== "string") {
        invalid(field, "This field must be a string.");
    }
    const normalized = value.trim();
    if (!normalized) {
        invalid(field, "This field is required.");
    }
    if (normalized.length > maxLength) {
        invalid(field, `This field must contain at most ${maxLength} characters.`);
    }
    return normalized;
}

function validateEmail(value) {
    const email = requiredString(value, "email", LIMITS.email).toLowerCase();
    const [localPart] = email.split("@");
    if (!EMAIL_PATTERN.test(email) || localPart.length > 64) {
        invalid("email", "A valid e-mail address is required.");
    }
    return email;
}

function validatePassword(value, { enforceMinimum }) {
    if (typeof value !== "string") {
        invalid("password", "The password must be a string.");
    }
    if (enforceMinimum && value.length < LIMITS.passwordMin) {
        invalid("password", `The password must contain at least ${LIMITS.passwordMin} characters.`);
    }
    if (!value || value.length > LIMITS.passwordMax) {
        invalid("password", `The password must contain at most ${LIMITS.passwordMax} characters.`);
    }
    return value;
}

function requiredRawString(value, field) {
    if (typeof value !== "string" || value.length === 0) {
        invalid(field, "This field is required.");
    }
    return value;
}

function allowedPreference(value, field, allowed, fallback) {
    if (value === undefined || value === null || value === "") {
        return fallback;
    }
    if (typeof value !== "string" || !allowed.includes(value)) {
        invalid(field, `Allowed values are: ${allowed.join(", ")}.`);
    }
    return value;
}

function validateRegistrationPayload(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        invalid("body", "A JSON object is required.");
    }

    return {
        username: requiredString(body.username, "username", LIMITS.username),
        email: validateEmail(body.email),
        password: validatePassword(body.password, { enforceMinimum: true }),
        language_preference: allowedPreference(
            body.language_preference ?? body.language,
            "language_preference",
            ["de", "en"],
            "de"
        ),
        weight_unit: allowedPreference(body.weight_unit, "weight_unit", ["kg", "lb"], "kg"),
        distance_unit: allowedPreference(body.distance_unit, "distance_unit", ["km", "mi"], "km")
    };
}

function validateLoginPayload(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        invalid("body", "A JSON object is required.");
    }
    return {
        email: validateEmail(body.email),
        password: validatePassword(body.password, { enforceMinimum: false })
    };
}

// Reuses the exact same password policy as registration (validatePassword)
// rather than a parallel "account" password policy - Stage 3A's audit found
// no dedicated PASSWORD_POLICY_VIOLATION code anywhere in the codebase, and
// registration itself already reports policy violations as the generic
// VALIDATION_ERROR envelope. A change-password endpoint following a
// different contract for the identical underlying rule would be a needless
// inconsistency, not a security improvement.
function validateChangePasswordPayload(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        invalid("body", "A JSON object is required.");
    }
    return {
        currentPassword: requiredRawString(body.currentPassword, "currentPassword"),
        newPassword: validatePassword(body.newPassword, { enforceMinimum: true }),
        newPasswordConfirmation: requiredRawString(body.newPasswordConfirmation, "newPasswordConfirmation")
    };
}

function validateEmailChangeRequestPayload(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        invalid("body", "A JSON object is required.");
    }
    return {
        newEmail: validateEmail(body.newEmail),
        currentPassword: requiredRawString(body.currentPassword, "currentPassword")
    };
}

function validateEmailChangeConfirmPayload(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        invalid("body", "A JSON object is required.");
    }
    return {
        token: requiredRawString(body.token, "token")
    };
}

module.exports = {
    EMAIL_PATTERN,
    LIMITS,
    validateChangePasswordPayload,
    validateEmail,
    validateEmailChangeConfirmPayload,
    validateEmailChangeRequestPayload,
    validateLoginPayload,
    validatePassword,
    validateRegistrationPayload
};
