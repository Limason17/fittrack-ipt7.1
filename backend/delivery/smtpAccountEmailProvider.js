const {
    buildEmailChangeConfirmationEmail,
    buildEmailChangeNotificationEmail
} = require("./accountEmailTemplates");
const { createStructuredLogger } = require("../startup/logger");

// Mirrors smtpInvitationProvider.js's internal error-class taxonomy: used
// for structured logging only, never exposed to the HTTP client.
const ERROR_CLASSES = Object.freeze({
    CONFIG: "config",
    CONNECTION: "connection",
    TLS: "tls",
    AUTH: "auth",
    TIMEOUT: "timeout",
    RECIPIENT_REJECTED: "recipient_rejected",
    UNKNOWN: "unknown"
});

function classifyError(error) {
    const code = typeof error?.code === "string" ? error.code : "";
    const command = typeof error?.command === "string" ? error.command : "";
    if (code === "ETIMEDOUT" || code === "ETIME" || /timed out/i.test(error?.message || "")) {
        return ERROR_CLASSES.TIMEOUT;
    }
    if (code === "ENOTFOUND" || code === "ECONNREFUSED" || code === "ECONNRESET" || code === "EHOSTUNREACH") {
        return ERROR_CLASSES.CONNECTION;
    }
    if (code === "ESOCKET" || /certificate|tls|ssl/i.test(error?.message || "")) {
        return ERROR_CLASSES.TLS;
    }
    if (code === "EAUTH" || command === "AUTH") {
        return ERROR_CLASSES.AUTH;
    }
    if (code === "EENVELOPE" || command === "RCPT TO" || command === "DATA") {
        return ERROR_CLASSES.RECIPIENT_REJECTED;
    }
    return ERROR_CLASSES.UNKNOWN;
}

function providerUnavailableError() {
    const error = new Error("Account e-mail provider is unavailable.");
    error.code = "ACCOUNT_EMAIL_PROVIDER_UNAVAILABLE";
    return error;
}

// Reuses the same validated SMTP server configuration as the invitation
// provider (same INVITATION_EMAIL_PROVIDER=smtp opt-in switch, same
// SMTP_HOST/SMTP_PORT/... env vars) - it is the same mail server, just a
// different message. A single pooled transport is created once and reused
// across every send, matching smtpInvitationProvider.js exactly.
function createSmtpAccountEmailProvider({
    config,
    transportFactory,
    logger = createStructuredLogger(),
    now = () => Date.now()
} = {}) {
    if (!config || config.provider !== "smtp") {
        throw new TypeError("SMTP account e-mail provider requires a validated SMTP config.");
    }

    // Only requires nodemailer when no transportFactory was supplied - the
    // composition root (startup/app.js) injects one shared, already-lazy
    // factory into both this provider and the invitation provider so that
    // enabling SMTP delivery constructs exactly one real transport, not one
    // per feature that happens to use the same mail server.
    let createTransport = transportFactory;
    if (!createTransport) {
        // eslint-disable-next-line global-require -- lazy require keeps nodemailer out of any code path that never enables SMTP delivery
        createTransport = require("nodemailer").createTransport;
    }

    const transport = createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        requireTLS: !config.secure,
        auth: config.user ? { user: config.user, pass: config.password } : undefined,
        connectionTimeout: config.connectionTimeoutMs,
        greetingTimeout: config.greetingTimeoutMs,
        socketTimeout: config.socketTimeoutMs,
        pool: true,
        maxConnections: 1
    });

    function log(level, event, fields) {
        const method = typeof logger[level] === "function" ? logger[level] : logger.log;
        if (typeof method === "function") {
            method.call(logger, event, fields);
        }
    }

    async function send({ event, to, subject, text, html, requestId }) {
        if (typeof to !== "string" || !to.trim()) {
            throw new TypeError("send requires a recipient e-mail address.");
        }
        const startedAt = now();
        try {
            await transport.sendMail({
                from: config.fromName ? `"${config.fromName}" <${config.fromEmail}>` : config.fromEmail,
                to,
                replyTo: config.replyTo,
                subject,
                text,
                html
            });
            log("info", "account_email_send_succeeded", {
                requestId,
                provider: "smtp",
                event,
                durationMs: now() - startedAt
            });
        } catch (error) {
            const errorClass = classifyError(error);
            log("error", "account_email_send_failed", {
                requestId,
                provider: "smtp",
                event,
                errorClass,
                durationMs: now() - startedAt
            });
            throw providerUnavailableError();
        }
    }

    async function sendEmailChangeConfirmation({ newEmail, confirmUrl, expiresAt, locale, requestId }) {
        const { subject, text, html } = buildEmailChangeConfirmationEmail({ confirmUrl, expiresAt, locale });
        await send({ event: "email_change_confirmation", to: newEmail, subject, text, html, requestId });
    }

    async function sendEmailChangeNotification({ oldEmail, newEmail, locale, requestId }) {
        const { subject, text, html } = buildEmailChangeNotificationEmail({ newEmail, locale });
        await send({ event: "email_change_notification", to: oldEmail, subject, text, html, requestId });
    }

    async function close() {
        if (typeof transport.close === "function") {
            transport.close();
        }
    }

    return { sendEmailChangeConfirmation, sendEmailChangeNotification, close };
}

module.exports = {
    ERROR_CLASSES,
    classifyError,
    createSmtpAccountEmailProvider
};
