const { AppError } = require("../errors/AppError");
const { readSmtpConfig } = require("../config/smtpConfig");
const { createSmtpAccountEmailProvider } = require("./smtpAccountEmailProvider");

// Mirrors invitationDelivery.js's forbidRealTransportInTest exactly (see
// that file for the full incident history this guards against). Duplicated
// rather than imported: it is not part of that module's exported surface,
// and Stage 3A's audit explicitly flagged the existing SMTP adapter
// contract from Stage 2A as something a later stage should not modify
// without a new, explicit approval. Adding a second, independent choke
// point here carries none of that risk while providing the identical
// safety property for the new account-email code path.
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

function resolveDefaultAccountProvider(env, { transportFactory } = {}) {
    const config = readSmtpConfig(env);
    if (!config) return undefined;
    forbidRealTransportInTest(env, transportFactory);
    return createSmtpAccountEmailProvider({ config, transportFactory });
}

function deliveryUnavailable() {
    return new AppError({
        status: 503,
        code: "ACCOUNT_EMAIL_DELIVERY_UNAVAILABLE",
        message: "Account e-mail delivery is not configured."
    });
}

// Deliberately a distinct startup-configuration error code, not
// ACCOUNT_EMAIL_DELIVERY_UNAVAILABLE - see invitationDelivery.js's
// invalidAcceptanceBaseUrlConfig for why conflating a request-time
// "not configured" failure with a startup-time "misconfigured" failure
// is a mistake worth avoiding twice.
function invalidConfirmBaseUrlConfig() {
    const error = new Error(
        "INVITATION_ACCEPT_BASE_URL must be a syntactically valid https:// URL (no credentials, no query/fragment) in production."
    );
    error.code = "INVALID_EMAIL_CHANGE_CONFIRM_BASE_URL";
    return error;
}

function parseConfirmBaseUrl(baseUrl, { requireHttps = false } = {}) {
    if (typeof baseUrl !== "string" || !baseUrl.trim()) {
        throw new TypeError("Email change confirmation base URL is required.");
    }
    const parsed = new URL(baseUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new TypeError("Email change confirmation base URL must use HTTP(S).");
    }
    if (requireHttps && parsed.protocol !== "https:") {
        throw new TypeError("Production email change confirmation URL must use HTTPS.");
    }
    if (parsed.username || parsed.password) {
        throw new TypeError("Email change confirmation base URL must not contain credentials.");
    }
    if (parsed.search || parsed.hash) {
        throw new TypeError("Email change confirmation base URL must not contain query or fragment data.");
    }
    return parsed;
}

function confirmationUrl(baseUrl, token) {
    const parsed = parseConfirmBaseUrl(baseUrl);
    parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}/account/email-change/${encodeURIComponent(token)}`;
    return parsed.toString();
}

// Reuses INVITATION_ACCEPT_BASE_URL rather than a second, separately
// configured base-URL env var - both links point at the exact same
// frontend origin (only the path differs: /invitations/:token vs.
// /account/email-change/:token), so a dedicated
// EMAIL_CHANGE_CONFIRM_BASE_URL would just be one more thing an operator
// has to remember to keep in sync with the existing one for no benefit.
function createAccountEmailDelivery({ env = process.env, provider } = {}) {
    const production = env.NODE_ENV === "production";
    const baseUrl = env.INVITATION_ACCEPT_BASE_URL || (production ? null : "http://localhost:5173");

    if (production) {
        try {
            parseConfirmBaseUrl(baseUrl, { requireHttps: true });
        } catch {
            throw invalidConfirmBaseUrlConfig();
        }
    }

    if (provider) {
        if (typeof provider.sendEmailChangeConfirmation !== "function") {
            throw new TypeError("Account e-mail provider must implement sendEmailChangeConfirmation.");
        }
        return {
            assertAvailable() {},
            async sendConfirmation({ token, newEmail, expiresAt, locale, requestId }) {
                const url = confirmationUrl(baseUrl, token);
                await provider.sendEmailChangeConfirmation({
                    newEmail, confirmUrl: url, expiresAt, locale, requestId
                });
                return { delivered: true };
            },
            // Best-effort: a failure here must never fail the overall
            // request or leave the just-created request row un-revoked -
            // the confirmation e-mail (above) is the one whose failure
            // triggers compensation, since it is the only channel that
            // proves ownership of the new address. Errors are logged and
            // swallowed by the caller (accountService.js).
            async sendNotificationBestEffort({ oldEmail, newEmail, locale, requestId }) {
                if (typeof provider.sendEmailChangeNotification !== "function") return;
                await provider.sendEmailChangeNotification({ oldEmail, newEmail, locale, requestId });
            }
        };
    }

    if (production) {
        return {
            assertAvailable() {
                throw deliveryUnavailable();
            },
            async sendConfirmation() {
                throw deliveryUnavailable();
            },
            async sendNotificationBestEffort() {}
        };
    }

    return {
        assertAvailable() {},
        async sendConfirmation({ token }) {
            return {
                delivered: false,
                confirmUrl: confirmationUrl(baseUrl, token)
            };
        },
        async sendNotificationBestEffort() {}
    };
}

module.exports = {
    confirmationUrl,
    createAccountEmailDelivery,
    deliveryUnavailable,
    parseConfirmBaseUrl,
    resolveDefaultAccountProvider
};
