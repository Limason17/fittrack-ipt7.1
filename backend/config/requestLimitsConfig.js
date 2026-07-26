// Section 16: no unbounded JSON body is ever accepted. The limit itself is
// still just a string handed to body-parser's own size parser ("256kb",
// "1mb", a plain byte count) - validated here, eagerly, so a malformed
// value is a startup error (created via createApp() at process start) and
// not a surprise on the first request that happens to hit body-parser's own
// parsing of it.
//
// There is deliberately no REQUEST_FORM_LIMIT here despite it being one of
// the task's own examples: this API has no express.urlencoded()/multipart
// parser mounted anywhere (it is a pure JSON API - see startup/app.js), so
// a form-body size limit would configure a parser that does not exist. See
// docs/STAGE_3D_SECURITY_HARDENING.md for this scoping decision.
const DEFAULT_JSON_LIMIT = "256kb";

function requestLimitsConfigError(message) {
    const error = new Error(message);
    error.code = "INVALID_REQUEST_LIMITS_CONFIG";
    return error;
}

const SIZE_PATTERN = /^\d+(?:\.\d+)?(b|kb|mb)?$/i;

function validateSize(value, name) {
    if (typeof value !== "string" || !SIZE_PATTERN.test(value.trim())) {
        throw requestLimitsConfigError(`${name} must be a byte size like "256kb", "1mb", or a plain byte count.`);
    }
    return value.trim();
}

function readRequestLimitsConfig(env = process.env) {
    const rawJsonLimit = env.REQUEST_JSON_LIMIT;
    const jsonLimit = validateSize(
        rawJsonLimit === undefined || rawJsonLimit === "" ? DEFAULT_JSON_LIMIT : rawJsonLimit,
        "REQUEST_JSON_LIMIT"
    );
    return Object.freeze({ jsonLimit });
}

module.exports = { DEFAULT_JSON_LIMIT, readRequestLimitsConfig };
