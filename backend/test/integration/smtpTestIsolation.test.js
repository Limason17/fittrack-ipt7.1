// Regression coverage for a real incident: a bounce e-mail arrived at a real
// Gmail inbox for a synthetic @example.test invitation fixture, proving that
// at least one automated test run, at some point, actually constructed a
// real SMTP transport using a developer's real local backend/.env and sent
// a real message. Root cause: config/db.js#loadBackendEnvironment loads
// backend/.env via dotenv with fill-only-missing-keys semantics, so any env
// var a test file does not explicitly set falls through to whatever real
// value is in the developer's own .env. This file proves, without ever
// making a real network connection or DNS lookup:
//   - the per-test-file isolation guard (process.env.INVITATION_EMAIL_PROVIDER
//     = "" before requiring config/db) defeats leaked-in SMTP-looking
//     values, even when those values are already present in the *parent*
//     process's environment (not just in a .env file);
//   - the hard resolveDefaultProvider() invariant refuses to build a real,
//     network-capable Nodemailer transport at all while NODE_ENV=test,
//     unless an explicit fake transportFactory is injected - independent of
//     any single test file remembering to clear the variable.
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const { resolveDefaultProvider } = require("../../delivery/invitationDelivery");

const BACKEND_ROOT = path.resolve(__dirname, "..", "..");

// A syntactically valid but guaranteed-unreachable SMTP config, styled after
// a real production relay (including the exact host a developer might
// plausibly have configured) - to prove the isolation mechanism defeats
// *realistic* leakage, not just an obviously-fake placeholder. RFC 2606/6761
// reserve the "invalid" TLD so this can never resolve in DNS; nothing in
// this file ever calls sendMail/verify, so no connection is ever attempted
// regardless.
function realisticLeakedParentEnv(overrides = {}) {
    return {
        PATH: process.env.PATH,
        NODE_ENV: "test",
        DB_NAME: "fittrack_smtp_isolation_unused",
        JWT_SECRET: "fittrack-smtp-isolation-test-secret-with-at-least-32-characters",
        INVITATION_EMAIL_PROVIDER: "smtp",
        SMTP_HOST: "smtp.gmail.invalid",
        SMTP_PORT: "465",
        SMTP_SECURE: "true",
        SMTP_USER: "leaked-relay-user@fittrack.invalid",
        SMTP_PASSWORD: "leaked-relay-password",
        SMTP_FROM_EMAIL: "invitations@fittrack.invalid",
        SMTP_FROM_NAME: "FitTrack",
        ...overrides
    };
}

function runIsolationProbe({ env, applyGuard }) {
    const script = `
        const Module = require("node:module");
        let nodemailerRequireCount = 0;
        const originalRequire = Module.prototype.require;
        Module.prototype.require = function patched(id) {
            if (id === "nodemailer") nodemailerRequireCount += 1;
            return originalRequire.apply(this, arguments);
        };
        ${applyGuard ? 'process.env.INVITATION_EMAIL_PROVIDER = "";' : ""}
        const { resolveDefaultProvider } = require("./delivery/invitationDelivery");
        let providerResolved = false;
        let thrownCode = null;
        try {
            providerResolved = !!resolveDefaultProvider(process.env);
        } catch (error) {
            thrownCode = error.code || error.name;
        }
        process.stdout.write(JSON.stringify({ providerResolved, thrownCode, nodemailerRequireCount }));
    `;
    const result = spawnSync(process.execPath, ["-e", script], {
        cwd: BACKEND_ROOT,
        env,
        encoding: "utf8",
        timeout: 10_000,
        windowsHide: true
    });
    assert.equal(result.status, 0, `isolation probe child process failed: ${result.stderr}`);
    return JSON.parse(result.stdout);
}

test("the established per-file isolation guard defeats realistic leaked-in SMTP values, even from the parent process environment (not just from .env)", () => {
    const withGuard = runIsolationProbe({ env: realisticLeakedParentEnv(), applyGuard: true });
    assert.equal(withGuard.providerResolved, false, "no provider must be resolved once the guard clears the flag");
    assert.equal(withGuard.nodemailerRequireCount, 0, "nodemailer must never be loaded when the guard is applied");
    assert.equal(withGuard.thrownCode, null);
});

test("without the isolation guard, the hard NODE_ENV=test invariant is what actually stops a real transport - not incidental luck", () => {
    const withoutGuard = runIsolationProbe({ env: realisticLeakedParentEnv(), applyGuard: false });
    assert.equal(withoutGuard.providerResolved, false, "a real provider must never be resolved while NODE_ENV=test without an explicit fake transport");
    assert.equal(withoutGuard.thrownCode, "REAL_SMTP_TRANSPORT_FORBIDDEN_IN_TEST");
    assert.equal(withoutGuard.nodemailerRequireCount, 0, "nodemailer must never even be required once the hard invariant rejects the attempt");
});

test("resolveDefaultProvider throws REAL_SMTP_TRANSPORT_FORBIDDEN_IN_TEST for NODE_ENV=test without an injected transportFactory", () => {
    assert.throws(
        () => resolveDefaultProvider({
            NODE_ENV: "test",
            INVITATION_EMAIL_PROVIDER: "smtp",
            SMTP_HOST: "smtp.gmail.invalid",
            SMTP_PORT: "465",
            SMTP_SECURE: "true",
            SMTP_FROM_EMAIL: "invitations@fittrack.invalid",
            SMTP_FROM_NAME: "FitTrack"
        }),
        (error) => error.code === "REAL_SMTP_TRANSPORT_FORBIDDEN_IN_TEST"
    );
});

test("resolveDefaultProvider still allows an explicitly injected fake transportFactory under NODE_ENV=test", () => {
    let constructed = false;
    const provider = resolveDefaultProvider(
        {
            NODE_ENV: "test",
            INVITATION_EMAIL_PROVIDER: "smtp",
            SMTP_HOST: "smtp.gmail.invalid",
            SMTP_PORT: "465",
            SMTP_SECURE: "true",
            SMTP_FROM_EMAIL: "invitations@fittrack.invalid",
            SMTP_FROM_NAME: "FitTrack"
        },
        {
            transportFactory: () => {
                constructed = true;
                return { async sendMail() { return { accepted: [] }; }, close() {} };
            }
        }
    );
    assert.equal(constructed, true);
    assert.equal(typeof provider.sendInvitation, "function");
});

test("resolveDefaultProvider never requires nodemailer at all while NODE_ENV=test and no provider is enabled", () => {
    const originalRequire = Module.prototype.require;
    let nodemailerRequireCount = 0;
    Module.prototype.require = function patched(id) {
        if (id === "nodemailer") nodemailerRequireCount += 1;
        return originalRequire.apply(this, arguments);
    };
    try {
        const result = resolveDefaultProvider({ NODE_ENV: "test", INVITATION_EMAIL_PROVIDER: "" });
        assert.equal(result, undefined);
    } finally {
        Module.prototype.require = originalRequire;
    }
    assert.equal(nodemailerRequireCount, 0);
});
