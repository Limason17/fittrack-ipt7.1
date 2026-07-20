const { AppError } = require("../errors/AppError");
const { readSmtpConfig } = require("../config/smtpConfig");
const { createSmtpInvitationProvider } = require("./smtpInvitationProvider");

// Resolves the production provider purely from environment configuration.
// Returns undefined (never throws) when INVITATION_EMAIL_PROVIDER is not
// set to "smtp" - the default in every environment - so requiring this
// module, or calling createInvitationDelivery() without an explicit
// provider, has no side effect for the overwhelming majority of callers
// (tests, dev, any deployment that has not opted in). Once explicitly
// enabled, an invalid configuration throws synchronously here, which is
// exactly the "detected early at startup" behaviour: this resolver only
// ever runs as a default-parameter expression evaluated once, the first
// time createInvitationDelivery() is called without an override - in the
// real process that happens while the studio router module is first
// required, i.e. at application boot, before any request is served.
function resolveDefaultProvider(env) {
    const config = readSmtpConfig(env);
    if (!config) return undefined;
    return createSmtpInvitationProvider({ config });
}

function deliveryUnavailable() {
    return new AppError({
        status: 503,
        code: "INVITATION_DELIVERY_UNAVAILABLE",
        message: "Invitation delivery is not configured."
    });
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

function createInvitationDelivery({ env = process.env, provider = resolveDefaultProvider(env) } = {}) {
    const production = env.NODE_ENV === "production";
    const baseUrl = env.INVITATION_ACCEPT_BASE_URL || (production ? null : "http://localhost:5173");

    if (provider) {
        if (typeof provider.sendInvitation !== "function") {
            throw new TypeError("Invitation provider must implement sendInvitation.");
        }
        function assertAvailable() {
            try {
                parseAcceptanceBaseUrl(baseUrl, { requireHttps: production });
            } catch (error) {
                if (production) throw deliveryUnavailable();
                throw error;
            }
        }
        return {
            assertAvailable,
            async send({ token, email, studioName, role, expiresAt, locale, requestId }) {
                assertAvailable();
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
    parseAcceptanceBaseUrl
};
