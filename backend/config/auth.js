const DEVELOPMENT_SECRET = "fittrack-local-development-secret-not-for-production";
const PLACEHOLDER_SECRETS = new Set([
    "change-this-secret",
    "replace-with-a-random-secret-of-at-least-32-characters",
    "fittrack-development-secret",
    DEVELOPMENT_SECRET
]);

function authConfigError(message) {
    const error = new Error(message);
    error.code = "INVALID_AUTH_CONFIG";
    return error;
}

function readAuthConfig(env = process.env) {
    const production = env.NODE_ENV === "production";
    const configuredSecret = typeof env.JWT_SECRET === "string"
        ? env.JWT_SECRET.trim()
        : "";
    const secret = configuredSecret || (production ? "" : DEVELOPMENT_SECRET);

    if (!secret) {
        throw authConfigError("JWT_SECRET must be configured.");
    }
    if (production && (secret.length < 32 || PLACEHOLDER_SECRETS.has(secret))) {
        throw authConfigError(
            "JWT_SECRET must be a unique production secret with at least 32 characters."
        );
    }
    if (!production && secret.length < 16) {
        throw authConfigError("JWT_SECRET must contain at least 16 characters.");
    }

    return { JWT_SECRET: secret };
}

const { JWT_SECRET } = readAuthConfig();

module.exports = {
    DEVELOPMENT_SECRET,
    JWT_SECRET,
    readAuthConfig
};
