const { ValidationError } = require("../errors/AppError");
const { isPublicId } = require("../domain/studioDomain");

const LIMITS = Object.freeze({
    body: 2000
});

function fail(field, message) {
    throw new ValidationError({ [field]: message });
}

function plainObject(value, field = "body") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        fail(field, "A JSON object is required.");
    }
    return value;
}

function exactKeys(value, allowed) {
    plainObject(value);
    const keys = Object.keys(value);
    const unknown = keys.filter((key) => !allowed.includes(key));
    if (unknown.length > 0) {
        fail(unknown[0], "This field is not allowed.");
    }
}

function requiredPublicId(value, field) {
    if (!isPublicId(value)) {
        fail(field, "A UUID v4 public identifier is required.");
    }
    return value;
}

// ---- Create feedback ----

function validateCreateFeedbackPayload(body) {
    exactKeys(body, ["clientFeedbackKey", "body"]);
    const clientFeedbackKey = requiredPublicId(body.clientFeedbackKey, "clientFeedbackKey");
    if (typeof body.body !== "string") {
        fail("body", "This field must be a string.");
    }
    const trimmed = body.body.trim();
    if (!trimmed) {
        fail("body", "This field is required.");
    }
    if (trimmed.length > LIMITS.body) {
        fail("body", `This field must contain at most ${LIMITS.body} characters.`);
    }
    return { clientFeedbackKey, body: trimmed };
}

module.exports = {
    LIMITS,
    validateCreateFeedbackPayload
};
