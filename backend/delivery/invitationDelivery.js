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
function resolveDefaultProvider(env, { transportFactory } = {}) {
    const config = readSmtpConfig(env);
    if (!config) return undefined;
    return createSmtpInvitationProvider({ config, transportFactory });
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

function createInvitationDelivery({ env = process.env, provider } = {}) {
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
    parseAcceptanceBaseUrl,
    resolveDefaultProvider
};
