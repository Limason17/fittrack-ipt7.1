// Extracted out of startup/app.js so both the CORS middleware and the
// Stage 3B2 auth-endpoint Origin guard (security/originGuard.js) can share
// exactly one parsed allowlist without app.js needing to require the auth
// router (which itself needs this list) - avoids a circular require.
function allowedOrigins(env = process.env) {
    return (env.CORS_ORIGIN || "")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean)
        .map((origin) => {
            let parsed;
            try {
                parsed = new URL(origin);
            } catch (cause) {
                const error = new Error("CORS_ORIGIN must contain valid absolute URLs.", { cause });
                error.code = "INVALID_CORS_CONFIG";
                throw error;
            }
            if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== origin) {
                const error = new Error("CORS_ORIGIN entries must be HTTP(S) origins without paths.");
                error.code = "INVALID_CORS_CONFIG";
                throw error;
            }
            return parsed.origin.toLowerCase();
        });
}

module.exports = { allowedOrigins };
