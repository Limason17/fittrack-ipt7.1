// Section 17: a single, explicit entry point that exercises every
// production-relevant config reader together and reports every problem
// found, not just the first.
//
// Honest limitation: config/auth.js, config/rateLimitConfig.js and
// config/sessionConfig.js (all pre-dating Stage 3D) validate eagerly at
// their own module top level, exactly like this file's own readers do when
// called directly - so in the real process boot sequence, one of those can
// still be the very first thing to throw, via whatever require() chain
// happens to load it first (see server.js's top-of-file requires), before
// this function ever runs. That does not weaken the actual guarantee
// (invalid configuration is still always a startup error, never a
// request-time surprise) - it just means this function's real value is
// running every check together and reporting every problem at once,
// rather than being the literal first line of code that can fail.
const { readAuthConfig } = require("./auth");
const { readRateLimitConfig } = require("./rateLimitConfig");
const { readSessionConfig } = require("./sessionConfig");
const { readCorsConfig } = require("./corsOrigins");
const { readProxyConfig } = require("./proxyConfig");
const { readRequestLimitsConfig } = require("./requestLimitsConfig");
const { readDatabaseConfig } = require("./db");

const CHECKS = [
    ["JWT_SECRET", (env) => readAuthConfig(env)],
    ["RATE_LIMIT_KEY_SECRET", (env) => readRateLimitConfig(env)],
    ["session/cookie configuration", (env) => readSessionConfig(env)],
    ["CORS configuration", (env) => readCorsConfig(env)],
    ["trust proxy configuration", (env) => readProxyConfig(env)],
    ["request size limits", (env) => readRequestLimitsConfig(env)],
    ["database connection settings", (env) => readDatabaseConfig(env)]
];

function validateStartupConfig(env = process.env) {
    const problems = [];
    for (const [label, check] of CHECKS) {
        try {
            check(env);
        } catch (error) {
            // Only ever the reader's own message - never a stack trace or
            // any other internal detail (Section 17: "keine Secrets in der
            // Meldung" applies equally to every individual reader's own
            // error message, which never includes the secret value itself).
            problems.push(`${label}: ${error.message}`);
        }
    }
    if (problems.length > 0) {
        const error = new Error(`Startup configuration is invalid:\n- ${problems.join("\n- ")}`);
        error.code = "INVALID_STARTUP_CONFIG";
        error.problems = problems;
        throw error;
    }
}

module.exports = { validateStartupConfig };
