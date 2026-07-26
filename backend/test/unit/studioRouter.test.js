const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const { createStudioV1Router } = require("../../routes/studioV1");
const { createApp } = require("../../startup/app");
const { StudioNotFoundError } = require("../../errors/StudioErrors");
const { createRateLimiters } = require("../../middleware/rateLimiter");
const { createMemoryRateLimitStore } = require("../../rateLimiting/memoryRateLimitStore");

const STUDIO_A = "123e4567-e89b-42d3-a456-426614174000";
const STUDIO_B = "223e4567-e89b-42d3-a456-426614174000";
const MEMBERSHIP = "323e4567-e89b-42d3-a456-426614174000";

let server;
let baseUrl;

function authentication(req, res, next) {
    req.user = { id: Number(req.headers["x-test-user"] || 1) };
    next();
}

function studio(role, overrides = {}) {
    return {
        id: STUDIO_A,
        name: "Studio A",
        slug: "studio-a",
        status: "active",
        defaultLocale: "de",
        defaultTimezone: "Europe/Zurich",
        defaultWeightUnit: "kg",
        membership: { id: MEMBERSHIP, role, status: "active" },
        ...overrides
    };
}

const service = {
    async loadStudioContext(userId, studioId) {
        if (studioId !== STUDIO_A || userId === 99) throw new StudioNotFoundError();
        const role = userId === 2 ? "member" : userId === 3 ? "trainer" : "owner";
        return {
            studio: { internalId: 10, ...studio(role) },
            membership: {
                internalId: userId,
                id: MEMBERSHIP,
                userId,
                role,
                status: "active"
            }
        };
    },
    async createStudio(userId, input) {
        assert.equal(userId > 0, true);
        return studio("owner", { name: input.name, slug: input.slug });
    },
    async listStudios() {
        return [studio("owner")];
    },
    getStudio(context) {
        return studio(context.membership.role);
    },
    async updateStudio(userId, context, input) {
        return studio(context.membership.role, { name: input.name || "Studio A" });
    },
    async getOwnMembership(userId, context) {
        return { id: MEMBERSHIP, role: context.membership.role, status: "active" };
    },
    async listMemberships() {
        return { memberships: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
    },
    async updateMembership() {
        return { id: MEMBERSHIP, role: "trainer", status: "active" };
    },
    async createInvitation() {
        return { invitation: { id: STUDIO_B, role: "member", status: "pending" } };
    },
    async listInvitations() {
        return { invitations: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
    },
    async revokeInvitation() {
        return { id: STUDIO_B, role: "member", status: "revoked" };
    },
    async resendInvitation() {
        return {
            invitation: { id: STUDIO_B, email: "resend@example.test", role: "member", status: "pending", expiresAt: "2030-01-01T00:00:00.000Z" },
            delivery: { delivered: true }
        };
    },
    async acceptInvitation() {
        return { studio: studio("member"), membership: studio("member").membership };
    },
    async listAuditEvents() {
        return { auditEvents: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
    }
};

async function request(path, options = {}) {
    const headers = { Accept: "application/json", ...(options.headers || {}) };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${baseUrl}${path}`, {
        method: options.method || "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    return { response, data: await response.json() };
}

before(async () => {
    const users = express.Router();
    users.get("/me", (req, res) => res.json({ personal: true }));
    const empty = express.Router();
    // A pure in-process MemoryRateLimitStore - this is a unit test with no
    // real database, and the MySQL-backed store is the only one the real
    // app is allowed to use (see rateLimiting/memoryRateLimitStore.js).
    const rateLimiters = createRateLimiters({ store: createMemoryRateLimitStore() });
    const studioV1 = createStudioV1Router({
        service,
        authenticate: authentication,
        rateLimiters: {
            create: rateLimiters.invitationCreate,
            resend: rateLimiters.invitationResend,
            accept: rateLimiters.invitationAccept
        }
    });
    const app = createApp({
        readiness: { check: async () => ({ ready: true }) },
        logger: { info() {}, warn() {}, error() {} },
        routers: { users, exercises: empty, workouts: empty, progress: empty, studioV1 }
    });
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
});

test("unknown, malformed, and foreign studios share STUDIO_NOT_FOUND", async () => {
    const malformed = await request("/api/v1/studios/guessed-id", {
        headers: { "x-request-id": "malformed-studio" }
    });
    const foreign = await request(`/api/v1/studios/${STUDIO_A}`, {
        headers: { "x-test-user": "99", "x-request-id": "foreign-studio" }
    });
    for (const outcome of [malformed, foreign]) {
        assert.equal(outcome.response.status, 404);
        assert.equal(outcome.data.error.code, "STUDIO_NOT_FOUND");
        assert.match(outcome.data.error.requestId, /studio/);
    }
    assert.equal(malformed.data.error.message, foreign.data.error.message);
});

test("member can read studio and own membership but cannot read audit", async () => {
    const headers = { "x-test-user": "2" };
    const read = await request(`/api/v1/studios/${STUDIO_A}`, { headers });
    assert.equal(read.response.status, 200);
    assert.equal(read.data.studio.membership.role, "member");

    const own = await request(`/api/v1/studios/${STUDIO_A}/memberships/me`, { headers });
    assert.equal(own.response.status, 200);
    assert.equal(own.data.membership.role, "member");

    const audit = await request(`/api/v1/studios/${STUDIO_A}/audit-events`, { headers });
    assert.equal(audit.response.status, 403);
    assert.equal(audit.data.error.code, "INSUFFICIENT_STUDIO_ROLE");
});

test("studio create enforces exact payload and returns active owner context", async () => {
    const rejected = await request("/api/v1/studios", {
        method: "POST",
        body: { name: "Unsafe", role: "owner" }
    });
    assert.equal(rejected.response.status, 400);
    assert.equal(rejected.data.error.code, "VALIDATION_ERROR");

    const created = await request("/api/v1/studios", {
        method: "POST",
        body: {
            name: "Safe Studio",
            defaultLocale: "de",
            defaultTimezone: "Europe/Zurich",
            defaultWeightUnit: "kg"
        }
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.data.studio.membership.role, "owner");
    assert.equal(created.data.studio.membership.status, "active");
    assert.equal(created.data.studio.defaultTimezone, "Europe/Zurich");
});

test("invitation resend is gated to owner/admin, validates the invitation id, and reaches the service", async () => {
    const memberAttempt = await request(`/api/v1/studios/${STUDIO_A}/invitations/${MEMBERSHIP}/resend`, {
        method: "POST",
        headers: { "x-test-user": "2" }
    });
    assert.equal(memberAttempt.response.status, 403);
    assert.equal(memberAttempt.data.error.code, "INSUFFICIENT_STUDIO_ROLE");

    const trainerAttempt = await request(`/api/v1/studios/${STUDIO_A}/invitations/${MEMBERSHIP}/resend`, {
        method: "POST",
        headers: { "x-test-user": "3" }
    });
    assert.equal(trainerAttempt.response.status, 403);
    assert.equal(trainerAttempt.data.error.code, "INSUFFICIENT_STUDIO_ROLE");

    const malformedId = await request(`/api/v1/studios/${STUDIO_A}/invitations/not-a-uuid/resend`, {
        method: "POST"
    });
    assert.equal(malformedId.response.status, 400);
    assert.equal(malformedId.data.error.code, "VALIDATION_ERROR");

    const ownerAttempt = await request(`/api/v1/studios/${STUDIO_A}/invitations/${MEMBERSHIP}/resend`, {
        method: "POST"
    });
    assert.equal(ownerAttempt.response.status, 200, JSON.stringify(ownerAttempt.data));
    assert.equal(ownerAttempt.data.invitation.status, "pending");
    assert.equal(ownerAttempt.data.delivery.delivered, true);
});

test("personal API mount remains unchanged beside versioned studio routes", async () => {
    const response = await request("/api/users/me");
    assert.equal(response.response.status, 200);
    assert.deepEqual(response.data, { personal: true });
});
