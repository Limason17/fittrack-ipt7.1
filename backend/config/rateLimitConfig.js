// Mirrors config/auth.js's contract exactly: a pure function taking an
// injectable env (test seam), called once eagerly at module-require time so
// a bad configuration fails the process at startup, not on the first
// request. This secret is intentionally separate from JWT_SECRET - it keys
// the HMAC used to turn raw rate-limit identifiers (IP addresses, e-mail
// addresses, user IDs) into the key_hash stored in
// security_rate_limit_buckets (see database/migrations/011_security_rate_limits.js
// and rateLimiting/rateLimitKeys.js). Reusing JWT_SECRET here would mean a
// leak of either secret compromises both the session-signing and the
// rate-limit-key-derivation guarantees at once, for no benefit.
const DEVELOPMENT_SECRET = "fittrack-local-development-rate-limit-key-secret-not-for-production";
const PLACEHOLDER_SECRETS = new Set([
    "change-this-secret",
    "replace-with-a-random-secret-of-at-least-32-characters",
    "fittrack-development-secret",
    "fittrack-rate-limit-key-secret",
    DEVELOPMENT_SECRET
]);

function rateLimitConfigError(message) {
    const error = new Error(message);
    error.code = "INVALID_RATE_LIMIT_CONFIG";
    return error;
}

function readRateLimitConfig(env = process.env) {
    const production = env.NODE_ENV === "production";
    const configuredSecret = typeof env.RATE_LIMIT_KEY_SECRET === "string"
        ? env.RATE_LIMIT_KEY_SECRET.trim()
        : "";
    const secret = configuredSecret || (production ? "" : DEVELOPMENT_SECRET);

    if (!secret) {
        throw rateLimitConfigError("RATE_LIMIT_KEY_SECRET must be configured.");
    }
    if (production && (secret.length < 32 || PLACEHOLDER_SECRETS.has(secret))) {
        throw rateLimitConfigError(
            "RATE_LIMIT_KEY_SECRET must be a unique production secret with at least 32 characters."
        );
    }
    if (!production && secret.length < 16) {
        throw rateLimitConfigError("RATE_LIMIT_KEY_SECRET must contain at least 16 characters.");
    }

    // A leaked JWT_SECRET must not also compromise rate-limit key derivation
    // (and vice versa) - the two must be independent secrets even though
    // both are simple strings from the same .env file. Compared directly
    // against this SAME `env` object's own JWT_SECRET (not config/auth.js's
    // already-resolved module-level singleton) so this function stays a
    // pure, injectable function of its `env` argument, exactly like every
    // other config reader in this codebase.
    const configuredJwtSecret = typeof env.JWT_SECRET === "string" ? env.JWT_SECRET.trim() : "";
    if (configuredJwtSecret && secret === configuredJwtSecret) {
        throw rateLimitConfigError("RATE_LIMIT_KEY_SECRET must not be identical to JWT_SECRET.");
    }

    return { RATE_LIMIT_KEY_SECRET: secret };
}

const { RATE_LIMIT_KEY_SECRET } = readRateLimitConfig();

module.exports = {
    DEVELOPMENT_SECRET,
    RATE_LIMIT_KEY_SECRET,
    readRateLimitConfig
};
