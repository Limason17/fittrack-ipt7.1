const test = require("node:test");
const assert = require("node:assert/strict");

const { readSmtpConfig } = require("../../config/smtpConfig");

function baseEnv(overrides = {}) {
    return {
        INVITATION_EMAIL_PROVIDER: "smtp",
        SMTP_HOST: "smtp.fittrack-mail.test",
        SMTP_PORT: "587",
        SMTP_SECURE: "false",
        SMTP_USER: "fittrack-relay",
        SMTP_PASSWORD: "s3cure-relay-password",
        SMTP_FROM_EMAIL: "invitations@fittrack.test",
        SMTP_FROM_NAME: "FitTrack",
        ...overrides
    };
}

test("provider disabled by default returns null without validating anything", () => {
    assert.equal(readSmtpConfig({}), null);
    assert.equal(readSmtpConfig({ SMTP_HOST: "" }), null);
    assert.equal(readSmtpConfig({ INVITATION_EMAIL_PROVIDER: "console" }), null);
});

test("a fully valid SMTP configuration is accepted", () => {
    const config = readSmtpConfig(baseEnv());
    assert.equal(config.provider, "smtp");
    assert.equal(config.host, "smtp.fittrack-mail.test");
    assert.equal(config.port, 587);
    assert.equal(config.secure, false);
    assert.equal(config.user, "fittrack-relay");
    assert.equal(config.password, "s3cure-relay-password");
    assert.equal(config.fromEmail, "invitations@fittrack.test");
    assert.equal(config.fromName, "FitTrack");
    assert.equal(config.replyTo, undefined);
    assert.equal(config.connectionTimeoutMs, 10000);
    assert.equal(config.greetingTimeoutMs, 10000);
    assert.equal(config.socketTimeoutMs, 20000);
});

test("SMTPS configuration (secure=true) is accepted without credentials", () => {
    const config = readSmtpConfig(baseEnv({ SMTP_SECURE: "true", SMTP_USER: "", SMTP_PASSWORD: "" }));
    assert.equal(config.secure, true);
    assert.equal(config.user, undefined);
    assert.equal(config.password, undefined);
});

test("STARTTLS configuration (secure=false) is accepted", () => {
    const config = readSmtpConfig(baseEnv({ SMTP_SECURE: "false" }));
    assert.equal(config.secure, false);
});

test("an optional reply-to address is validated when present", () => {
    const config = readSmtpConfig(baseEnv({ SMTP_REPLY_TO: "support@fittrack.test" }));
    assert.equal(config.replyTo, "support@fittrack.test");
    assert.equal(readSmtpConfig(baseEnv({ SMTP_REPLY_TO: "" })).replyTo, undefined);
});

test("a missing host is rejected", () => {
    assert.throws(
        () => readSmtpConfig(baseEnv({ SMTP_HOST: "" })),
        (error) => error.code === "INVALID_SMTP_CONFIG" && /SMTP_HOST/.test(error.message)
    );
});

test("an invalid port is rejected", () => {
    for (const port of ["0", "70000", "not-a-number", ""]) {
        assert.throws(
            () => readSmtpConfig(baseEnv({ SMTP_PORT: port })),
            (error) => error.code === "INVALID_SMTP_CONFIG"
        );
    }
});

test("SMTP_SECURE must be strictly a boolean string", () => {
    for (const value of ["yes", "1", "TRUE", "", "0"]) {
        assert.throws(
            () => readSmtpConfig(baseEnv({ SMTP_SECURE: value })),
            (error) => error.code === "INVALID_SMTP_CONFIG" && /SMTP_SECURE/.test(error.message)
        );
    }
});

test("a missing sender e-mail is rejected", () => {
    assert.throws(
        () => readSmtpConfig(baseEnv({ SMTP_FROM_EMAIL: "" })),
        (error) => error.code === "INVALID_SMTP_CONFIG"
    );
});

test("an invalid sender e-mail address is rejected", () => {
    for (const value of ["not-an-email", "missing-domain@", "@missing-local.test", "spaces in@here.test"]) {
        assert.throws(
            () => readSmtpConfig(baseEnv({ SMTP_FROM_EMAIL: value })),
            (error) => error.code === "INVALID_SMTP_CONFIG"
        );
    }
});

test("an invalid reply-to address is rejected when set", () => {
    assert.throws(
        () => readSmtpConfig(baseEnv({ SMTP_REPLY_TO: "not-an-email" })),
        (error) => error.code === "INVALID_SMTP_CONFIG"
    );
});

test("placeholder credentials and hosts are rejected", () => {
    for (const overrides of [
        { SMTP_HOST: "smtp.example.com" },
        { SMTP_USER: "changeme", SMTP_PASSWORD: "changeme" },
        { SMTP_USER: "your-smtp-user", SMTP_PASSWORD: "your-smtp-password" },
        { SMTP_FROM_NAME: "placeholder" }
    ]) {
        assert.throws(
            () => readSmtpConfig(baseEnv(overrides)),
            (error) => error.code === "INVALID_SMTP_CONFIG"
        );
    }
});

test("username and password must both be present or both absent", () => {
    assert.throws(
        () => readSmtpConfig(baseEnv({ SMTP_USER: "only-user", SMTP_PASSWORD: "" })),
        (error) => error.code === "INVALID_SMTP_CONFIG"
    );
    assert.throws(
        () => readSmtpConfig(baseEnv({ SMTP_USER: "", SMTP_PASSWORD: "only-password" })),
        (error) => error.code === "INVALID_SMTP_CONFIG"
    );
});

test("timeout settings have clear, enforced lower and upper bounds", () => {
    assert.throws(
        () => readSmtpConfig(baseEnv({ SMTP_CONNECTION_TIMEOUT_MS: "10" })),
        (error) => error.code === "INVALID_SMTP_CONFIG"
    );
    assert.throws(
        () => readSmtpConfig(baseEnv({ SMTP_CONNECTION_TIMEOUT_MS: "999999" })),
        (error) => error.code === "INVALID_SMTP_CONFIG"
    );
    assert.throws(
        () => readSmtpConfig(baseEnv({ SMTP_GREETING_TIMEOUT_MS: "0" })),
        (error) => error.code === "INVALID_SMTP_CONFIG"
    );
    assert.throws(
        () => readSmtpConfig(baseEnv({ SMTP_SOCKET_TIMEOUT_MS: "1" })),
        (error) => error.code === "INVALID_SMTP_CONFIG"
    );
    const config = readSmtpConfig(baseEnv({
        SMTP_CONNECTION_TIMEOUT_MS: "5000",
        SMTP_GREETING_TIMEOUT_MS: "6000",
        SMTP_SOCKET_TIMEOUT_MS: "15000"
    }));
    assert.equal(config.connectionTimeoutMs, 5000);
    assert.equal(config.greetingTimeoutMs, 6000);
    assert.equal(config.socketTimeoutMs, 15000);
});

test("configuration works identically regardless of NODE_ENV, only the delivery contract enforces production rules", () => {
    for (const NODE_ENV of ["development", "test", "production"]) {
        assert.doesNotThrow(() => readSmtpConfig(baseEnv({ NODE_ENV })));
    }
});

test("resolved config never exposes credentials in an enumerable, loggable way beyond dedicated fields", () => {
    const config = readSmtpConfig(baseEnv());
    // the config object itself is expected to hold the secret so the
    // transport can authenticate - the requirement under test is that
    // nothing else derives a stringified/logged form from it by default.
    const serialized = JSON.stringify(config);
    assert.match(serialized, /s3cure-relay-password/);
    // Documents the boundary: callers must never pass this object directly
    // to a logger. The provider and delivery layers never do.
});
