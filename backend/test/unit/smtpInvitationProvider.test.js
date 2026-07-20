const test = require("node:test");
const assert = require("node:assert/strict");

const { readSmtpConfig } = require("../../config/smtpConfig");
const { classifyError, createSmtpInvitationProvider } = require("../../delivery/smtpInvitationProvider");

function config(overrides = {}) {
    return readSmtpConfig({
        INVITATION_EMAIL_PROVIDER: "smtp",
        SMTP_HOST: "smtp.fittrack-mail.test",
        SMTP_PORT: "587",
        SMTP_SECURE: "false",
        SMTP_USER: "fittrack-relay",
        SMTP_PASSWORD: "s3cure-relay-password",
        SMTP_FROM_EMAIL: "invitations@fittrack.test",
        SMTP_FROM_NAME: "FitTrack",
        ...overrides
    });
}

function fakeLogger() {
    const entries = [];
    return {
        entries,
        info(event, fields) { entries.push({ level: "info", event, fields }); },
        warn(event, fields) { entries.push({ level: "warn", event, fields }); },
        error(event, fields) { entries.push({ level: "error", event, fields }); }
    };
}

function fakeTransportFactory({ sendMail, closed = { value: false } } = {}) {
    let calls = 0;
    return {
        calls: () => calls,
        factory(options) {
            calls += 1;
            return {
                options,
                async sendMail(message) {
                    return sendMail ? sendMail(message) : { accepted: [message.to] };
                },
                close() { closed.value = true; }
            };
        }
    };
}

test("requires a validated SMTP config", () => {
    assert.throws(() => createSmtpInvitationProvider({ config: null }), TypeError);
    assert.throws(() => createSmtpInvitationProvider({ config: { provider: "console" } }), TypeError);
});

test("a fake transport is correctly injected and never touches a real network socket", async () => {
    const { factory, calls } = fakeTransportFactory();
    const provider = createSmtpInvitationProvider({
        config: config(),
        transportFactory: factory,
        logger: fakeLogger()
    });
    await provider.sendInvitation({
        email: "member@example.test",
        studioName: "Studio",
        role: "member",
        expiresAt: new Date("2026-08-01T00:00:00Z"),
        acceptanceUrl: "https://app.fittrack.test/invitations/token123"
    });
    assert.equal(calls(), 1);
});

test("reuses a single transport instance across multiple sends instead of recreating one per recipient", async () => {
    const { factory, calls } = fakeTransportFactory();
    const provider = createSmtpInvitationProvider({ config: config(), transportFactory: factory, logger: fakeLogger() });
    await provider.sendInvitation({
        email: "a@example.test", studioName: "Studio", role: "member",
        acceptanceUrl: "https://app.fittrack.test/invitations/a"
    });
    await provider.sendInvitation({
        email: "b@example.test", studioName: "Studio", role: "member",
        acceptanceUrl: "https://app.fittrack.test/invitations/b"
    });
    assert.equal(calls(), 1, "transport factory must be called exactly once, not once per send");
});

test("sends both text and HTML parts with the correct recipient and from address", async () => {
    let captured;
    const { factory } = fakeTransportFactory({ sendMail: async (message) => { captured = message; } });
    const provider = createSmtpInvitationProvider({
        config: config({ SMTP_FROM_NAME: "FitTrack" }), transportFactory: factory, logger: fakeLogger()
    });
    await provider.sendInvitation({
        email: "member@example.test",
        studioName: "Studio",
        role: "trainer",
        expiresAt: new Date("2026-08-01T00:00:00Z"),
        acceptanceUrl: "https://app.fittrack.test/invitations/token123"
    });
    assert.equal(captured.to, "member@example.test");
    assert.match(captured.from, /FitTrack/);
    assert.match(captured.from, /invitations@fittrack\.test/);
    assert.ok(captured.text.includes("https://app.fittrack.test/invitations/token123"));
    assert.ok(captured.html.includes("https://app.fittrack.test/invitations/token123"));
});

test("sets replyTo only when configured", async () => {
    let captured;
    const { factory } = fakeTransportFactory({ sendMail: async (message) => { captured = message; } });
    const withoutReplyTo = createSmtpInvitationProvider({ config: config(), transportFactory: factory, logger: fakeLogger() });
    await withoutReplyTo.sendInvitation({
        email: "member@example.test", studioName: "Studio", role: "member",
        acceptanceUrl: "https://app.fittrack.test/invitations/x"
    });
    assert.equal(captured.replyTo, undefined);

    const { factory: factory2 } = fakeTransportFactory({ sendMail: async (message) => { captured = message; } });
    const withReplyTo = createSmtpInvitationProvider({
        config: config({ SMTP_REPLY_TO: "support@fittrack.test" }), transportFactory: factory2, logger: fakeLogger()
    });
    await withReplyTo.sendInvitation({
        email: "member@example.test", studioName: "Studio", role: "member",
        acceptanceUrl: "https://app.fittrack.test/invitations/y"
    });
    assert.equal(captured.replyTo, "support@fittrack.test");
});

test("bounds transport timeouts to the configured values", () => {
    let captured;
    const factory = (options) => {
        captured = options;
        return { async sendMail() {}, close() {} };
    };
    createSmtpInvitationProvider({
        config: config({ SMTP_CONNECTION_TIMEOUT_MS: "5000", SMTP_GREETING_TIMEOUT_MS: "6000", SMTP_SOCKET_TIMEOUT_MS: "15000" }),
        transportFactory: factory,
        logger: fakeLogger()
    });
    assert.equal(captured.connectionTimeout, 5000);
    assert.equal(captured.greetingTimeout, 6000);
    assert.equal(captured.socketTimeout, 15000);
});

test("production TLS: secure=true never sets requireTLS, secure=false always sets requireTLS", () => {
    let capturedSecure;
    let capturedStartTls;
    const factory = (options) => {
        capturedSecure = options;
        return { async sendMail() {}, close() {} };
    };
    createSmtpInvitationProvider({ config: config({ SMTP_SECURE: "true" }), transportFactory: factory, logger: fakeLogger() });
    assert.equal(capturedSecure.secure, true);
    assert.equal(capturedSecure.requireTLS, false);

    const factory2 = (options) => {
        capturedStartTls = options;
        return { async sendMail() {}, close() {} };
    };
    createSmtpInvitationProvider({ config: config({ SMTP_SECURE: "false" }), transportFactory: factory2, logger: fakeLogger() });
    assert.equal(capturedStartTls.secure, false);
    assert.equal(capturedStartTls.requireTLS, true);
});

test("never disables certificate validation", () => {
    let captured;
    const factory = (options) => {
        captured = options;
        return { async sendMail() {}, close() {} };
    };
    createSmtpInvitationProvider({ config: config(), transportFactory: factory, logger: fakeLogger() });
    assert.equal(Object.hasOwn(captured, "tls"), false);
    assert.notEqual(captured.rejectUnauthorized, false);
});

test("a provider failure is normalized into a stable, safe error with no SMTP server text", async () => {
    const { factory } = fakeTransportFactory({
        sendMail: async () => { throw Object.assign(new Error("550 5.1.1 mailbox unavailable at relay.internal"), { code: "EENVELOPE", command: "RCPT TO" }); }
    });
    const provider = createSmtpInvitationProvider({ config: config(), transportFactory: factory, logger: fakeLogger() });
    await assert.rejects(
        provider.sendInvitation({
            email: "member@example.test", studioName: "Studio", role: "member",
            acceptanceUrl: "https://app.fittrack.test/invitations/z"
        }),
        (error) => {
            assert.equal(error.code, "INVITATION_PROVIDER_UNAVAILABLE");
            assert.equal(/mailbox unavailable|relay\.internal/i.test(error.message), false);
            return true;
        }
    );
});

test("classifyError recognizes connection, TLS, auth, timeout and recipient-rejection failures", () => {
    assert.equal(classifyError({ code: "ECONNREFUSED" }), "connection");
    assert.equal(classifyError({ code: "ENOTFOUND" }), "connection");
    assert.equal(classifyError({ code: "ETIMEDOUT" }), "timeout");
    assert.equal(classifyError({ code: "EAUTH" }), "auth");
    assert.equal(classifyError({ command: "AUTH" }), "auth");
    assert.equal(classifyError({ command: "RCPT TO" }), "recipient_rejected");
    assert.equal(classifyError({ message: "self-signed certificate" }), "tls");
    assert.equal(classifyError({ message: "something else entirely" }), "unknown");
});

test("does not automatically retry a failed send", async () => {
    let attempts = 0;
    const { factory } = fakeTransportFactory({ sendMail: async () => { attempts += 1; throw new Error("temporary failure"); } });
    const provider = createSmtpInvitationProvider({ config: config(), transportFactory: factory, logger: fakeLogger() });
    await assert.rejects(provider.sendInvitation({
        email: "member@example.test", studioName: "Studio", role: "member",
        acceptanceUrl: "https://app.fittrack.test/invitations/z"
    }));
    assert.equal(attempts, 1);
});

test("logs never contain the password, the acceptance URL, or the invitation token", async () => {
    const logger = fakeLogger();
    const { factory } = fakeTransportFactory();
    const provider = createSmtpInvitationProvider({ config: config(), transportFactory: factory, logger });
    await provider.sendInvitation({
        email: "member@example.test", studioName: "Studio", role: "member",
        acceptanceUrl: "https://app.fittrack.test/invitations/super-secret-token-value"
    });
    const serialized = JSON.stringify(logger.entries);
    assert.equal(serialized.includes("s3cure-relay-password"), false);
    assert.equal(serialized.includes("super-secret-token-value"), false);
    assert.equal(serialized.includes("member@example.test"), false);
});

test("logs a normalized error class, success/failure and duration, but not the raw SMTP response", async () => {
    const logger = fakeLogger();
    const { factory } = fakeTransportFactory({
        sendMail: async () => { throw Object.assign(new Error("535 bad auth"), { code: "EAUTH" }); }
    });
    const provider = createSmtpInvitationProvider({ config: config(), transportFactory: factory, logger });
    await assert.rejects(provider.sendInvitation({
        email: "member@example.test", studioName: "Studio", role: "member",
        acceptanceUrl: "https://app.fittrack.test/invitations/z"
    }));
    const failure = logger.entries.find((entry) => entry.event === "invitation_email_send_failed");
    assert.ok(failure);
    assert.equal(failure.fields.errorClass, "auth");
    assert.equal(failure.fields.provider, "smtp");
    assert.equal(typeof failure.fields.durationMs, "number");
    assert.equal(JSON.stringify(failure).includes("bad auth"), false);
});

test("close() shuts the transport down when requested", async () => {
    const closed = { value: false };
    const { factory } = fakeTransportFactory({ closed });
    const provider = createSmtpInvitationProvider({ config: config(), transportFactory: factory, logger: fakeLogger() });
    await provider.close();
    assert.equal(closed.value, true);
});

// The tests above capture the raw mailOptions object exactly as this module
// builds it - they prove the module passes the right fields through, but not
// that a real header-injection attempt is neutralized, since that sanitizing
// happens later, inside Nodemailer's own MIME/header composer. These tests
// route the same call through Nodemailer's real (network-free) stream
// transport, which does run that composer, to prove CRLF sequences in
// operator-controlled (SMTP_FROM_NAME, SMTP_REPLY_TO) and studio-owner-
// controlled (studio name, which reaches the Subject line) values can never
// break out into a second raw header line. No network access occurs.
function realComposedMessageTransportFactory() {
    // eslint-disable-next-line global-require -- only used by this dedicated composition test
    const nodemailer = require("nodemailer");
    const real = nodemailer.createTransport({ streamTransport: true, buffer: true });
    let composed;
    return {
        composed: () => composed,
        factory: () => ({
            async sendMail(message) {
                const info = await real.sendMail(message);
                composed = info.message.toString("utf8");
                return info;
            },
            close() {}
        })
    };
}

// Isolates just the header block (everything before the first blank line
// that separates headers from the body, per RFC 5322) and splits it into
// logical header entries, keeping folded continuation lines (which start
// with whitespace) attached to their parent header. Checking only this
// block - never the body - is required for a correct test: the body
// legitimately repeats the (attacker-controlled) studio name as visible
// text and would otherwise produce false positives that look like
// "injected headers" but are just ordinary paragraph content.
function extractHeaderLines(composedMessage) {
    const headerBlock = composedMessage.split(/\r\n\r\n/)[0];
    return headerBlock.split(/\r\n(?!\s)/).filter((line) => /^[A-Za-z-]+:/.test(line));
}

test("a CRLF injection attempt in SMTP_FROM_NAME cannot add a second raw header line to the real composed message", async () => {
    const { factory, composed } = realComposedMessageTransportFactory();
    const provider = createSmtpInvitationProvider({
        config: config({ SMTP_FROM_NAME: "FitTrack\r\nBcc: attacker@evil.test" }),
        transportFactory: factory,
        logger: fakeLogger()
    });
    await provider.sendInvitation({
        email: "member@example.test", studioName: "Studio", role: "member",
        acceptanceUrl: "https://app.fittrack.test/invitations/x"
    });
    const headerLines = extractHeaderLines(composed());
    assert.equal(headerLines.some((line) => /^Bcc:/i.test(line)), false, "no injected Bcc header line");
    assert.equal(headerLines.filter((line) => /^From:/i.test(line)).length, 1, "exactly one From header remains");
    // The mangled text is expected to remain harmlessly inside the quoted
    // display name (nodemailer folds the CRLF into a plain space there) -
    // that is the safe outcome, not something to additionally assert away.
});

test("SMTP_REPLY_TO with an embedded CRLF is already rejected by configuration validation, before any provider is even constructed", () => {
    assert.throws(
        () => config({ SMTP_REPLY_TO: "support@fittrack.test\r\nBcc: attacker@evil.test" }),
        (error) => error.code === "INVALID_SMTP_CONFIG"
    );
});

test("a CRLF injection attempt in the studio name (reaches the Subject line) cannot add a second raw header line, only folds within Subject", async () => {
    const { factory, composed } = realComposedMessageTransportFactory();
    const provider = createSmtpInvitationProvider({ config: config(), transportFactory: factory, logger: fakeLogger() });
    await provider.sendInvitation({
        email: "member@example.test",
        studioName: "Evil Studio\r\nBcc: attacker@evil.test\r\nX-Injected: true",
        role: "member",
        acceptanceUrl: "https://app.fittrack.test/invitations/x"
    });
    const headerLines = extractHeaderLines(composed());
    assert.equal(headerLines.some((line) => /^Bcc:/i.test(line)), false, "no injected Bcc header line");
    assert.equal(headerLines.some((line) => /^X-Injected:/i.test(line)), false, "no injected custom header line");
    assert.equal(headerLines.filter((line) => /^Subject:/i.test(line)).length, 1, "exactly one Subject header remains");
    for (const expected of ["From", "To", "Subject", "MIME-Version", "Content-Type"]) {
        assert.equal(headerLines.filter((line) => new RegExp(`^${expected}:`, "i").test(line)).length, 1, `exactly one ${expected} header`);
    }
});

test("logs never contain any field from a realistically-shaped Nodemailer failure (response, responseCode, command, rejected, rejectedErrors, cause, stack)", async () => {
    const logger = fakeLogger();
    const realisticNodemailerError = Object.assign(
        new Error("Command failed: 550 5.1.1 <member@example.test>: Recipient address rejected: relay-secret-token-abc123"),
        {
            code: "EENVELOPE",
            command: "RCPT TO",
            response: "550 5.1.1 <member@example.test>: Recipient address rejected: relay-secret-token-abc123",
            responseCode: 550,
            rejected: ["member@example.test"],
            rejectedErrors: [
                Object.assign(new Error("550 5.1.1 rejected"), { address: "member@example.test", response: "550 5.1.1 rejected with internal-relay-id-xyz" })
            ],
            cause: new Error("underlying socket error with host smtp.internal-secret-host.test")
        }
    );
    const { factory } = fakeTransportFactory({ sendMail: async () => { throw realisticNodemailerError; } });
    const provider = createSmtpInvitationProvider({ config: config(), transportFactory: factory, logger });
    await assert.rejects(provider.sendInvitation({
        email: "member@example.test", studioName: "Studio", role: "member",
        acceptanceUrl: "https://app.fittrack.test/invitations/secret-token-value"
    }));
    const serializedLogs = JSON.stringify(logger.entries);
    for (const forbidden of [
        "relay-secret-token-abc123",
        "internal-relay-id-xyz",
        "internal-secret-host",
        "member@example.test",
        "secret-token-value",
        "Recipient address rejected",
        "550 5.1.1"
    ]) {
        assert.equal(serializedLogs.includes(forbidden), false, `log output must not contain: ${forbidden}`);
    }
    // only the derived, safe classification string is expected to appear
    const failure = logger.entries.find((entry) => entry.event === "invitation_email_send_failed");
    assert.equal(failure.fields.errorClass, "recipient_rejected");
    assert.deepEqual(Object.keys(failure.fields).sort(), ["durationMs", "errorClass", "provider", "requestId"]);
});

test("the thrown client-facing error never carries the original Nodemailer error as its cause", async () => {
    const realisticNodemailerError = Object.assign(new Error("535 5.7.8 Authentication failed for user relay-user"), {
        code: "EAUTH",
        response: "535 5.7.8 Authentication failed for user relay-user"
    });
    const { factory } = fakeTransportFactory({ sendMail: async () => { throw realisticNodemailerError; } });
    const provider = createSmtpInvitationProvider({ config: config(), transportFactory: factory, logger: fakeLogger() });
    await assert.rejects(
        provider.sendInvitation({
            email: "member@example.test", studioName: "Studio", role: "member",
            acceptanceUrl: "https://app.fittrack.test/invitations/x"
        }),
        (error) => {
            assert.equal(error.code, "INVITATION_PROVIDER_UNAVAILABLE");
            assert.equal(error.cause, undefined);
            assert.equal(JSON.stringify(error).includes("relay-user"), false);
            return true;
        }
    );
});
