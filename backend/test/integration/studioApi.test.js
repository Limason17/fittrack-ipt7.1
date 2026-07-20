const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mysql = require("mysql2/promise");

const TEST_DATABASE = `fittrack_api_test_studio_${process.pid}_${Date.now()}`;
if (!/^fittrack_api_test_studio_[A-Za-z0-9_]+$/.test(TEST_DATABASE)) {
    throw new Error("Refusing to use an unsafe studio API test database name.");
}

process.env.NODE_ENV = "test";
process.env.DB_NAME = TEST_DATABASE;
process.env.JWT_SECRET = "fittrack-stage-1a-test-secret-with-at-least-32-characters";
process.env.AUTH_LOGIN_RATE_LIMIT_MAX = "100";
process.env.AUTH_REGISTRATION_RATE_LIMIT_MAX = "100";
process.env.INVITATION_ACCEPT_BASE_URL = "http://127.0.0.1:4173";

const db = require("../../config/db");
const { createInvitationDelivery } = require("../../delivery/invitationDelivery");
const { createSmtpInvitationProvider } = require("../../delivery/smtpInvitationProvider");
const { createMigrationRunner } = require("../../migrations/runner");
const { createInvitationOutbox } = require("../../outbox/invitationOutbox");
const { createStudioService } = require("../../services/studioService");
const { createApp } = require("../../startup/app");

const logger = { info() {}, warn() {}, error() {} };
const runId = crypto.randomBytes(5).toString("hex");
let adminConnection;
let pool;
let server;
let baseUrl;
let studioA;
let studioB;
let studioBInvitation;
const accounts = {};
const membershipIds = {};

function fixture(name) {
    return {
        username: `stage1a-${name}-${runId}`,
        email: `stage1a-${name}-${runId}@example.test`,
        password: "correct horse battery staple stage1a"
    };
}

async function api(path, { method = "GET", token, body } = {}) {
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

function invitationToken(result) {
    assert.equal(result.response.status, 201, JSON.stringify(result.data));
    const url = result.data.delivery?.acceptUrl;
    assert.equal(typeof url, "string");
    return decodeURIComponent(new URL(url).pathname.split("/").pop());
}

async function invite(inviter, studioId, invitee, role) {
    return api(`/api/v1/studios/${studioId}/invitations`, {
        method: "POST",
        token: inviter.token,
        body: { email: invitee.email, role }
    });
}

async function inviteAndAccept(inviter, studioId, invitee, role) {
    const created = await invite(inviter, studioId, invitee, role);
    const token = invitationToken(created);
    const accepted = await api(`/api/v1/invitations/${token}/accept`, {
        method: "POST",
        token: invitee.token
    });
    assert.equal(accepted.response.status, 200, JSON.stringify(accepted.data));
    assert.equal(accepted.data.membership.role, role);
    return { token, invitation: created.data.invitation, membership: accepted.data.membership };
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

    for (const name of [
        "owner",
        "admin",
        "trainer",
        "member",
        "outsider",
        "revoked",
        "expired",
        "delivery",
        "failedDelivery",
        "concurrentAccept",
        "acceptVsRevoke"
    ]) {
        accounts[name] = await registerAndLogin(name);
    }

    const createdA = await api("/api/v1/studios", {
        method: "POST",
        token: accounts.owner.token,
        body: {
            name: "Stage 1A Alpha",
            slug: `stage1a-alpha-${runId}`,
            defaultLocale: "de",
            defaultTimezone: "Europe/Zurich",
            defaultWeightUnit: "kg"
        }
    });
    assert.equal(createdA.response.status, 201, JSON.stringify(createdA.data));
    studioA = createdA.data.studio;

    const createdB = await api("/api/v1/studios", {
        method: "POST",
        token: accounts.outsider.token,
        body: {
            name: "Stage 1A Beta",
            slug: `stage1a-beta-${runId}`,
            defaultLocale: "en",
            defaultTimezone: "Europe/London",
            defaultWeightUnit: "lb"
        }
    });
    assert.equal(createdB.response.status, 201, JSON.stringify(createdB.data));
    studioB = createdB.data.studio;

    membershipIds.owner = studioA.membership.id;
    membershipIds.outsiderOwner = studioB.membership.id;
    for (const [name, role] of [
        ["admin", "admin"],
        ["trainer", "trainer"],
        ["member", "member"]
    ]) {
        const result = await inviteAndAccept(accounts.owner, studioA.id, accounts[name], role);
        membershipIds[name] = result.membership.id;
    }
    const secondStudio = await inviteAndAccept(
        accounts.outsider,
        studioB.id,
        accounts.owner,
        "member"
    );
    membershipIds.ownerInB = secondStudio.membership.id;

    const createdBInvitation = await invite(
        accounts.outsider,
        studioB.id,
        accounts.delivery,
        "member"
    );
    invitationToken(createdBInvitation);
    studioBInvitation = createdBInvitation.data.invitation;
});

after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.closePool(db);
    if (adminConnection) {
        assert.match(TEST_DATABASE, /^fittrack_api_test_studio_[A-Za-z0-9_]+$/);
        await adminConnection.query(`DROP DATABASE IF EXISTS \`${TEST_DATABASE}\``);
        await adminConnection.end();
    }
});

test("one user can hold different roles in multiple studios without tenant leakage", async () => {
    const [[persistedAlpha]] = await pool.query(
        `SELECT s.created_at AS studio_created_at, s.updated_at AS studio_updated_at,
                sm.joined_at, sm.created_at AS membership_created_at,
                sm.updated_at AS membership_updated_at
         FROM studios s
         INNER JOIN studio_memberships sm ON sm.studio_id = s.id
         WHERE s.public_id = ? AND sm.public_id = ?`,
        [studioA.id, membershipIds.owner]
    );
    assert.equal(new Date(studioA.createdAt).getTime(), persistedAlpha.studio_created_at.getTime());
    assert.equal(new Date(studioA.updatedAt).getTime(), persistedAlpha.studio_updated_at.getTime());
    assert.equal(
        new Date(studioA.membership.joinedAt).getTime(),
        persistedAlpha.joined_at.getTime()
    );
    assert.equal(
        new Date(studioA.membership.createdAt).getTime(),
        persistedAlpha.membership_created_at.getTime()
    );
    assert.equal(
        new Date(studioA.membership.updatedAt).getTime(),
        persistedAlpha.membership_updated_at.getTime()
    );

    const studios = await api("/api/v1/studios", { token: accounts.owner.token });
    assert.equal(studios.response.status, 200);
    const alpha = studios.data.studios.find((studio) => studio.id === studioA.id);
    const beta = studios.data.studios.find((studio) => studio.id === studioB.id);
    assert.equal(alpha.membership.role, "owner");
    assert.equal(beta.membership.role, "member");

    const ownerCannotReadBMembers = await api(
        `/api/v1/studios/${studioB.id}/memberships`,
        { token: accounts.owner.token }
    );
    assert.equal(ownerCannotReadBMembers.response.status, 403);
    assert.equal(ownerCannotReadBMembers.data.error.code, "INSUFFICIENT_STUDIO_ROLE");

    const outsiderCannotReadA = await api(`/api/v1/studios/${studioA.id}`, {
        token: accounts.outsider.token
    });
    const guessed = await api(
        "/api/v1/studios/423e4567-e89b-42d3-a456-426614174000",
        { token: accounts.outsider.token }
    );
    assert.equal(outsiderCannotReadA.response.status, 404);
    assert.equal(guessed.response.status, 404);
    assert.equal(outsiderCannotReadA.data.error.code, "STUDIO_NOT_FOUND");
    assert.equal(guessed.data.error.code, "STUDIO_NOT_FOUND");

    const numericInternalId = await api("/api/v1/studios/1", {
        token: accounts.admin.token
    });
    assert.equal(numericInternalId.response.status, 404);
    assert.equal(numericInternalId.data.error.code, "STUDIO_NOT_FOUND");

    const crossTenantPatch = await api(
        `/api/v1/studios/${studioB.id}/memberships/${membershipIds.outsiderOwner}`,
        {
            method: "PATCH",
            token: accounts.admin.token,
            body: { status: "suspended" }
        }
    );
    const crossTenantList = await api(
        `/api/v1/studios/${studioB.id}/invitations`,
        { token: accounts.admin.token }
    );
    const crossTenantRevoke = await api(
        `/api/v1/studios/${studioB.id}/invitations/${studioBInvitation.id}`,
        { method: "DELETE", token: accounts.admin.token }
    );
    for (const result of [crossTenantPatch, crossTenantList, crossTenantRevoke]) {
        assert.equal(result.response.status, 404);
        assert.equal(result.data.error.code, "STUDIO_NOT_FOUND");
    }

    const foreignMembershipId = await api(
        `/api/v1/studios/${studioB.id}/memberships/${membershipIds.admin}`,
        {
            method: "PATCH",
            token: accounts.outsider.token,
            body: { status: "suspended" }
        }
    );
    assert.equal(foreignMembershipId.response.status, 404);
    assert.equal(foreignMembershipId.data.error.code, "MEMBERSHIP_NOT_FOUND");

    const foreignInvitationId = await api(
        `/api/v1/studios/${studioA.id}/invitations/${studioBInvitation.id}`,
        { method: "DELETE", token: accounts.owner.token }
    );
    assert.equal(foreignInvitationId.response.status, 404);
    assert.equal(foreignInvitationId.data.error.code, "INVITATION_INVALID");
});

test("studio creation rolls back all writes when owner membership creation fails", async () => {
    const failedStudioId = crypto.randomUUID();
    const failedMembershipId = crypto.randomUUID();
    const failedSlug = `stage1a-rollback-${runId}`;
    let generatedIds = 0;
    const service = createStudioService({
        database: {
            async getConnection() {
                const connection = await pool.getConnection();
                let queries = 0;
                return {
                    beginTransaction: connection.beginTransaction.bind(connection),
                    commit: connection.commit.bind(connection),
                    rollback: connection.rollback.bind(connection),
                    release: connection.release.bind(connection),
                    async query(...args) {
                        queries += 1;
                        if (queries === 2) {
                            throw new Error("injected owner membership write failure");
                        }
                        return connection.query(...args);
                    }
                };
            }
        },
        generatePublicId() {
            generatedIds += 1;
            return generatedIds === 1 ? failedStudioId : failedMembershipId;
        }
    });
    await assert.rejects(
        service.createStudio(accounts.owner.id, {
            name: "Must Roll Back",
            slug: failedSlug,
            default_locale: "de",
            default_timezone: "Europe/Zurich",
            default_weight_unit: "kg"
        }),
        /injected owner membership write failure/
    );
    const [[counts]] = await pool.query(
        `SELECT
            (SELECT COUNT(*) FROM studios WHERE public_id = ? OR slug = ?) AS studios_count,
            (SELECT COUNT(*) FROM studio_memberships WHERE public_id = ?) AS memberships_count,
            (SELECT COUNT(*) FROM studio_audit_events WHERE target_public_id = ?) AS audit_count`,
        [failedStudioId, failedSlug, failedMembershipId, failedStudioId]
    );
    assert.deepEqual({
        studios: Number(counts.studios_count),
        memberships: Number(counts.memberships_count),
        audits: Number(counts.audit_count)
    }, { studios: 0, memberships: 0, audits: 0 });
});

test("owner, admin, trainer, and member permissions are enforced server-side", async () => {
    const adminBasic = await api(`/api/v1/studios/${studioA.id}`, {
        method: "PATCH",
        token: accounts.admin.token,
        body: {
            name: "Stage 1A Alpha Updated",
            defaultLocale: "en",
            defaultTimezone: "Europe/Zurich",
            defaultWeightUnit: "kg"
        }
    });
    assert.equal(adminBasic.response.status, 200, JSON.stringify(adminBasic.data));
    assert.equal(adminBasic.data.studio.membership.role, "admin");
    const [[persistedStudioUpdate]] = await pool.query(
        "SELECT updated_at FROM studios WHERE public_id = ?",
        [studioA.id]
    );
    assert.equal(
        new Date(adminBasic.data.studio.updatedAt).getTime(),
        persistedStudioUpdate.updated_at.getTime()
    );

    const adminSlug = await api(`/api/v1/studios/${studioA.id}`, {
        method: "PATCH",
        token: accounts.admin.token,
        body: { slug: `forbidden-admin-${runId}` }
    });
    assert.equal(adminSlug.response.status, 403);
    assert.equal(adminSlug.data.error.code, "INSUFFICIENT_STUDIO_ROLE");

    const adminInviteAdmin = await invite(accounts.admin, studioA.id, accounts.revoked, "admin");
    assert.equal(adminInviteAdmin.response.status, 403);
    assert.equal(adminInviteAdmin.data.error.code, "INSUFFICIENT_STUDIO_ROLE");

    const adminTouchesOwner = await api(
        `/api/v1/studios/${studioA.id}/memberships/${membershipIds.owner}`,
        {
            method: "PATCH",
            token: accounts.admin.token,
            body: { status: "suspended" }
        }
    );
    assert.equal(adminTouchesOwner.response.status, 403);
    assert.equal(adminTouchesOwner.data.error.code, "INSUFFICIENT_STUDIO_ROLE");

    const adminManagesTrainer = await api(
        `/api/v1/studios/${studioA.id}/memberships/${membershipIds.trainer}`,
        {
            method: "PATCH",
            token: accounts.admin.token,
            body: { role: "member" }
        }
    );
    assert.equal(adminManagesTrainer.response.status, 200);
    assert.equal(adminManagesTrainer.data.membership.role, "member");
    const [[persistedMembershipUpdate]] = await pool.query(
        "SELECT updated_at FROM studio_memberships WHERE public_id = ?",
        [membershipIds.trainer]
    );
    assert.equal(
        new Date(adminManagesTrainer.data.membership.updatedAt).getTime(),
        persistedMembershipUpdate.updated_at.getTime()
    );
    await api(`/api/v1/studios/${studioA.id}/memberships/${membershipIds.trainer}`, {
        method: "PATCH",
        token: accounts.owner.token,
        body: { role: "trainer" }
    });

    for (const [role, account] of [
        ["trainer", accounts.trainer],
        ["member", accounts.member]
    ]) {
        const read = await api(`/api/v1/studios/${studioA.id}`, { token: account.token });
        assert.equal(read.response.status, 200);
        const list = await api(`/api/v1/studios/${studioA.id}/memberships`, {
            token: account.token
        });
        if (role === "trainer") {
            assert.equal(list.response.status, 200);
            assert.ok(list.data.memberships.length >= 4);
            assert.ok(list.data.memberships.every((membership) => membership.status === "active"));
            for (const membership of list.data.memberships) {
                assert.deepEqual(Object.keys(membership.user), ["displayName"]);
                assert.equal(typeof membership.user.displayName, "string");
                assert.notEqual(membership.user.displayName, "");
            }
            const displayNames = new Set(
                list.data.memberships.map((membership) => membership.user.displayName)
            );
            for (const expected of [
                accounts.owner.username,
                accounts.admin.username,
                accounts.trainer.username,
                accounts.member.username
            ]) {
                assert.equal(displayNames.has(expected), true);
            }
            assert.doesNotMatch(JSON.stringify(list.data), /@example\.test/i);
        } else {
            assert.equal(list.response.status, 403);
            assert.equal(list.data.error.code, "INSUFFICIENT_STUDIO_ROLE");
        }

        const invitation = await invite(
            account,
            studioA.id,
            accounts.failedDelivery,
            "member"
        );
        assert.equal(invitation.response.status, 403);
        assert.equal(invitation.data.error.code, "INSUFFICIENT_STUDIO_ROLE");

        const membershipPatch = await api(
            `/api/v1/studios/${studioA.id}/memberships/${membershipIds.admin}`,
            { method: "PATCH", token: account.token, body: { role: "member" } }
        );
        assert.equal(membershipPatch.response.status, 403);
        assert.equal(membershipPatch.data.error.code, "INSUFFICIENT_STUDIO_ROLE");
    }

    const appointOwner = await api(
        `/api/v1/studios/${studioA.id}/memberships/${membershipIds.admin}`,
        { method: "PATCH", token: accounts.owner.token, body: { role: "owner" } }
    );
    assert.equal(appointOwner.response.status, 200);
    const restoreAdmin = await api(
        `/api/v1/studios/${studioA.id}/memberships/${membershipIds.admin}`,
        { method: "PATCH", token: accounts.owner.token, body: { role: "admin" } }
    );
    assert.equal(restoreAdmin.response.status, 200);

    const removeLastOwner = await api(
        `/api/v1/studios/${studioA.id}/memberships/${membershipIds.owner}`,
        { method: "PATCH", token: accounts.owner.token, body: { status: "left" } }
    );
    assert.equal(removeLastOwner.response.status, 409);
    assert.equal(removeLastOwner.data.error.code, "LAST_OWNER_REQUIRED");
});

test("suspended and left memberships lose access and left membership can reactivate", async () => {
    const suspended = await api(
        `/api/v1/studios/${studioA.id}/memberships/${membershipIds.trainer}`,
        { method: "PATCH", token: accounts.owner.token, body: { status: "suspended" } }
    );
    assert.equal(suspended.response.status, 200);
    const afterSuspension = await api(`/api/v1/studios/${studioA.id}`, {
        token: accounts.trainer.token
    });
    assert.equal(afterSuspension.response.status, 404);
    assert.equal(afterSuspension.data.error.code, "STUDIO_NOT_FOUND");
    await api(`/api/v1/studios/${studioA.id}/memberships/${membershipIds.trainer}`, {
        method: "PATCH",
        token: accounts.owner.token,
        body: { status: "active" }
    });

    const memberSuspended = await api(
        `/api/v1/studios/${studioA.id}/memberships/${membershipIds.member}`,
        { method: "PATCH", token: accounts.owner.token, body: { status: "suspended" } }
    );
    assert.equal(memberSuspended.response.status, 200);
    const trainerDuringSuspension = await api(
        `/api/v1/studios/${studioA.id}/memberships?limit=100`,
        { token: accounts.trainer.token }
    );
    assert.equal(trainerDuringSuspension.response.status, 200);
    assert.equal(
        trainerDuringSuspension.data.memberships.some(
            (membership) => membership.id === membershipIds.member
        ),
        false
    );
    assert.ok(
        trainerDuringSuspension.data.memberships.every(
            (membership) => membership.status === "active"
        )
    );
    assert.doesNotMatch(JSON.stringify(trainerDuringSuspension.data), /@example\.test/i);
    const memberRestored = await api(
        `/api/v1/studios/${studioA.id}/memberships/${membershipIds.member}`,
        { method: "PATCH", token: accounts.owner.token, body: { status: "active" } }
    );
    assert.equal(memberRestored.response.status, 200);

    const left = await api(
        `/api/v1/studios/${studioA.id}/memberships/${membershipIds.member}`,
        { method: "PATCH", token: accounts.owner.token, body: { status: "left" } }
    );
    assert.equal(left.response.status, 200);
    const [[persistedLeft]] = await pool.query(
        "SELECT updated_at FROM studio_memberships WHERE public_id = ?",
        [membershipIds.member]
    );
    assert.equal(
        new Date(left.data.membership.updatedAt).getTime(),
        persistedLeft.updated_at.getTime()
    );
    const afterLeft = await api(`/api/v1/studios/${studioA.id}`, {
        token: accounts.member.token
    });
    assert.equal(afterLeft.response.status, 404);

    for (const status of ["active", "suspended"]) {
        const bypass = await api(
            `/api/v1/studios/${studioA.id}/memberships/${membershipIds.member}`,
            { method: "PATCH", token: accounts.owner.token, body: { status } }
        );
        assert.equal(bypass.response.status, 403);
        assert.equal(bypass.data.error.code, "INSUFFICIENT_STUDIO_ROLE");
        assert.doesNotMatch(JSON.stringify(bypass.data), new RegExp(accounts.member.email));
    }

    const membershipList = await api(`/api/v1/studios/${studioA.id}/memberships`, {
        token: accounts.owner.token
    });
    const former = membershipList.data.memberships.find((item) => item.id === membershipIds.member);
    assert.equal(former.status, "left");
    assert.deepEqual(former.user, { displayName: "Former member" });
    assert.doesNotMatch(JSON.stringify(former), new RegExp(accounts.member.email));

    const trainerAfterLeft = await api(
        `/api/v1/studios/${studioA.id}/memberships?limit=100`,
        { token: accounts.trainer.token }
    );
    assert.equal(trainerAfterLeft.response.status, 200);
    assert.equal(
        trainerAfterLeft.data.memberships.some(
            (membership) => membership.id === membershipIds.member
        ),
        false
    );
    assert.doesNotMatch(JSON.stringify(trainerAfterLeft.data), /@example\.test/i);

    const reactivation = await inviteAndAccept(
        accounts.owner,
        studioA.id,
        accounts.member,
        "member"
    );
    assert.equal(reactivation.membership.id, membershipIds.member);
    const [[persistedReactivation]] = await pool.query(
        `SELECT joined_at, created_at, updated_at
         FROM studio_memberships
         WHERE public_id = ?`,
        [membershipIds.member]
    );
    assert.equal(
        new Date(reactivation.membership.joinedAt).getTime(),
        persistedReactivation.joined_at.getTime()
    );
    assert.equal(
        new Date(reactivation.membership.createdAt).getTime(),
        persistedReactivation.created_at.getTime()
    );
    assert.equal(
        new Date(reactivation.membership.updatedAt).getTime(),
        persistedReactivation.updated_at.getTime()
    );
    const replay = await api(`/api/v1/invitations/${reactivation.token}/accept`, {
        method: "POST",
        token: accounts.member.token
    });
    assert.equal(replay.response.status, 409);
    assert.equal(replay.data.error.code, "INVITATION_ALREADY_USED");
});

test("invitation mismatch, revocation, expiration, and list privacy are safe", async () => {
    const mismatchCreated = await invite(
        accounts.owner,
        studioA.id,
        accounts.delivery,
        "member"
    );
    const mismatchToken = invitationToken(mismatchCreated);
    const mismatch = await api(`/api/v1/invitations/${mismatchToken}/accept`, {
        method: "POST",
        token: accounts.revoked.token
    });
    const malformed = await api("/api/v1/invitations/not-a-valid-token/accept", {
        method: "POST",
        token: accounts.revoked.token
    });
    assert.equal(mismatch.response.status, malformed.response.status);
    assert.equal(mismatch.data.error.code, "INVITATION_INVALID");
    assert.equal(malformed.data.error.code, "INVITATION_INVALID");

    const revokedCreated = await invite(
        accounts.owner,
        studioA.id,
        accounts.revoked,
        "member"
    );
    const revokedToken = invitationToken(revokedCreated);
    const revoked = await api(
        `/api/v1/studios/${studioA.id}/invitations/${revokedCreated.data.invitation.id}`,
        { method: "DELETE", token: accounts.owner.token }
    );
    assert.equal(revoked.response.status, 200);
    const revokedAccept = await api(`/api/v1/invitations/${revokedToken}/accept`, {
        method: "POST",
        token: accounts.revoked.token
    });
    assert.equal(revokedAccept.response.status, 409);
    assert.equal(revokedAccept.data.error.code, "INVITATION_REVOKED");

    const expiredCreated = await invite(
        accounts.owner,
        studioA.id,
        accounts.expired,
        "trainer"
    );
    const expiredToken = invitationToken(expiredCreated);
    await pool.query(
        "UPDATE studio_invitations SET expires_at = '2020-01-01 00:00:00' WHERE public_id = ?",
        [expiredCreated.data.invitation.id]
    );
    const expiredAccept = await api(`/api/v1/invitations/${expiredToken}/accept`, {
        method: "POST",
        token: accounts.expired.token
    });
    assert.equal(expiredAccept.response.status, 410);
    assert.equal(expiredAccept.data.error.code, "INVITATION_EXPIRED");

    const invitations = await api(`/api/v1/studios/${studioA.id}/invitations?limit=100`, {
        token: accounts.owner.token
    });
    assert.equal(invitations.response.status, 200);
    for (const invitation of invitations.data.invitations) {
        if (invitation.status === "pending") {
            assert.equal(typeof invitation.email, "string");
        } else {
            assert.equal(Object.hasOwn(invitation, "email"), false);
        }
    }
});

test("concurrent invitation acceptance and revoke races have one atomic winner", async () => {
    const concurrentCreated = await invite(
        accounts.owner,
        studioA.id,
        accounts.concurrentAccept,
        "member"
    );
    const concurrentToken = invitationToken(concurrentCreated);
    const concurrentResults = await Promise.all([
        api(`/api/v1/invitations/${concurrentToken}/accept`, {
            method: "POST",
            token: accounts.concurrentAccept.token
        }),
        api(`/api/v1/invitations/${concurrentToken}/accept`, {
            method: "POST",
            token: accounts.concurrentAccept.token
        })
    ]);
    assert.equal(
        concurrentResults.filter(({ response }) => response.status === 200).length,
        1
    );
    const replayResult = concurrentResults.find(({ response }) => response.status !== 200);
    assert.equal(replayResult.response.status, 409);
    assert.equal(replayResult.data.error.code, "INVITATION_ALREADY_USED");
    const [[concurrentMemberships]] = await pool.query(
        `SELECT COUNT(*) AS total
         FROM studio_memberships sm
         INNER JOIN studios s ON s.id = sm.studio_id
         INNER JOIN users u ON u.id = sm.user_id
         WHERE s.public_id = ? AND LOWER(u.email) = ?`,
        [studioA.id, accounts.concurrentAccept.email]
    );
    assert.equal(Number(concurrentMemberships.total), 1);

    const racedCreated = await invite(
        accounts.owner,
        studioA.id,
        accounts.acceptVsRevoke,
        "trainer"
    );
    const racedToken = invitationToken(racedCreated);
    const racedResults = await Promise.all([
        api(`/api/v1/invitations/${racedToken}/accept`, {
            method: "POST",
            token: accounts.acceptVsRevoke.token
        }),
        api(
            `/api/v1/studios/${studioA.id}/invitations/${racedCreated.data.invitation.id}`,
            { method: "DELETE", token: accounts.owner.token }
        )
    ]);
    assert.equal(racedResults.filter(({ response }) => response.status === 200).length, 1);
    const racedLoser = racedResults.find(({ response }) => response.status !== 200);
    assert.equal(racedLoser.response.status, 409);
    assert.ok([
        "INVITATION_ALREADY_USED",
        "INVITATION_REVOKED"
    ].includes(racedLoser.data.error.code));
    const [[racedInvitation]] = await pool.query(
        "SELECT status FROM studio_invitations WHERE public_id = ?",
        [racedCreated.data.invitation.id]
    );
    assert.ok(["accepted", "revoked"].includes(racedInvitation.status));
    const [[racedMemberships]] = await pool.query(
        `SELECT COUNT(*) AS total
         FROM studio_memberships sm
         INNER JOIN studios s ON s.id = sm.studio_id
         INNER JOIN users u ON u.id = sm.user_id
         WHERE s.public_id = ? AND LOWER(u.email) = ? AND sm.status = 'active'`,
        [studioA.id, accounts.acceptVsRevoke.email]
    );
    assert.equal(
        Number(racedMemberships.total),
        racedInvitation.status === "accepted" ? 1 : 0
    );
});

test("delivery failure is visible, compensates pending state, and audit is sanitized", async () => {
    const contextService = createStudioService({ database: pool });
    const context = await contextService.loadStudioContext(accounts.owner.id, studioA.id);
    const unavailableService = createStudioService({
        database: pool,
        outbox: createInvitationOutbox({
            delivery: createInvitationDelivery({
                env: {
                    NODE_ENV: "production",
                    INVITATION_ACCEPT_BASE_URL: "https://app.example.test"
                }
            })
        })
    });
    await assert.rejects(
        unavailableService.createInvitation(accounts.owner.id, context, {
            email: accounts.failedDelivery.email,
            role: "trainer"
        }),
        (error) => error.code === "INVITATION_DELIVERY_UNAVAILABLE"
    );
    const [[beforeFailure]] = await pool.query(
        "SELECT COUNT(*) AS total FROM studio_invitations WHERE studio_id = ? AND email_normalized = ?",
        [context.studio.internalId, accounts.failedDelivery.email]
    );
    assert.equal(Number(beforeFailure.total), 0);

    let leakedToken;
    const service = createStudioService({
        database: pool,
        outbox: createInvitationOutbox({
            delivery: createInvitationDelivery({
                env: {
                    NODE_ENV: "production",
                    INVITATION_ACCEPT_BASE_URL: "https://app.example.test"
                },
                provider: {
                    async sendInvitation(message) {
                        leakedToken = new URL(message.acceptanceUrl).pathname.split("/").pop();
                        throw new Error(`provider echoed ${message.acceptanceUrl}`);
                    }
                }
            })
        })
    });
    let surfacedError;
    await assert.rejects(
        service.createInvitation(accounts.owner.id, context, {
            email: accounts.failedDelivery.email,
            role: "trainer"
        }),
        (error) => {
            surfacedError = error;
            return error.code === "INVITATION_DELIVERY_FAILED";
        }
    );
    assert.match(leakedToken, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(surfacedError.cause, undefined);
    assert.doesNotMatch(`${surfacedError.message} ${surfacedError.stack}`, new RegExp(leakedToken));
    const [failedInvitations] = await pool.query(
        `SELECT public_id, status
         FROM studio_invitations
         WHERE studio_id = ? AND email_normalized = ?
         ORDER BY id DESC LIMIT 1`,
        [context.studio.internalId, accounts.failedDelivery.email]
    );
    assert.equal(failedInvitations[0].status, "revoked");

    const pollutedPublicId = crypto.randomUUID();
    await pool.query(
        `INSERT INTO studio_audit_events (
            public_id, studio_id, actor_user_id, event_type,
            target_type, target_public_id, details_json
         ) VALUES (?, ?, ?, 'invitation.created', 'invitation', ?, ?)`,
        [
            pollutedPublicId,
            context.studio.internalId,
            accounts.owner.id,
            failedInvitations[0].public_id,
            JSON.stringify({ role: "trainer", email: "private@example.test" })
        ]
    );
    const audit = await api(`/api/v1/studios/${studioA.id}/audit-events?page=1&limit=100`, {
        token: accounts.owner.token
    });
    assert.equal(audit.response.status, 200);
    assert.equal(audit.data.pagination.page, 1);
    assert.ok(audit.data.pagination.totalPages >= 1);
    const polluted = audit.data.auditEvents.find((event) => event.id === pollutedPublicId);
    assert.ok(polluted);
    assert.deepEqual(polluted.details, {});
    assert.doesNotMatch(JSON.stringify(audit.data), /private@example\.test|provider echoed/);

    const auditEventTypes = new Set(audit.data.auditEvents.map((event) => event.eventType));
    for (const expected of [
        "membership.role_changed",
        "membership.suspended",
        "membership.reactivated",
        "membership.left"
    ]) {
        assert.ok(auditEventTypes.has(expected), `missing audit event type ${expected}`);
    }
    assert.equal(auditEventTypes.has("membership.updated"), false);

    const pagedAudit = await api(
        `/api/v1/studios/${studioA.id}/audit-events?page=1&limit=2`,
        { token: accounts.owner.token }
    );
    assert.equal(pagedAudit.response.status, 200);
    assert.equal(pagedAudit.data.auditEvents.length, 2);
    assert.equal(pagedAudit.data.pagination.limit, 2);

    const trainerAudit = await api(`/api/v1/studios/${studioA.id}/audit-events`, {
        token: accounts.trainer.token
    });
    assert.equal(trainerAudit.response.status, 403);
    assert.equal(trainerAudit.data.error.code, "INSUFFICIENT_STUDIO_ROLE");
});

function smtpEnv(overrides = {}) {
    return {
        NODE_ENV: "production",
        INVITATION_ACCEPT_BASE_URL: "https://app.example.test",
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

function fakeSmtpTransportFactory(sendMail) {
    return () => ({
        async sendMail(message) { return sendMail(message); },
        close() {}
    });
}

test("a configured fake SMTP provider delivers the invitation without leaking internals or an acceptUrl", async () => {
    const contextService = createStudioService({ database: pool });
    const context = await contextService.loadStudioContext(accounts.owner.id, studioA.id);

    const captured = [];
    const service = createStudioService({
        database: pool,
        outbox: createInvitationOutbox({
            delivery: createInvitationDelivery({
                env: smtpEnv(),
                provider: createSmtpInvitationProvider({
                    config: require("../../config/smtpConfig").readSmtpConfig(smtpEnv()),
                    transportFactory: fakeSmtpTransportFactory(async (message) => { captured.push(message); }),
                    logger: { info() {}, warn() {}, error() {} }
                })
            })
        })
    });

    const recipientEmail = `smtp-fake-success-${runId}@example.test`;
    const result = await service.createInvitation(accounts.owner.id, context, {
        email: recipientEmail,
        role: "trainer"
    }, { requestId: "test-request-id" });

    assert.deepEqual(result.delivery, { delivered: true });
    assert.equal("acceptUrl" in result.delivery, false);
    assert.equal(captured.length, 1);
    assert.equal(captured[0].to, recipientEmail);
    assert.ok(captured[0].text.includes("https://app.example.test/invitations/"));

    // The provider only ever sees mail-shape fields, never a studio/user/
    // invitation internal auto-increment id or any other internal identifier.
    assert.deepEqual(Object.keys(captured[0]).sort(), ["from", "html", "replyTo", "subject", "text", "to"]);
    assert.doesNotMatch(JSON.stringify(captured[0]), /"id":\s*\d+/);
});

test("without any configured provider, production invitation creation fails closed before persisting anything", async () => {
    const contextService = createStudioService({ database: pool });
    const context = await contextService.loadStudioContext(accounts.owner.id, studioA.id);
    const closedService = createStudioService({
        database: pool,
        outbox: createInvitationOutbox({
            delivery: createInvitationDelivery({ env: { NODE_ENV: "production", INVITATION_ACCEPT_BASE_URL: "https://app.example.test" } })
        })
    });
    const recipientEmail = `smtp-fail-closed-${runId}@example.test`;
    await assert.rejects(
        closedService.createInvitation(accounts.owner.id, context, { email: recipientEmail, role: "member" }),
        (error) => error.code === "INVITATION_DELIVERY_UNAVAILABLE"
    );
    const [[count]] = await pool.query(
        "SELECT COUNT(*) AS total FROM studio_invitations WHERE studio_id = ? AND email_normalized = ?",
        [context.studio.internalId, recipientEmail]
    );
    assert.equal(Number(count.total), 0);
});

test("a fake SMTP delivery failure compensates the invitation to revoked and the client sees no SMTP detail", async () => {
    const contextService = createStudioService({ database: pool });
    const context = await contextService.loadStudioContext(accounts.owner.id, studioA.id);
    const service = createStudioService({
        database: pool,
        outbox: createInvitationOutbox({
            delivery: createInvitationDelivery({
                env: smtpEnv(),
                provider: createSmtpInvitationProvider({
                    config: require("../../config/smtpConfig").readSmtpConfig(smtpEnv()),
                    transportFactory: fakeSmtpTransportFactory(async () => {
                        throw Object.assign(new Error("550 mailbox does not exist at relay-internal-host.test"), {
                            code: "EENVELOPE",
                            command: "RCPT TO"
                        });
                    }),
                    logger: { info() {}, warn() {}, error() {} }
                })
            })
        })
    });

    const recipientEmail = `smtp-fake-failure-${runId}@example.test`;
    let surfaced;
    await assert.rejects(
        service.createInvitation(accounts.owner.id, context, { email: recipientEmail, role: "member" }),
        (error) => { surfaced = error; return error.code === "INVITATION_DELIVERY_FAILED"; }
    );
    assert.doesNotMatch(
        `${surfaced.message} ${surfaced.stack}`,
        /mailbox does not exist|relay-internal-host/
    );

    const [rows] = await pool.query(
        `SELECT public_id, status FROM studio_invitations
         WHERE studio_id = ? AND email_normalized = ? ORDER BY id DESC LIMIT 1`,
        [context.studio.internalId, recipientEmail]
    );
    assert.equal(rows[0].status, "revoked");

    const acceptAttempt = await api(`/api/v1/invitations/${crypto.randomBytes(32).toString("base64url")}/accept`, {
        method: "POST",
        token: accounts.owner.token
    });
    assert.equal(acceptAttempt.response.status, 404);
    assert.equal(acceptAttempt.data.error.code, "INVITATION_INVALID");

    const [[auditRow]] = await pool.query(
        `SELECT details_json FROM studio_audit_events
         WHERE studio_id = ? AND event_type = 'invitation.delivery_failed' AND target_public_id = ?`,
        [context.studio.internalId, rows[0].public_id]
    );
    assert.deepEqual(auditRow.details_json, { role: "member" });
    assert.doesNotMatch(
        JSON.stringify(auditRow.details_json),
        /mailbox does not exist|relay-internal-host|@example\.test/
    );
});

test("concurrent invitation creation for two different e-mail addresses is safe and each provider call gets its own recipient", async () => {
    const contextService = createStudioService({ database: pool });
    const context = await contextService.loadStudioContext(accounts.owner.id, studioA.id);
    const captured = [];
    const service = createStudioService({
        database: pool,
        outbox: createInvitationOutbox({
            delivery: createInvitationDelivery({
                env: smtpEnv(),
                provider: createSmtpInvitationProvider({
                    config: require("../../config/smtpConfig").readSmtpConfig(smtpEnv()),
                    transportFactory: fakeSmtpTransportFactory(async (message) => { captured.push(message); }),
                    logger: { info() {}, warn() {}, error() {} }
                })
            })
        })
    });

    const emailA = `smtp-concurrent-a-${runId}@example.test`;
    const emailB = `smtp-concurrent-b-${runId}@example.test`;
    const [resultA, resultB] = await Promise.all([
        service.createInvitation(accounts.owner.id, context, { email: emailA, role: "member" }),
        service.createInvitation(accounts.owner.id, context, { email: emailB, role: "member" })
    ]);
    assert.deepEqual(resultA.delivery, { delivered: true });
    assert.deepEqual(resultB.delivery, { delivered: true });
    assert.equal(captured.length, 2);
    assert.deepEqual(new Set(captured.map((message) => message.to)), new Set([emailA, emailB]));
});

test("concurrent owner demotions preserve at least one active owner", async () => {
    const promoted = await api(
        `/api/v1/studios/${studioA.id}/memberships/${membershipIds.admin}`,
        { method: "PATCH", token: accounts.owner.token, body: { role: "owner" } }
    );
    assert.equal(promoted.response.status, 200, JSON.stringify(promoted.data));

    const results = await Promise.all([
        api(`/api/v1/studios/${studioA.id}/memberships/${membershipIds.admin}`, {
            method: "PATCH",
            token: accounts.owner.token,
            body: { role: "admin" }
        }),
        api(`/api/v1/studios/${studioA.id}/memberships/${membershipIds.owner}`, {
            method: "PATCH",
            token: accounts.admin.token,
            body: { role: "admin" }
        })
    ]);
    assert.equal(results.filter(({ response }) => response.status === 200).length, 1);
    const loser = results.find(({ response }) => response.status !== 200);
    assert.equal(loser.response.status, 403);
    assert.equal(loser.data.error.code, "INSUFFICIENT_STUDIO_ROLE");
    const [[ownerCount]] = await pool.query(
        `SELECT COUNT(*) AS total
         FROM studio_memberships sm
         INNER JOIN studios s ON s.id = sm.studio_id
         WHERE s.public_id = ? AND sm.role = 'owner' AND sm.status = 'active'`,
        [studioA.id]
    );
    assert.equal(Number(ownerCount.total), 1);

    const [roles] = await pool.query(
        `SELECT public_id, role
         FROM studio_memberships
         WHERE public_id IN (?, ?)`,
        [membershipIds.owner, membershipIds.admin]
    );
    const originalOwner = roles.find((row) => row.public_id === membershipIds.owner);
    if (originalOwner.role !== "owner") {
        const restoreOwner = await api(
            `/api/v1/studios/${studioA.id}/memberships/${membershipIds.owner}`,
            { method: "PATCH", token: accounts.admin.token, body: { role: "owner" } }
        );
        assert.equal(restoreOwner.response.status, 200, JSON.stringify(restoreOwner.data));
    }
    const restoreAdmin = await api(
        `/api/v1/studios/${studioA.id}/memberships/${membershipIds.admin}`,
        { method: "PATCH", token: accounts.owner.token, body: { role: "admin" } }
    );
    assert.equal(restoreAdmin.response.status, 200, JSON.stringify(restoreAdmin.data));
});

test("personal workout APIs remain isolated and functional after studio operations", async () => {
    const exercises = await api("/api/exercises", { token: accounts.owner.token });
    assert.equal(exercises.response.status, 200);
    const exercise = exercises.data.find((item) => item.category !== "Cardio");
    const created = await api("/api/workouts", {
        method: "POST",
        token: accounts.owner.token,
        body: {
            title: "Personal Stage 1A regression",
            workout_date: "2026-07-18",
            exercises: [{ exercise_id: exercise.id, sets: 3, reps: 8, weight: 42 }]
        }
    });
    assert.equal(created.response.status, 201, JSON.stringify(created.data));
    const workouts = await api("/api/workouts", { token: accounts.owner.token });
    assert.equal(workouts.response.status, 200);
    assert.ok(workouts.data.some((workout) => workout.id === created.data.workoutId));
    const foreign = await api("/api/workouts", { token: accounts.outsider.token });
    assert.equal(foreign.data.some((workout) => workout.id === created.data.workoutId), false);
});
