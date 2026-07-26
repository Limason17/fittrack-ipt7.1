const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mysql = require("mysql2/promise");

const TEST_DATABASE = `fittrack_api_test_account_${process.pid}_${Date.now()}`;
if (!/^fittrack_api_test_account_[A-Za-z0-9_]+$/.test(TEST_DATABASE)) {
    throw new Error("Refusing to use an unsafe account API test database name.");
}

process.env.NODE_ENV = "test";
process.env.DB_NAME = TEST_DATABASE;
process.env.JWT_SECRET = "fittrack-stage-3b1-test-secret-with-at-least-32-characters";
process.env.AUTH_LOGIN_RATE_LIMIT_MAX = "100";
process.env.AUTH_REGISTRATION_RATE_LIMIT_MAX = "100";
process.env.AUTH_PASSWORD_CHANGE_RATE_LIMIT_MAX = "100";
process.env.AUTH_EMAIL_CHANGE_RATE_LIMIT_MAX = "100";
process.env.AUTH_EMAIL_CHANGE_CONFIRM_RATE_LIMIT_MAX = "100";
// Stage 3D: same reasoning as authSessionApi.test.js - auth.refresh is
// IP-keyed and every call in this file shares one loopback address.
process.env.AUTH_REFRESH_RATE_LIMIT_MAX = "100";
process.env.AUTH_LOGOUT_ALL_RATE_LIMIT_MAX = "100";
process.env.INVITATION_ACCEPT_BASE_URL = "http://127.0.0.1:4173";
// Same isolation rationale as studioApi.test.js: never allow a leaked local
// .env SMTP config to escape into this test process.
process.env.INVITATION_EMAIL_PROVIDER = "";

const db = require("../../config/db");
const { createMigrationRunner } = require("../../migrations/runner");
const { createAccountService } = require("../../services/accountService");
const { createAccountRouter } = require("../../routes/accountRouter");
const { createApp } = require("../../startup/app");
const { createRateLimiters } = require("../../middleware/rateLimiter");
const { createMySqlRateLimitStore } = require("../../rateLimiting/mysqlRateLimitStore");

const logger = { info() {}, warn() {}, error() {} };
const runId = crypto.randomBytes(5).toString("hex");
let adminConnection;
let pool;
let server;
let baseUrl;
let failingServer;
let failingBaseUrl;
let counter = 0;

function fixture(name) {
    counter += 1;
    return {
        username: `stage3b1-${name}-${counter}-${runId}`,
        email: `stage3b1-${name}-${counter}-${runId}@example.test`,
        password: "correct horse battery staple stage3b1"
    };
}

async function apiAt(base, path, { method = "GET", token, body } = {}) {
    const headers = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { response, data: await response.json() };
}

function api(path, options) {
    return apiAt(baseUrl, path, options);
}

async function registerAndLogin(name) {
    const user = fixture(name);
    const registered = await api("/api/users/register", {
        method: "POST",
        body: {
            username: user.username,
            email: user.email,
            password: user.password,
            language_preference: "de",
            weight_unit: "kg",
            distance_unit: "km"
        }
    });
    assert.equal(registered.response.status, 201, JSON.stringify(registered.data));
    const loggedIn = await api("/api/users/login", {
        method: "POST",
        body: { email: user.email, password: user.password }
    });
    assert.equal(loggedIn.response.status, 200, JSON.stringify(loggedIn.data));
    return {
        ...user,
        id: loggedIn.data.user.id,
        token: loggedIn.data.token
    };
}

function confirmTokenFromUrl(url) {
    return decodeURIComponent(new URL(url).pathname.split("/").pop());
}

before(async () => {
    adminConnection = await mysql.createConnection(
        db.readDatabaseConfig(process.env, { includeDatabase: false })
    );
    await adminConnection.query(`CREATE DATABASE \`${TEST_DATABASE}\` CHARACTER SET utf8mb4`);
    const runner = createMigrationRunner({ pool: db, logger });
    await runner.migrate({ expectedDatabase: TEST_DATABASE });
    pool = db.promise();

    const app = createApp({
        readiness: { check: async () => ({ ready: true }) },
        logger
    });
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    // A second, isolated app instance sharing the same database but wired
    // with an account service whose e-mail delivery always throws - used
    // only to exercise the delivery-failure compensation path without
    // needing a real SMTP outage.
    const failingDelivery = {
        assertAvailable() {},
        async sendConfirmation() {
            throw new Error("simulated delivery outage");
        },
        async sendNotificationBestEffort() {}
    };
    const failingAccountService = createAccountService({ database: pool, delivery: failingDelivery });
    const failingRateLimiters = createRateLimiters({ store: createMySqlRateLimitStore({ database: pool }) });
    const failingApp = createApp({
        readiness: { check: async () => ({ ready: true }) },
        logger,
        routers: {
            users: require("../../routes/users"),
            exercises: require("../../routes/exercises"),
            workouts: require("../../routes/workouts"),
            progress: require("../../routes/progress"),
            account: createAccountRouter({
                service: failingAccountService,
                rateLimiters: {
                    passwordChange: failingRateLimiters.passwordChange,
                    emailChangeRequest: failingRateLimiters.emailChangeRequest,
                    emailChangeConfirm: failingRateLimiters.emailChangeConfirm
                }
            })
        }
    });
    failingServer = failingApp.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
        failingServer.once("listening", resolve);
        failingServer.once("error", reject);
    });
    failingBaseUrl = `http://127.0.0.1:${failingServer.address().port}`;
});

after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (failingServer) await new Promise((resolve) => failingServer.close(resolve));
    await db.closePool(db);
    if (adminConnection) {
        assert.match(TEST_DATABASE, /^fittrack_api_test_account_[A-Za-z0-9_]+$/);
        await adminConnection.query(`DROP DATABASE IF EXISTS \`${TEST_DATABASE}\``);
        await adminConnection.end();
    }
});

// ---- Password change ----

test("changing the password succeeds, invalidates the old token, and allows login with the new password", async () => {
    const user = await registerAndLogin("pw-success");

    const changed = await api("/api/account/change-password", {
        method: "POST",
        token: user.token,
        body: {
            currentPassword: user.password,
            newPassword: "a-brand-new-password-123",
            newPasswordConfirmation: "a-brand-new-password-123"
        }
    });
    assert.equal(changed.response.status, 200, JSON.stringify(changed.data));

    const oldTokenStillUsed = await api("/api/users/me", { token: user.token });
    assert.equal(oldTokenStillUsed.response.status, 401);
    assert.equal(oldTokenStillUsed.data.error.code, "AUTH_SESSION_INVALIDATED");

    const oldPasswordLogin = await api("/api/users/login", {
        method: "POST",
        body: { email: user.email, password: user.password }
    });
    assert.equal(oldPasswordLogin.response.status, 401);

    const newPasswordLogin = await api("/api/users/login", {
        method: "POST",
        body: { email: user.email, password: "a-brand-new-password-123" }
    });
    assert.equal(newPasswordLogin.response.status, 200, JSON.stringify(newPasswordLogin.data));
    const freshTokenWorks = await api("/api/users/me", { token: newPasswordLogin.data.token });
    assert.equal(freshTokenWorks.response.status, 200);
});

test("changing the password with the wrong current password is rejected and does not change auth_version", async () => {
    const user = await registerAndLogin("pw-wrong-current");
    const result = await api("/api/account/change-password", {
        method: "POST",
        token: user.token,
        body: {
            currentPassword: "definitely-not-the-password",
            newPassword: "a-brand-new-password-123",
            newPasswordConfirmation: "a-brand-new-password-123"
        }
    });
    assert.equal(result.response.status, 401);
    assert.equal(result.data.error.code, "CURRENT_PASSWORD_INVALID");

    const stillWorks = await api("/api/users/me", { token: user.token });
    assert.equal(stillWorks.response.status, 200, "the original token must remain valid since nothing changed");
});

test("changing the password to the identical current password is rejected", async () => {
    const user = await registerAndLogin("pw-same");
    const result = await api("/api/account/change-password", {
        method: "POST",
        token: user.token,
        body: {
            currentPassword: user.password,
            newPassword: user.password,
            newPasswordConfirmation: user.password
        }
    });
    assert.equal(result.response.status, 400);
    assert.equal(result.data.error.code, "NEW_PASSWORD_SAME_AS_CURRENT");
});

test("changing the password with a policy-violating new password is rejected the same way registration would be", async () => {
    const user = await registerAndLogin("pw-policy");
    const result = await api("/api/account/change-password", {
        method: "POST",
        token: user.token,
        body: {
            currentPassword: user.password,
            newPassword: "short",
            newPasswordConfirmation: "short"
        }
    });
    assert.equal(result.response.status, 400);
    assert.equal(result.data.error.code, "VALIDATION_ERROR");
});

test("changing the password with a mismatched confirmation is rejected before touching the account", async () => {
    const user = await registerAndLogin("pw-mismatch");
    const result = await api("/api/account/change-password", {
        method: "POST",
        token: user.token,
        body: {
            currentPassword: user.password,
            newPassword: "a-brand-new-password-123",
            newPasswordConfirmation: "a-different-password-456"
        }
    });
    assert.equal(result.response.status, 400);
    assert.equal(result.data.error.code, "PASSWORD_CONFIRMATION_MISMATCH");
    assert.ok(result.data.error.fields?.newPasswordConfirmation);

    const oldPasswordStillWorks = await api("/api/users/login", {
        method: "POST",
        body: { email: user.email, password: user.password }
    });
    assert.equal(oldPasswordStillWorks.response.status, 200);
});

test("change-password requires authentication", async () => {
    const result = await api("/api/account/change-password", {
        method: "POST",
        body: { currentPassword: "x", newPassword: "y-new-password-1", newPasswordConfirmation: "y-new-password-1" }
    });
    assert.equal(result.response.status, 401);
});

test("password change never appears in the structured request log", async () => {
    const logged = [];
    const capturingLogger = {
        info(event, fields) { logged.push({ event, fields }); },
        warn(event, fields) { logged.push({ event, fields }); },
        error(event, fields) { logged.push({ event, fields }); }
    };
    const app = createApp({
        readiness: { check: async () => ({ ready: true }) },
        logger: capturingLogger
    });
    const tempServer = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
        tempServer.once("listening", resolve);
        tempServer.once("error", reject);
    });
    const tempBaseUrl = `http://127.0.0.1:${tempServer.address().port}`;
    try {
        const user = await registerAndLogin("pw-log-safety");
        await apiAt(tempBaseUrl, "/api/account/change-password", {
            method: "POST",
            token: user.token,
            body: {
                currentPassword: user.password,
                newPassword: "a-brand-new-password-123",
                newPasswordConfirmation: "a-brand-new-password-123"
            }
        });
        const serialized = JSON.stringify(logged);
        assert.equal(serialized.includes(user.password), false);
        assert.equal(serialized.includes("a-brand-new-password-123"), false);
    } finally {
        await new Promise((resolve) => tempServer.close(resolve));
    }
});

// ---- Email change: request ----

test("requesting an e-mail change succeeds and returns a dev-preview confirm URL", async () => {
    const user = await registerAndLogin("email-req-success");
    const newEmail = `${user.username}-new@example.test`;
    const result = await api("/api/account/email-change-requests", {
        method: "POST",
        token: user.token,
        body: { newEmail, currentPassword: user.password }
    });
    assert.equal(result.response.status, 201, JSON.stringify(result.data));
    assert.equal(result.data.emailChangeRequest.newEmail, newEmail);
    assert.equal(result.data.emailChangeRequest.status, "pending");
    assert.equal(result.data.delivery.delivered, false);
    assert.match(result.data.delivery.confirmUrl, /\/account\/email-change\//);

    const current = await api("/api/account/email-change-requests/current", { token: user.token });
    assert.equal(current.response.status, 200);
    assert.equal(current.data.emailChangeRequest.newEmail, newEmail);
});

test("requesting an e-mail change with the wrong current password is rejected", async () => {
    const user = await registerAndLogin("email-req-wrong-pw");
    const result = await api("/api/account/email-change-requests", {
        method: "POST",
        token: user.token,
        body: { newEmail: `${user.username}-new@example.test`, currentPassword: "not-the-password" }
    });
    assert.equal(result.response.status, 401);
    assert.equal(result.data.error.code, "CURRENT_PASSWORD_INVALID");
});

test("requesting a change to the same e-mail address is rejected", async () => {
    const user = await registerAndLogin("email-req-same");
    const result = await api("/api/account/email-change-requests", {
        method: "POST",
        token: user.token,
        body: { newEmail: user.email, currentPassword: user.password }
    });
    assert.equal(result.response.status, 400);
    assert.equal(result.data.error.code, "EMAIL_UNCHANGED");
});

test("requesting a change to an e-mail address already used by another account is rejected", async () => {
    const user = await registerAndLogin("email-req-taken-a");
    const other = await registerAndLogin("email-req-taken-b");
    const result = await api("/api/account/email-change-requests", {
        method: "POST",
        token: user.token,
        body: { newEmail: other.email, currentPassword: user.password }
    });
    assert.equal(result.response.status, 409);
    assert.equal(result.data.error.code, "EMAIL_ALREADY_IN_USE");
});

test("a second e-mail change request atomically revokes the first, which can then no longer be confirmed", async () => {
    const user = await registerAndLogin("email-req-replace");
    const first = await api("/api/account/email-change-requests", {
        method: "POST",
        token: user.token,
        body: { newEmail: `${user.username}-first@example.test`, currentPassword: user.password }
    });
    assert.equal(first.response.status, 201);
    const firstToken = confirmTokenFromUrl(first.data.delivery.confirmUrl);

    const second = await api("/api/account/email-change-requests", {
        method: "POST",
        token: user.token,
        body: { newEmail: `${user.username}-second@example.test`, currentPassword: user.password }
    });
    assert.equal(second.response.status, 201);

    const confirmFirst = await api("/api/account/email-change-confirmations", {
        method: "POST",
        body: { token: firstToken }
    });
    assert.equal(confirmFirst.response.status, 409);
    assert.equal(confirmFirst.data.error.code, "EMAIL_CHANGE_TOKEN_REVOKED");

    const current = await api("/api/account/email-change-requests/current", { token: user.token });
    assert.equal(current.data.emailChangeRequest.newEmail, `${user.username}-second@example.test`);
});

test("a delivery failure reports a safe error and revokes the request instead of leaving an unconfirmable pending row", async () => {
    const user = fixture("email-req-delivery-fail");
    const registered = await apiAt(failingBaseUrl, "/api/users/register", {
        method: "POST",
        body: {
            username: user.username, email: user.email, password: user.password,
            language_preference: "de", weight_unit: "kg", distance_unit: "km"
        }
    });
    assert.equal(registered.response.status, 201);
    const login = await apiAt(failingBaseUrl, "/api/users/login", {
        method: "POST",
        body: { email: user.email, password: user.password }
    });
    assert.equal(login.response.status, 200);
    const token = login.data.token;

    const result = await apiAt(failingBaseUrl, "/api/account/email-change-requests", {
        method: "POST",
        token,
        body: { newEmail: `${user.username}-new@example.test`, currentPassword: user.password }
    });
    assert.equal(result.response.status, 502);
    assert.equal(result.data.error.code, "EMAIL_CHANGE_DELIVERY_FAILED");

    const current = await apiAt(failingBaseUrl, "/api/account/email-change-requests/current", { token });
    assert.equal(current.data.emailChangeRequest, null, "a failed-delivery request must not remain visibly pending");
});

test("email-change-requests requires authentication", async () => {
    const result = await api("/api/account/email-change-requests", {
        method: "POST",
        body: { newEmail: "someone@example.test", currentPassword: "x" }
    });
    assert.equal(result.response.status, 401);
});

// ---- Email change: confirm ----

test("confirming an e-mail change succeeds without any Authorization header, invalidates old tokens, and updates login", async () => {
    const user = await registerAndLogin("email-confirm-success");
    const newEmail = `${user.username}-new@example.test`;
    const requested = await api("/api/account/email-change-requests", {
        method: "POST",
        token: user.token,
        body: { newEmail, currentPassword: user.password }
    });
    const confirmToken = confirmTokenFromUrl(requested.data.delivery.confirmUrl);

    const confirmed = await api("/api/account/email-change-confirmations", {
        method: "POST",
        body: { token: confirmToken }
    });
    assert.equal(confirmed.response.status, 200, JSON.stringify(confirmed.data));

    const oldTokenRejected = await api("/api/users/me", { token: user.token });
    assert.equal(oldTokenRejected.response.status, 401);
    assert.equal(oldTokenRejected.data.error.code, "AUTH_SESSION_INVALIDATED");

    const oldEmailLoginFails = await api("/api/users/login", {
        method: "POST",
        body: { email: user.email, password: user.password }
    });
    assert.equal(oldEmailLoginFails.response.status, 401);

    const newEmailLoginWorks = await api("/api/users/login", {
        method: "POST",
        body: { email: newEmail, password: user.password }
    });
    assert.equal(newEmailLoginWorks.response.status, 200, JSON.stringify(newEmailLoginWorks.data));
    assert.equal(newEmailLoginWorks.data.user.email, newEmail);
});

test("confirming with an invalid/garbage token is rejected without leaking a stacktrace", async () => {
    const result = await api("/api/account/email-change-confirmations", {
        method: "POST",
        body: { token: "not-a-real-token-at-all" }
    });
    assert.equal(result.response.status, 404);
    assert.equal(result.data.error.code, "EMAIL_CHANGE_TOKEN_INVALID");
    assert.equal(JSON.stringify(result.data).toLowerCase().includes("stack"), false);
});

test("replaying an already-confirmed token is rejected", async () => {
    const user = await registerAndLogin("email-confirm-replay");
    const requested = await api("/api/account/email-change-requests", {
        method: "POST",
        token: user.token,
        body: { newEmail: `${user.username}-new@example.test`, currentPassword: user.password }
    });
    const confirmToken = confirmTokenFromUrl(requested.data.delivery.confirmUrl);

    const first = await api("/api/account/email-change-confirmations", { method: "POST", body: { token: confirmToken } });
    assert.equal(first.response.status, 200);
    const replay = await api("/api/account/email-change-confirmations", { method: "POST", body: { token: confirmToken } });
    assert.equal(replay.response.status, 409);
    assert.equal(replay.data.error.code, "EMAIL_CHANGE_TOKEN_USED");
});

test("two concurrent confirmations of the same token: exactly one succeeds", async () => {
    const user = await registerAndLogin("email-confirm-concurrent");
    const requested = await api("/api/account/email-change-requests", {
        method: "POST",
        token: user.token,
        body: { newEmail: `${user.username}-new@example.test`, currentPassword: user.password }
    });
    const confirmToken = confirmTokenFromUrl(requested.data.delivery.confirmUrl);

    const [first, second] = await Promise.all([
        api("/api/account/email-change-confirmations", { method: "POST", body: { token: confirmToken } }),
        api("/api/account/email-change-confirmations", { method: "POST", body: { token: confirmToken } })
    ]);
    const statuses = [first.response.status, second.response.status].sort();
    assert.deepEqual(statuses, [200, 409]);
});

test("revoking the current e-mail change request prevents it from ever being confirmed", async () => {
    const user = await registerAndLogin("email-confirm-revoked");
    const requested = await api("/api/account/email-change-requests", {
        method: "POST",
        token: user.token,
        body: { newEmail: `${user.username}-new@example.test`, currentPassword: user.password }
    });
    const confirmToken = confirmTokenFromUrl(requested.data.delivery.confirmUrl);

    const revoked = await api("/api/account/email-change-requests/current", { method: "DELETE", token: user.token });
    assert.equal(revoked.response.status, 200);

    const confirmed = await api("/api/account/email-change-confirmations", { method: "POST", body: { token: confirmToken } });
    assert.equal(confirmed.response.status, 409);
    assert.equal(confirmed.data.error.code, "EMAIL_CHANGE_TOKEN_REVOKED");
});

test("revoking with no open request is a clear 404, not a silent no-op", async () => {
    const user = await registerAndLogin("email-revoke-none");
    const result = await api("/api/account/email-change-requests/current", { method: "DELETE", token: user.token });
    assert.equal(result.response.status, 404);
    assert.equal(result.data.error.code, "EMAIL_CHANGE_REQUEST_NOT_FOUND");
});

test("an e-mail claimed by another account between request and confirmation is rejected at confirmation time", async () => {
    const user = await registerAndLogin("email-race-a");
    const contestedEmail = `${user.username}-contested@example.test`;
    const requested = await api("/api/account/email-change-requests", {
        method: "POST",
        token: user.token,
        body: { newEmail: contestedEmail, currentPassword: user.password }
    });
    const confirmToken = confirmTokenFromUrl(requested.data.delivery.confirmUrl);

    const winner = fixture("email-race-b");
    const registeredWinner = await api("/api/users/register", {
        method: "POST",
        body: {
            username: winner.username,
            email: contestedEmail,
            password: winner.password,
            language_preference: "de",
            weight_unit: "kg",
            distance_unit: "km"
        }
    });
    assert.equal(registeredWinner.response.status, 201, "a second account may legitimately register the contested address first");

    const confirmed = await api("/api/account/email-change-confirmations", { method: "POST", body: { token: confirmToken } });
    assert.equal(confirmed.response.status, 409);
    assert.equal(confirmed.data.error.code, "EMAIL_ALREADY_IN_USE");
});

test("no foreign e-mail change request is visible or revocable through another account's session", async () => {
    const owner = await registerAndLogin("email-foreign-owner");
    const stranger = await registerAndLogin("email-foreign-stranger");
    const requested = await api("/api/account/email-change-requests", {
        method: "POST",
        token: owner.token,
        body: { newEmail: `${owner.username}-new@example.test`, currentPassword: owner.password }
    });
    assert.equal(requested.response.status, 201);

    const strangerView = await api("/api/account/email-change-requests/current", { token: stranger.token });
    assert.equal(strangerView.data.emailChangeRequest, null);

    const strangerRevoke = await api("/api/account/email-change-requests/current", { method: "DELETE", token: stranger.token });
    assert.equal(strangerRevoke.response.status, 404);

    const ownerStillPending = await api("/api/account/email-change-requests/current", { token: owner.token });
    assert.equal(ownerStillPending.data.emailChangeRequest.newEmail, `${owner.username}-new@example.test`);
});
