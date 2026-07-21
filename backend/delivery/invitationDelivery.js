const { AppError } = require("../errors/AppError");
const { readSmtpConfig } = require("../config/smtpConfig");
const { createSmtpInvitationProvider } = require("./smtpInvitationProvider");

// Resolves the production provider purely from environment configuration.
// Returns undefined (never throws) when INVITATION_EMAIL_PROVIDER is not
// set to "smtp" - the default in every environment. Once explicitly
// enabled, an invalid configuration throws synchronously, which is exactly
// the "detected early at startup" behaviour required of it.
//
// This is a plain, exported function, deliberately NOT wired in as a
// hidden createInvitationDelivery() default parameter: a prior production
// incident traced back to exactly that pattern, repeated independently
// across three separate router modules that each defaulted their own
// studio service. Each one silently re-resolved (and reconstructed a
// fresh Nodemailer transport for) the "current" SMTP provider as an
// invisible side effect of its own default-parameter evaluation, with no
// single place in the code that visibly showed which one instance the
// running server actually used for a given request. The single, explicit
// composition root in startup/app.js now calls this function itself,
// exactly once, and threads the result down explicitly - see
// createDefaultStudioService() there.
// Hard safety invariant, independent of any individual test file remembering
// to clear INVITATION_EMAIL_PROVIDER: a prior incident (a bounce e-mail
// arriving at a real inbox for a synthetic @example.test test fixture)
// showed that a developer's real local backend/.env can leak real SMTP_*
// values into an automated test process via config/db.js's dotenv
// fill-only-missing-keys fallback. This is the single choke point every
// non-test-injected SMTP provider passes through, so it is also the single
// place that refuses to build a real, network-capable transport while
// NODE_ENV=test - regardless of what leaked in from the environment. Tests
// that intentionally exercise the SMTP path always inject an explicit
// (fake) transportFactory, which this check exempts.
function forbidRealTransportInTest(env, transportFactory) {
    if (env.NODE_ENV === "test" && !transportFactory) {
        const error = new Error(
            "Refusing to construct a real SMTP network transport while NODE_ENV=test. " +
            "Inject an explicit transportFactory (a fake/stub) if this test intends to exercise SMTP delivery."
        );
        error.code = "REAL_SMTP_TRANSPORT_FORBIDDEN_IN_TEST";
        throw error;
    }
}

function resolveDefaultProvider(env, { transportFactory } = {}) {
    const config = readSmtpConfig(env);
    if (!config) return undefined;
    forbidRealTransportInTest(env, transportFactory);
    return createSmtpInvitationProvider({ config, transportFactory });
}

function deliveryUnavailable() {
    return new AppError({
        status: 503,
        code: "INVITATION_DELIVERY_UNAVAILABLE",
        message: "Invitation delivery is not configured."
    });
}

// A distinct, stable startup-configuration error - deliberately not
// INVITATION_DELIVERY_UNAVAILABLE. A prior incident showed that reusing that
// request-time code for what is actually an invalid *configuration* made two
// unrelated root causes (no provider configured vs. a provider configured
// but with a production-invalid acceptance URL) indistinguishable from the
// client/log perspective, since both produced byte-identical 503 responses.
// This one is thrown synchronously during composition (never at request
// time) so a misconfigured production deployment fails to start instead of
// starting successfully and only failing on the first invitation request.
// Never includes the offending URL value - it is a config mistake, not
// something that needs to be reproduced from the error.
function invalidAcceptanceBaseUrlConfig() {
    const error = new Error(
        "INVITATION_ACCEPT_BASE_URL must be a syntactically valid https:// URL (no credentials, no query/fragment) in production."
    );
    error.code = "INVALID_INVITATION_ACCEPT_BASE_URL";
    return error;
}

function parseAcceptanceBaseUrl(baseUrl, { requireHttps = false } = {}) {
    if (typeof baseUrl !== "string" || !baseUrl.trim()) {
        throw new TypeError("Invitation acceptance base URL is required.");
    }
    const parsed = new URL(baseUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new TypeError("Invitation acceptance base URL must use HTTP(S).");
    }
    if (requireHttps && parsed.protocol !== "https:") {
        throw new TypeError("Production invitation acceptance URL must use HTTPS.");
    }
    if (parsed.username || parsed.password) {
        throw new TypeError("Invitation acceptance base URL must not contain credentials.");
    }
    if (parsed.search || parsed.hash) {
        throw new TypeError("Invitation acceptance base URL must not contain query or fragment data.");
    }
    return parsed;
}

function acceptanceUrl(baseUrl, token) {
    const parsed = parseAcceptanceBaseUrl(baseUrl);
    parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}/invitations/${encodeURIComponent(token)}`;
    return parsed.toString();
}

function createInvitationDelivery({ env = process.env, provider } = {}) {
    const production = env.NODE_ENV === "production";
    const baseUrl = env.INVITATION_ACCEPT_BASE_URL || (production ? null : "http://localhost:5173");

    // Fail fast, once, during composition - not lazily on the first
    // invitation request. In production the acceptance URL is required
    // regardless of whether a delivery provider ends up configured: it is
    // the same startup contract either way, and a fail-closed "no provider"
    // production deployment should not be able to silently carry an invalid
    // acceptance URL that nobody notices until the provider is turned on.
    if (production) {
        try {
            parseAcceptanceBaseUrl(baseUrl, { requireHttps: true });
        } catch {
            throw invalidAcceptanceBaseUrlConfig();
        }
    }

    if (provider) {
        if (typeof provider.sendInvitation !== "function") {
            throw new TypeError("Invitation provider must implement sendInvitation.");
        }
        return {
            // baseUrl was already validated eagerly above and is immutable
            // for the lifetime of this delivery instance, so there is
            // nothing left to assert lazily.
            assertAvailable() {},
            async send({ token, email, studioName, role, expiresAt, locale, requestId }) {
                const url = acceptanceUrl(baseUrl, token);
                await provider.sendInvitation({
                    email, studioName, role, expiresAt, locale, requestId, acceptanceUrl: url
                });
                return { delivered: true };
            }
        };
    }

    if (production) {
        return {
            assertAvailable() {
                throw deliveryUnavailable();
            },
            async send() {
                throw deliveryUnavailable();
            }
        };
    }

    return {
        assertAvailable() {},
        async send({ token }) {
            return {
                delivered: false,
                acceptUrl: acceptanceUrl(baseUrl, token)
            };
        }
    };
}

module.exports = {
    acceptanceUrl,
    createInvitationDelivery,
    deliveryUnavailable,
    parseAcceptanceBaseUrl,
    resolveDefaultProvider
};
