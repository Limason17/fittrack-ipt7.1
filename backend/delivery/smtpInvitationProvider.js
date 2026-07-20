const { buildInvitationEmail } = require("./invitationEmailTemplate");
const { createStructuredLogger } = require("../startup/logger");

// Internal error-class taxonomy for structured logging only. The caller
// (invitationDelivery.js -> studioService.js) already collapses every
// delivery failure into the same generic, safe application error; these
// classes never reach the HTTP client, only the logger.
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
    const error = new Error("Invitation e-mail provider is unavailable.");
    error.code = "INVITATION_PROVIDER_UNAVAILABLE";
    return error;
}

// A single reusable transport instance is created once per provider and
// reused across every send; nodemailer manages its own connection pooling
// internally, so this deliberately never re-creates a transport per
// recipient. There is no built-in retry: a failed send throws once, letting
// the existing outbox/delivery layer run its established compensation
// (revoke the pending invitation) instead of risking a duplicate send.
function createSmtpInvitationProvider({
    config,
    transportFactory,
    logger = createStructuredLogger(),
    now = () => Date.now()
} = {}) {
    if (!config || config.provider !== "smtp") {
        throw new TypeError("SMTP invitation provider requires a validated SMTP config.");
    }

    // eslint-disable-next-line global-require -- lazy require keeps nodemailer out of any code path that never enables SMTP delivery
    const nodemailer = require("nodemailer");
    const createTransport = transportFactory || nodemailer.createTransport;

    const transport = createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        // STARTTLS is mandatory whenever the connection is not already
        // implicitly encrypted; there is no unencrypted fallback in any
        // environment. Certificate verification is always the nodemailer
        // default (rejectUnauthorized: true) and is never overridden.
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

    async function sendInvitation({ email, studioName, role, expiresAt, acceptanceUrl, locale, requestId }) {
        if (typeof email !== "string" || !email.trim()) {
            throw new TypeError("sendInvitation requires a recipient e-mail address.");
        }
        const { subject, text, html } = buildInvitationEmail({ studioName, role, acceptanceUrl, expiresAt, locale });
        const startedAt = now();
        try {
            await transport.sendMail({
                from: config.fromName ? `"${config.fromName}" <${config.fromEmail}>` : config.fromEmail,
                to: email,
                replyTo: config.replyTo,
                subject,
                text,
                html
            });
            log("info", "invitation_email_send_succeeded", {
                requestId,
                provider: "smtp",
                durationMs: now() - startedAt
            });
        } catch (error) {
            const errorClass = classifyError(error);
            log("error", "invitation_email_send_failed", {
                requestId,
                provider: "smtp",
                errorClass,
                durationMs: now() - startedAt
            });
            throw providerUnavailableError();
        }
    }

    async function close() {
        if (typeof transport.close === "function") {
            transport.close();
        }
    }

    return { sendInvitation, close };
}

module.exports = {
    ERROR_CLASSES,
    classifyError,
    createSmtpInvitationProvider
};
