const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Values that are obviously copy-pasted example/placeholder content rather
// than a real configured credential or host. Rejected in every environment,
// not only production, since a placeholder is never a valid configuration.
const PLACEHOLDER_VALUES = new Set([
    "changeme",
    "change-me",
    "change_me",
    "your-smtp-user",
    "your-smtp-password",
    "your-username",
    "your-password",
    "smtp-user",
    "smtp-password",
    "replace-me",
    "replace-with-your-smtp-user",
    "replace-with-your-smtp-password",
    "example",
    "example.com",
    "smtp.example.com",
    "user",
    "username",
    "password",
    "test",
    "xxx",
    "placeholder",
    "todo"
]);

function configError(message) {
    const error = new Error(message);
    error.code = "INVALID_SMTP_CONFIG";
    return error;
}

function isPlaceholder(value) {
    return PLACEHOLDER_VALUES.has(value.trim().toLowerCase());
}

function nonEmptyString(value, name) {
    if (typeof value !== "string" || !value.trim()) {
        throw configError(`${name} must be a non-empty string.`);
    }
    return value.trim();
}

function booleanSetting(value, name) {
    if (value === "true") return true;
    if (value === "false") return false;
    throw configError(`${name} must be exactly "true" or "false".`);
}

function integerSetting(value, fallback, name, { min, max }) {
    if (value === undefined || value === null || value === "") {
        return fallback;
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        throw configError(`${name} must be an integer between ${min} and ${max}.`);
    }
    return parsed;
}

function validEmail(value, name) {
    const normalized = nonEmptyString(value, name).toLowerCase();
    if (!EMAIL_PATTERN.test(normalized)) {
        throw configError(`${name} must be a syntactically valid e-mail address.`);
    }
    return normalized;
}

// Returns null when the SMTP provider is not explicitly enabled (the
// default in every environment). Only performs (and can only fail)
// validation once INVITATION_EMAIL_PROVIDER=smtp is set, so importing this
// module never has a side effect for the overwhelming majority of callers
// (tests, dev, any deployment that has not opted in).
function readSmtpConfig(env = process.env) {
    const provider = typeof env.INVITATION_EMAIL_PROVIDER === "string"
        ? env.INVITATION_EMAIL_PROVIDER.trim().toLowerCase()
        : "";
    if (provider !== "smtp") {
        return null;
    }

    const host = nonEmptyString(env.SMTP_HOST, "SMTP_HOST").toLowerCase();
    if (isPlaceholder(host)) {
        throw configError("SMTP_HOST must not be a placeholder value.");
    }

    const port = integerSetting(env.SMTP_PORT, undefined, "SMTP_PORT", { min: 1, max: 65535 });
    if (port === undefined) {
        throw configError("SMTP_PORT is required when INVITATION_EMAIL_PROVIDER=smtp.");
    }

    const secure = booleanSetting(env.SMTP_SECURE, "SMTP_SECURE");

    const rawUser = typeof env.SMTP_USER === "string" ? env.SMTP_USER.trim() : "";
    const rawPassword = typeof env.SMTP_PASSWORD === "string" ? env.SMTP_PASSWORD : "";
    const hasUser = rawUser.length > 0;
    const hasPassword = rawPassword.length > 0;
    if (hasUser !== hasPassword) {
        throw configError("SMTP_USER and SMTP_PASSWORD must either both be set or both be left empty.");
    }
    if (hasUser && isPlaceholder(rawUser)) {
        throw configError("SMTP_USER must not be a placeholder value.");
    }
    if (hasPassword && isPlaceholder(rawPassword)) {
        throw configError("SMTP_PASSWORD must not be a placeholder value.");
    }

    const fromEmail = validEmail(env.SMTP_FROM_EMAIL, "SMTP_FROM_EMAIL");
    const fromName = nonEmptyString(env.SMTP_FROM_NAME, "SMTP_FROM_NAME");
    if (fromName.length > 100) {
        throw configError("SMTP_FROM_NAME must be at most 100 characters.");
    }
    if (isPlaceholder(fromName)) {
        throw configError("SMTP_FROM_NAME must not be a placeholder value.");
    }

    let replyTo;
    if (typeof env.SMTP_REPLY_TO === "string" && env.SMTP_REPLY_TO.trim()) {
        replyTo = validEmail(env.SMTP_REPLY_TO, "SMTP_REPLY_TO");
    }

    const connectionTimeoutMs = integerSetting(
        env.SMTP_CONNECTION_TIMEOUT_MS, 10000, "SMTP_CONNECTION_TIMEOUT_MS", { min: 1000, max: 60000 }
    );
    const greetingTimeoutMs = integerSetting(
        env.SMTP_GREETING_TIMEOUT_MS, 10000, "SMTP_GREETING_TIMEOUT_MS", { min: 1000, max: 60000 }
    );
    const socketTimeoutMs = integerSetting(
        env.SMTP_SOCKET_TIMEOUT_MS, 20000, "SMTP_SOCKET_TIMEOUT_MS", { min: 1000, max: 120000 }
    );

    return Object.freeze({
        provider: "smtp",
        host,
        port,
        secure,
        user: hasUser ? rawUser : undefined,
        password: hasPassword ? rawPassword : undefined,
        fromEmail,
        fromName,
        replyTo,
        connectionTimeoutMs,
        greetingTimeoutMs,
        socketTimeoutMs
    });
}

module.exports = {
    configError,
    readSmtpConfig
};
