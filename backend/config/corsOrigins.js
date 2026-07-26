// Extracted out of startup/app.js so both the CORS middleware and the
// Stage 3B2 auth-endpoint Origin guard (security/originGuard.js) can share
// exactly one parsed allowlist without app.js needing to require the auth
// router (which itself needs this list) - avoids a circular require.
//
// Stage 3D hardens this beyond a bare list of strings: CORS_ALLOWED_ORIGINS
// (renamed from the earlier CORS_ORIGIN - this app has no external
// deployment yet, so a clean rename was preferred over carrying two
// supported names) is validated as full origins only (scheme+host+port, no
// path/query/fragment, no wildcards), production forbids http and
// localhost/loopback entries outright, duplicates are removed, and an
// invalid value is a startup error (created via createApp() at process
// start - see server.js's main()), never a request-time surprise.
const DEFAULT_MAX_AGE_SECONDS = 600;

function corsConfigError(message) {
    const error = new Error(message);
    error.code = "INVALID_CORS_CONFIG";
    return error;
}

function isLoopbackHostname(hostname) {
    // URL#hostname keeps the brackets for an IPv6 literal (e.g. "[::1]"),
    // unlike req.socket.remoteAddress-style bare addresses - strip them
    // before comparing so both forms are recognized.
    const bare = hostname.startsWith("[") && hostname.endsWith("]")
        ? hostname.slice(1, -1)
        : hostname;
    return bare === "localhost" ||
        /^127(\.\d{1,3}){3}$/.test(bare) ||
        bare === "::1";
}

// Parsed structurally (pathname/search/hash/credentials), not by comparing
// the raw string back against `.origin` verbatim - the latter would also
// reject harmless case differences ("HTTPS://Example.COM") and an explicit
// default port ("https://example.com:443"), which Section 13 explicitly
// wants normalized away, not rejected. `.origin` itself always reproduces
// exactly scheme+host+(non-default)port with the host lowercased, which is
// what makes a suffix/lookalike attack like "https://example.com.evil.test"
// impossible to confuse with "https://example.com" once normalized this
// way - they remain two different, exactly-compared strings, never a
// substring or regex match.
function parseOrigin(rawOrigin, { production }) {
    let parsed;
    try {
        parsed = new URL(rawOrigin);
    } catch (cause) {
        throw corsConfigError(
            `CORS_ALLOWED_ORIGINS must contain valid absolute URLs (invalid entry: "${rawOrigin}").`,
            { cause }
        );
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
        throw corsConfigError(`CORS_ALLOWED_ORIGINS entries must use http or https (invalid entry: "${rawOrigin}").`);
    }
    const hasExtraComponents = (parsed.pathname !== "/" && parsed.pathname !== "") ||
        parsed.search !== "" ||
        parsed.hash !== "" ||
        parsed.username !== "" ||
        parsed.password !== "";
    if (hasExtraComponents) {
        throw corsConfigError(
            `CORS_ALLOWED_ORIGINS entries must be origins only - no path, query, fragment, or credentials (invalid entry: "${rawOrigin}").`
        );
    }

    const hostname = parsed.hostname.toLowerCase();
    if (production) {
        if (parsed.protocol !== "https:") {
            throw corsConfigError(`CORS_ALLOWED_ORIGINS must use https in production (invalid entry: "${rawOrigin}").`);
        }
        if (isLoopbackHostname(hostname)) {
            throw corsConfigError(
                `CORS_ALLOWED_ORIGINS must not use localhost/loopback in production (invalid entry: "${rawOrigin}").`
            );
        }
    }

    return parsed.origin.toLowerCase();
}

function allowedOrigins(env = process.env) {
    const production = env.NODE_ENV === "production";
    const raw = typeof env.CORS_ALLOWED_ORIGINS === "string" ? env.CORS_ALLOWED_ORIGINS : "";
    const seen = new Set();
    const origins = [];
    for (const entry of raw.split(",").map((origin) => origin.trim()).filter(Boolean)) {
        const normalized = parseOrigin(entry, { production });
        if (!seen.has(normalized)) {
            seen.add(normalized);
            origins.push(normalized);
        }
    }
    return origins;
}

function readBooleanFlag(value, fallback, name) {
    if (value === undefined || value === null || value === "") {
        return fallback;
    }
    if (value === "true") return true;
    if (value === "false") return false;
    throw corsConfigError(`${name} must be exactly "true" or "false" when set.`);
}

function readPositiveIntegerOrZero(value, fallback, name) {
    if (value === undefined || value === null || value === "") {
        return fallback;
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw corsConfigError(`${name} must be a non-negative integer.`);
    }
    return parsed;
}

// The full contract used by startup/app.js's CORS wiring - `allowedOrigins`
// above stays separately exported because security/originGuard.js only
// needs the plain origin list, not credentials/max-age.
function readCorsConfig(env = process.env) {
    return Object.freeze({
        allowedOrigins: allowedOrigins(env),
        allowCredentials: readBooleanFlag(env.CORS_ALLOW_CREDENTIALS, true, "CORS_ALLOW_CREDENTIALS"),
        maxAgeSeconds: readPositiveIntegerOrZero(env.CORS_MAX_AGE_SECONDS, DEFAULT_MAX_AGE_SECONDS, "CORS_MAX_AGE_SECONDS")
    });
}

module.exports = { allowedOrigins, isLoopbackHostname, readCorsConfig };
