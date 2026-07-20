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
