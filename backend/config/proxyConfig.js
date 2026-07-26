// Section 12: client-IP trust is explicit and fails closed by default.
// Express only rewrites req.ip/req.ips from X-Forwarded-For when
// `app.set('trust proxy', <hops>)` is configured with a specific hop count
// - never `app.set('trust proxy', true)`, which would trust an arbitrary
// number of hops and let any client simply prepend its own fake address to
// X-Forwarded-For to be believed. TRUST_PROXY_MODE=disabled (the
// development/test default) means Express never looks at that header at
// all: req.ip is always the raw TCP peer address, so no request body or
// header a client controls can influence a rate-limit key or a log entry's
// client IP. TRUST_PROXY_MODE=hops requires an explicit, bounded
// TRUST_PROXY_HOPS - the exact number of reverse proxies between the
// client and this process - so only that many trusted hops are stripped
// off X-Forwarded-For before the remaining (untrusted, client-controlled)
// prefix is discarded.
function proxyConfigError(message) {
    const error = new Error(message);
    error.code = "INVALID_PROXY_CONFIG";
    return error;
}

const VALID_MODES = new Set(["disabled", "hops"]);

function readProxyConfig(env = process.env) {
    const production = env.NODE_ENV === "production";
    const rawMode = typeof env.TRUST_PROXY_MODE === "string" ? env.TRUST_PROXY_MODE.trim() : "";

    if (production && !rawMode) {
        throw proxyConfigError("TRUST_PROXY_MODE must be explicitly configured in production (\"disabled\" or \"hops\").");
    }

    const mode = rawMode || "disabled";
    if (!VALID_MODES.has(mode)) {
        throw proxyConfigError('TRUST_PROXY_MODE must be exactly "disabled" or "hops".');
    }

    if (mode === "disabled") {
        const hopsValue = env.TRUST_PROXY_HOPS;
        if (hopsValue !== undefined && hopsValue !== null && hopsValue !== "" && Number(hopsValue) !== 0) {
            throw proxyConfigError('TRUST_PROXY_HOPS must be unset or 0 when TRUST_PROXY_MODE="disabled".');
        }
        return Object.freeze({ mode, hops: 0 });
    }

    // mode === "hops"
    const hops = Number(env.TRUST_PROXY_HOPS);
    if (!Number.isInteger(hops) || hops < 1 || hops > 10) {
        throw proxyConfigError('TRUST_PROXY_HOPS must be an integer between 1 and 10 when TRUST_PROXY_MODE="hops".');
    }
    return Object.freeze({ mode, hops });
}

module.exports = { readProxyConfig };
