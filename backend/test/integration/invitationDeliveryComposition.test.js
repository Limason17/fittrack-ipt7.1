// Regression coverage for the real production composition path, not just
// createInvitationDelivery() with an explicitly injected provider. A prior
// production incident showed that explicitly-injected-provider tests alone
// cannot catch composition-wiring defects: this file exercises the exact
// default wiring server.js uses (startup/app.js#defaultRouters/createApp),
// through genuine HTTP requests against a genuine Express app, with only
// the outermost Nodemailer transport swapped for an in-memory fake so no
// network access ever occurs.
const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const Module = require("node:module");
const mysql = require("mysql2/promise");

const TEST_DATABASE = `fittrack_invitation_composition_${process.pid}_${Date.now()}`;
if (!/^fittrack_invitation_composition_[A-Za-z0-9_]+$/.test(TEST_DATABASE)) {
    throw new Error("Refusing to use an unsafe composition test database name.");
}

process.env.NODE_ENV = "test";
process.env.DB_NAME = TEST_DATABASE;
process.env.JWT_SECRET = "fittrack-composition-test-secret-with-at-least-32-characters";
process.env.AUTH_LOGIN_RATE_LIMIT_MAX = "100";
process.env.AUTH_REGISTRATION_RATE_LIMIT_MAX = "100";

const db = require("../../config/db");
const { createMigrationRunner } = require("../../migrations/runner");
const { createApp, createDefaultStudioService, defaultRouters } = require("../../startup/app");
const { createInvitationDelivery } = require("../../delivery/invitationDelivery");
const { createInvitationOutbox } = require("../../outbox/invitationOutbox");
const { createStudioService } = require("../../services/studioService");

const logger = { info() {}, warn() {}, error() {} };
const runId = crypto.randomBytes(5).toString("hex");
let adminConnection;
let pool;
let sharedOwnerId;
let sharedContext;

function fixture(name) {
    return {
        username: `composition-${name}-${runId}`,
        email: `composition-${name}-${runId}@example.test`,
        password: "correct horse battery staple composition"
    };
}

function productionSmtpEnv(overrides = {}) {
    return {
        NODE_ENV: "production",
        INVITATION_ACCEPT_BASE_URL: "https://app.example.test",
        INVITATION_EMAIL_PROVIDER: "smtp",
        SMTP_HOST: "smtp.example.test",
        SMTP_PORT: "587",
        SMTP_SECURE: "false",
        SMTP_USER: "composition-relay-user",
        SMTP_PASSWORD: "composition-relay-password",
        SMTP_FROM_EMAIL: "sender@example.test",
        SMTP_FROM_NAME: "FitTrack",
        ...overrides
    };
}

function fakeTransportFactory(sent) {
    return () => ({
        async sendMail(message) {
            sent.push(message);
            return { accepted: [message.to] };
        },
        close() {}
    });
}

// Counts how many times the outermost Nodemailer transport gets constructed
// while running `fn`. A correct, single, explicit composition root must
// construct exactly one - not one per router module that happens to share
// a service default.
function countNodemailerRequires(fn) {
    const originalRequire = Module.prototype.require;
    let count = 0;
    Module.prototype.require = function patchedRequire(id) {
        if (id === "nodemailer") count += 1;
        return originalRequire.apply(this, arguments);
    };
    try {
        fn();
    } finally {
        Module.prototype.require = originalRequire;
    }
    return count;
}

async function api(baseUrl, path, { method = "GET", token, body } = {}) {
    const headers = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { response, data: await response.json() };
}

async function registerAndLogin(baseUrl, user) {
    const registered = await api(baseUrl, "/api/users/register", {
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
    const loggedIn = await api(baseUrl, "/api/users/login", {
        method: "POST",
        body: { email: user.email, password: user.password }
    });
    assert.equal(loggedIn.response.status, 200, JSON.stringify(loggedIn.data));
    return { ...user, id: loggedIn.data.user.id, token: loggedIn.data.token };
}

before(async () => {
    adminConnection = await mysql.createConnection(
        db.readDatabaseConfig(process.env, { includeDatabase: false })
    );
    await adminConnection.query(`CREATE DATABASE \`${TEST_DATABASE}\` CHARACTER SET utf8mb4`);
    const runner = createMigrationRunner({ pool: db, logger });
    await runner.migrate({ expectedDatabase: TEST_DATABASE });
    pool = db.promise();

    // A real HTTP registration (through the default, non-SMTP test
    // composition) is the simplest reliable way to get a genuine user row
    // - directly INSERTing into `users` would need to duplicate the
    // password-hashing/validation logic already owned by that route.
    const bootstrapApp = createApp({
        readiness: { check: async () => ({ ready: true }) },
        logger,
        routers: defaultRouters({ env: { NODE_ENV: "test" }, database: pool })
    });
    const bootstrapServer = bootstrapApp.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
        bootstrapServer.once("listening", resolve);
        bootstrapServer.once("error", reject);
    });
    const bootstrapBaseUrl = `http://127.0.0.1:${bootstrapServer.address().port}`;
    const owner = await registerAndLogin(bootstrapBaseUrl, fixture("shared-owner"));
    sharedOwnerId = owner.id;
    const studioResult = await api(bootstrapBaseUrl, "/api/v1/studios", {
        method: "POST",
        token: owner.token,
        body: {
            name: "Composition Shared Studio",
            slug: `composition-shared-${runId}`,
            defaultLocale: "de",
            defaultTimezone: "Europe/Zurich",
            defaultWeightUnit: "kg"
        }
    });
    assert.equal(studioResult.response.status, 201, JSON.stringify(studioResult.data));
    await new Promise((resolve) => bootstrapServer.close(resolve));

    const contextService = createStudioService({ database: pool });
    sharedContext = await contextService.loadStudioContext(sharedOwnerId, studioResult.data.studio.id);
});

after(async () => {
    await db.closePool(db);
    if (adminConnection) {
        assert.match(TEST_DATABASE, /^fittrack_invitation_composition_[A-Za-z0-9_]+$/);
        await adminConnection.query(`DROP DATABASE IF EXISTS \`${TEST_DATABASE}\``);
        await adminConnection.end();
    }
});

test("the real default composition (defaultRouters) constructs exactly one SMTP transport, not one per router module", () => {
    const count = countNodemailerRequires(() => {
        defaultRouters({
            env: productionSmtpEnv(),
            database: pool,
            transportFactory: fakeTransportFactory([])
        });
    });
    assert.equal(count, 1, "expected exactly one Nodemailer transport construction across the whole default composition");
});

test("a full app built from the real default composition delivers a studio invitation through the SMTP provider it resolved, with no acceptUrl and no other network access", async () => {
    const sent = [];
    const routers = defaultRouters({
        env: productionSmtpEnv(),
        database: pool,
        transportFactory: fakeTransportFactory(sent)
    });
    const app = createApp({ readiness: { check: async () => ({ ready: true }) }, logger, routers });
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        const owner = await registerAndLogin(baseUrl, fixture("owner"));
        const studioResult = await api(baseUrl, "/api/v1/studios", {
            method: "POST",
            token: owner.token,
            body: {
                name: "Composition Studio",
                slug: `composition-studio-${runId}`,
                defaultLocale: "de",
                defaultTimezone: "Europe/Zurich",
                defaultWeightUnit: "kg"
            }
        });
        assert.equal(studioResult.response.status, 201, JSON.stringify(studioResult.data));
        const studioId = studioResult.data.studio.id;

        const invited = await api(baseUrl, `/api/v1/studios/${studioId}/invitations`, {
            method: "POST",
            token: owner.token,
            body: { email: "recipient@example.test", role: "trainer" }
        });

        assert.equal(invited.response.status, 201, JSON.stringify(invited.data));
        assert.deepEqual(invited.data.delivery, { delivered: true });
        assert.equal("acceptUrl" in invited.data.delivery, false);
        assert.equal(sent.length, 1, "the fake SMTP transport must have received exactly one send");
        assert.equal(sent[0].to, "recipient@example.test");
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

test("the composition root stays fail-closed in production when no provider is configured, before persisting anything", async () => {
    const service = createDefaultStudioService({
        env: { NODE_ENV: "production", INVITATION_ACCEPT_BASE_URL: "https://app.example.test" },
        database: pool
    });
    const recipientEmail = `composition-fail-closed-${runId}@example.test`;
    await assert.rejects(
        service.createInvitation(sharedOwnerId, sharedContext, { email: recipientEmail, role: "member" }),
        (error) => error.code === "INVITATION_DELIVERY_UNAVAILABLE"
    );
    const [[count]] = await pool.query(
        "SELECT COUNT(*) AS total FROM studio_invitations WHERE studio_id = ? AND email_normalized = ?",
        [sharedContext.studio.internalId, recipientEmail]
    );
    assert.equal(Number(count.total), 0, "no invitation must be persisted when delivery is unavailable");
});

test("an explicitly enabled but invalid SMTP configuration makes the composition root itself throw, not just fail a later request", () => {
    assert.throws(
        () => createDefaultStudioService({
            env: {
                NODE_ENV: "production",
                INVITATION_ACCEPT_BASE_URL: "https://app.example.test",
                INVITATION_EMAIL_PROVIDER: "smtp"
                // SMTP_HOST intentionally omitted
            },
            database: pool
        }),
        (error) => error.code === "INVALID_SMTP_CONFIG"
    );
});

test("the composition root still returns the development/test preview contract when no provider is configured outside production", async () => {
    const service = createDefaultStudioService({
        env: { NODE_ENV: "test", INVITATION_ACCEPT_BASE_URL: "http://127.0.0.1:5173" },
        database: pool
    });
    const recipientEmail = `composition-preview-${runId}@example.test`;
    const result = await service.createInvitation(sharedOwnerId, sharedContext, { email: recipientEmail, role: "member" });
    assert.equal(result.delivery.delivered, false);
    assert.match(result.delivery.acceptUrl, /^http:\/\/127\.0\.0\.1:5173\/invitations\//);
});

test("an explicitly injected provider still overrides the composition root's own resolution (existing DI seam preserved)", async () => {
    const sent = [];
    const explicitProvider = { async sendInvitation(message) { sent.push(message); } };
    const service = createStudioService({
        database: pool,
        outbox: createInvitationOutbox({
            delivery: createInvitationDelivery({
                env: { NODE_ENV: "production", INVITATION_ACCEPT_BASE_URL: "https://app.example.test" },
                provider: explicitProvider
            })
        })
    });
    const recipientEmail = `composition-explicit-override-${runId}@example.test`;
    const result = await service.createInvitation(sharedOwnerId, sharedContext, { email: recipientEmail, role: "member" });
    assert.deepEqual(result.delivery, { delivered: true });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].email, recipientEmail);
});

test("a delivery failure through the composition root's own resolved SMTP provider still triggers the existing compensation", async () => {
    const service = createDefaultStudioService({
        env: productionSmtpEnv(),
        database: pool,
        transportFactory: () => ({
            async sendMail() { throw new Error("simulated relay rejection"); },
            close() {}
        })
    });
    const recipientEmail = `composition-compensated-${runId}@example.test`;
    await assert.rejects(
        service.createInvitation(sharedOwnerId, sharedContext, { email: recipientEmail, role: "member" }),
        (error) => error.code === "INVITATION_DELIVERY_FAILED"
    );
    const [rows] = await pool.query(
        "SELECT status FROM studio_invitations WHERE studio_id = ? AND email_normalized = ? ORDER BY id DESC LIMIT 1",
        [sharedContext.studio.internalId, recipientEmail]
    );
    assert.equal(rows[0].status, "revoked");
});

test("module require order does not affect the resolved composition (workoutSessionV1/trainingProgramV1 required before studioV1)", () => {
    // Explicitly require the other two studio-tenant routers first, in the
    // "wrong" order, to rule out any require-cache ordering dependency -
    // neither has any construction side effect any more, so the order must
    // not matter.
    require("../../routes/workoutSessionV1");
    require("../../routes/trainingProgramV1");
    require("../../routes/studioV1");
    const count = countNodemailerRequires(() => {
        defaultRouters({
            env: productionSmtpEnv(),
            database: pool,
            transportFactory: fakeTransportFactory([])
        });
    });
    assert.equal(count, 1, "require order must not change how many SMTP transports the composition root builds");
});
