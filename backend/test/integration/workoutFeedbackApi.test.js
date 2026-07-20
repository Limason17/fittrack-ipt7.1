const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mysql = require("mysql2/promise");

const TEST_DATABASE = `fittrack_api_test_feedback_${process.pid}_${Date.now()}`;
if (!/^fittrack_api_test_feedback_[A-Za-z0-9_]+$/.test(TEST_DATABASE)) {
    throw new Error("Refusing to use an unsafe feedback API test database name.");
}

process.env.NODE_ENV = "test";
process.env.DB_NAME = TEST_DATABASE;
process.env.JWT_SECRET = "fittrack-stage-1b2b2b-test-secret-with-at-least-32-characters";
process.env.AUTH_LOGIN_RATE_LIMIT_MAX = "100";
process.env.AUTH_REGISTRATION_RATE_LIMIT_MAX = "100";
process.env.INVITATION_ACCEPT_BASE_URL = "http://127.0.0.1:4173";

const db = require("../../config/db");
const { createMigrationRunner } = require("../../migrations/runner");
const { createApp } = require("../../startup/app");

const logger = { info() {}, warn() {}, error() {} };
const runId = crypto.randomBytes(5).toString("hex");
let adminConnection;
let pool;
let server;
let baseUrl;
let studioA;
let studioB;
const accounts = {};
const membershipIds = {};
const relationships = {};
const sessions = {};

function fixture(name) {
    return {
        username: `stage1b2b2b-${name}-${runId}`,
        email: `stage1b2b2b-${name}-${runId}@example.test`,
        password: "correct horse battery staple stage1b2b2b"
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
    return { ...user, id: loggedIn.data.user.id, token: loggedIn.data.token };
}

function invitationToken(result) {
    assert.equal(result.response.status, 201, JSON.stringify(result.data));
    const url = result.data.delivery?.acceptUrl;
    return decodeURIComponent(new URL(url).pathname.split("/").pop());
}

async function inviteAndAccept(inviter, studioId, invitee, role) {
    const created = await api(`/api/v1/studios/${studioId}/invitations`, {
        method: "POST",
        token: inviter.token,
        body: { email: invitee.email, role }
    });
    const token = invitationToken(created);
    const accepted = await api(`/api/v1/invitations/${token}/accept`, {
        method: "POST",
        token: invitee.token
    });
    assert.equal(accepted.response.status, 200, JSON.stringify(accepted.data));
    return accepted.data.membership;
}

async function createRelationship(actor, studioId, coachMembershipId, memberMembershipId) {
    const result = await api(`/api/v1/studios/${studioId}/coaching-relationships`, {
        method: "POST",
        token: actor.token,
        body: { coachMembershipId, memberMembershipId }
    });
    assert.equal(result.response.status, 201, JSON.stringify(result.data));
    return result.data.coachingRelationship;
}

async function endRelationship(actor, studioId, relationshipId) {
    const result = await api(`/api/v1/studios/${studioId}/coaching-relationships/${relationshipId}`, {
        method: "PATCH", token: actor.token, body: { status: "ended" }
    });
    assert.equal(result.response.status, 200, JSON.stringify(result.data));
    return result.data.coachingRelationship;
}

async function setupStudioProgram(ownerAuth, studioId, dayName, exerciseName) {
    const program = await api(`/api/v1/studios/${studioId}/training-programs`, {
        method: "POST", token: ownerAuth.token, body: { name: `Program ${dayName}` }
    });
    assert.equal(program.response.status, 201, JSON.stringify(program.data));
    const version = await api(`/api/v1/studios/${studioId}/training-programs/${program.data.trainingProgram.id}/versions`, {
        method: "POST", token: ownerAuth.token, body: {}
    });
    assert.equal(version.response.status, 201, JSON.stringify(version.data));
    const day = await api(
        `/api/v1/studios/${studioId}/training-programs/${program.data.trainingProgram.id}/versions/${version.data.programVersion.id}/days`,
        { method: "POST", token: ownerAuth.token, body: { name: dayName } }
    );
    assert.equal(day.response.status, 201, JSON.stringify(day.data));
    const exercise = await api(
        `/api/v1/studios/${studioId}/training-programs/${program.data.trainingProgram.id}/versions/${version.data.programVersion.id}/days/${day.data.programDay.id}/exercises`,
        { method: "POST", token: ownerAuth.token, body: { exerciseNameSnapshot: exerciseName, targetSets: 1, targetRepsMin: 5, targetRepsMax: 5 } }
    );
    assert.equal(exercise.response.status, 201, JSON.stringify(exercise.data));
    const published = await api(
        `/api/v1/studios/${studioId}/training-programs/${program.data.trainingProgram.id}/versions/${version.data.programVersion.id}/publish`,
        { method: "POST", token: ownerAuth.token }
    );
    assert.equal(published.response.status, 200, JSON.stringify(published.data));
    return { versionId: published.data.programVersion.id, dayId: day.data.programDay.id };
}

async function createAssignment(ownerAuth, studioId, versionId, memberMembershipId, relationshipId) {
    const result = await api(`/api/v1/studios/${studioId}/program-assignments`, {
        method: "POST", token: ownerAuth.token,
        body: { programVersionId: versionId, memberMembershipId, coachingRelationshipId: relationshipId }
    });
    assert.equal(result.response.status, 201, JSON.stringify(result.data));
    return result.data.programAssignment;
}

async function startSession(actor, studioId, assignmentId, dayId, clientStartKey) {
    const result = await api(`/api/v1/studios/${studioId}/program-assignments/${assignmentId}/workout-sessions`, {
        method: "POST", token: actor.token, body: { programDayId: dayId, clientStartKey }
    });
    assert.equal(result.response.status, 201, JSON.stringify(result.data));
    return result.data.workoutSession;
}

async function completeSessionFully(actor, studioId, session) {
    const exercise = session.exercises[0];
    const set = exercise.sets[0];
    const setUpdate = await api(
        `/api/v1/studios/${studioId}/workout-sessions/${session.id}/exercises/${exercise.id}/sets/${set.id}`,
        { method: "PATCH", token: actor.token, body: { status: "completed", actualReps: 5, expectedRevision: set.revision } }
    );
    assert.equal(setUpdate.response.status, 200, JSON.stringify(setUpdate.data));
    const exerciseUpdate = await api(
        `/api/v1/studios/${studioId}/workout-sessions/${session.id}/exercises/${exercise.id}`,
        { method: "PATCH", token: actor.token, body: { status: "completed", expectedRevision: exercise.revision } }
    );
    assert.equal(exerciseUpdate.response.status, 200, JSON.stringify(exerciseUpdate.data));
    const completed = await api(`/api/v1/studios/${studioId}/workout-sessions/${session.id}/complete`, {
        method: "POST", token: actor.token
    });
    assert.equal(completed.response.status, 200, JSON.stringify(completed.data));
    return completed.data.workoutSession;
}

async function abortSession(actor, studioId, sessionId) {
    const result = await api(`/api/v1/studios/${studioId}/workout-sessions/${sessionId}/abort`, {
        method: "POST", token: actor.token
    });
    assert.equal(result.response.status, 200, JSON.stringify(result.data));
    return result.data.workoutSession;
}

function listOwnCoachingRelationships(actor, studioId, query = {}) {
    const params = new URLSearchParams(query).toString();
    return api(`/api/v1/studios/${studioId}/coaching-relationships/me${params ? `?${params}` : ""}`, { token: actor.token });
}

function listCoachedSessions(actor, studioId, memberMembershipId, query = {}) {
    const params = new URLSearchParams(query).toString();
    return api(
        `/api/v1/studios/${studioId}/coached-members/${memberMembershipId}/workout-sessions${params ? `?${params}` : ""}`,
        { token: actor.token }
    );
}

function listFeedback(actor, studioId, sessionId, query = {}) {
    const params = new URLSearchParams(query).toString();
    return api(
        `/api/v1/studios/${studioId}/workout-sessions/${sessionId}/feedback${params ? `?${params}` : ""}`,
        { token: actor.token }
    );
}

function createFeedback(actor, studioId, sessionId, body) {
    return api(`/api/v1/studios/${studioId}/workout-sessions/${sessionId}/feedback`, {
        method: "POST", token: actor.token, body
    });
}

before(async () => {
    adminConnection = await mysql.createConnection(
        db.readDatabaseConfig(process.env, { includeDatabase: false })
    );
    await adminConnection.query(`CREATE DATABASE \`${TEST_DATABASE}\` CHARACTER SET utf8mb4`);
    const runner = createMigrationRunner({ pool: db, logger });
    await runner.migrate({ expectedDatabase: TEST_DATABASE });
    pool = db.promise();

    const app = createApp({ readiness: { check: async () => ({ ready: true }) }, logger });
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    for (const name of [
        "ownerA", "adminA", "trainer1A", "trainer2A", "member1A", "member2A", "member3A", "member4A",
        "ownerB", "trainerB", "memberB"
    ]) {
        accounts[name] = await registerAndLogin(name);
    }

    const createdA = await api("/api/v1/studios", {
        method: "POST", token: accounts.ownerA.token,
        body: {
            name: "Feedback Studio Alpha", slug: `feedback-alpha-${runId}`,
            defaultLocale: "de", defaultTimezone: "Europe/Zurich", defaultWeightUnit: "kg"
        }
    });
    assert.equal(createdA.response.status, 201, JSON.stringify(createdA.data));
    studioA = createdA.data.studio;
    membershipIds.ownerA = studioA.membership.id;

    const createdB = await api("/api/v1/studios", {
        method: "POST", token: accounts.ownerB.token,
        body: {
            name: "Feedback Studio Beta", slug: `feedback-beta-${runId}`,
            defaultLocale: "de", defaultTimezone: "Europe/Zurich", defaultWeightUnit: "kg"
        }
    });
    assert.equal(createdB.response.status, 201, JSON.stringify(createdB.data));
    studioB = createdB.data.studio;
    membershipIds.ownerB = studioB.membership.id;

    for (const [name, role] of [
        ["adminA", "admin"], ["trainer1A", "trainer"], ["trainer2A", "trainer"],
        ["member1A", "member"], ["member2A", "member"], ["member3A", "member"], ["member4A", "member"]
    ]) {
        const membership = await inviteAndAccept(accounts.ownerA, studioA.id, accounts[name], role);
        membershipIds[name] = membership.id;
    }
    for (const [name, role] of [["trainerB", "trainer"], ["memberB", "member"]]) {
        const membership = await inviteAndAccept(accounts.ownerB, studioB.id, accounts[name], role);
        membershipIds[name] = membership.id;
    }

    relationships.rel1 = await createRelationship(accounts.ownerA, studioA.id, membershipIds.trainer1A, membershipIds.member1A);
    relationships.rel2 = await createRelationship(accounts.ownerA, studioA.id, membershipIds.trainer2A, membershipIds.member2A);
    relationships.relOwner = await createRelationship(accounts.ownerA, studioA.id, membershipIds.ownerA, membershipIds.member3A);
    relationships.relAdmin = await createRelationship(accounts.ownerA, studioA.id, membershipIds.adminA, membershipIds.member4A);
    relationships.relB = await createRelationship(accounts.ownerB, studioB.id, membershipIds.trainerB, membershipIds.memberB);

    const programA = await setupStudioProgram(accounts.ownerA, studioA.id, "Tag 1: Ganzkörper", "Kniebeuge");
    const programB = await setupStudioProgram(accounts.ownerB, studioB.id, "Tag 1: Oberkörper", "Bankdrücken");

    const assignment1 = await createAssignment(accounts.ownerA, studioA.id, programA.versionId, membershipIds.member1A, relationships.rel1.id);
    const assignment2 = await createAssignment(accounts.ownerA, studioA.id, programA.versionId, membershipIds.member2A, relationships.rel2.id);
    const assignment3 = await createAssignment(accounts.ownerA, studioA.id, programA.versionId, membershipIds.member3A, relationships.relOwner.id);
    const assignment4 = await createAssignment(accounts.ownerA, studioA.id, programA.versionId, membershipIds.member4A, relationships.relAdmin.id);
    const assignmentB = await createAssignment(accounts.ownerB, studioB.id, programB.versionId, membershipIds.memberB, relationships.relB.id);

    const started1 = await startSession(accounts.member1A, studioA.id, assignment1.id, programA.dayId, "session1-key");
    sessions.session1 = await completeSessionFully(accounts.member1A, studioA.id, started1);
    sessions.sessionRunning = await startSession(accounts.member1A, studioA.id, assignment1.id, programA.dayId, "session-running-key");

    const started2 = await startSession(accounts.member2A, studioA.id, assignment2.id, programA.dayId, "session2-key");
    sessions.session2 = await abortSession(accounts.member2A, studioA.id, started2.id);

    const started3 = await startSession(accounts.member3A, studioA.id, assignment3.id, programA.dayId, "session3-key");
    sessions.session3 = await completeSessionFully(accounts.member3A, studioA.id, started3);

    const started4 = await startSession(accounts.member4A, studioA.id, assignment4.id, programA.dayId, "session4-key");
    sessions.session4 = await completeSessionFully(accounts.member4A, studioA.id, started4);

    const startedB = await startSession(accounts.memberB, studioB.id, assignmentB.id, programB.dayId, "sessionB-key");
    sessions.sessionB = await completeSessionFully(accounts.memberB, studioB.id, startedB);
});

after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.closePool(db);
    if (adminConnection) {
        assert.match(TEST_DATABASE, /^fittrack_api_test_feedback_[A-Za-z0-9_]+$/);
        await adminConnection.query(`DROP DATABASE IF EXISTS \`${TEST_DATABASE}\``);
        await adminConnection.end();
    }
});

// ---- 6: own coaching relationships (never a studio-wide bypass for owner/admin) ----

test("a trainer's own-relationships list contains only their own coaching relationship", async () => {
    const result = await listOwnCoachingRelationships(accounts.trainer1A, studioA.id);
    assert.equal(result.response.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.coachingRelationships.length, 1);
    assert.equal(result.data.coachingRelationships[0].id, relationships.rel1.id);
    assert.equal(result.data.coachingRelationships[0].member.membershipId, membershipIds.member1A);
});

test("owner and admin also see only their own relationship via /me, never every relationship in the studio", async () => {
    const ownerResult = await listOwnCoachingRelationships(accounts.ownerA, studioA.id);
    assert.equal(ownerResult.response.status, 200, JSON.stringify(ownerResult.data));
    assert.equal(ownerResult.data.coachingRelationships.length, 1);
    assert.equal(ownerResult.data.coachingRelationships[0].id, relationships.relOwner.id);

    const adminResult = await listOwnCoachingRelationships(accounts.adminA, studioA.id);
    assert.equal(adminResult.response.status, 200, JSON.stringify(adminResult.data));
    assert.equal(adminResult.data.coachingRelationships.length, 1);
    assert.equal(adminResult.data.coachingRelationships[0].id, relationships.relAdmin.id);
});

test("own-relationships uses bounded pagination and rejects an unknown query parameter", async () => {
    const paged = await listOwnCoachingRelationships(accounts.trainer1A, studioA.id, { page: "1", limit: "1" });
    assert.equal(paged.response.status, 200, JSON.stringify(paged.data));
    assert.equal(paged.data.pagination.limit, 1);

    const badParam = await listOwnCoachingRelationships(accounts.trainer1A, studioA.id, { scope: "all" });
    assert.equal(badParam.response.status, 400, JSON.stringify(badParam.data));
});

// ---- 7: coach session list, status filter, tenant isolation ----

test("a trainer lists only their own coached member's sessions, filterable by status, applied before pagination", async () => {
    const all = await listCoachedSessions(accounts.trainer1A, studioA.id, membershipIds.member1A);
    assert.equal(all.response.status, 200, JSON.stringify(all.data));
    const ids = all.data.workoutSessions.map((s) => s.id);
    assert.ok(ids.includes(sessions.session1.id));
    assert.ok(ids.includes(sessions.sessionRunning.id));

    const completedOnly = await listCoachedSessions(accounts.trainer1A, studioA.id, membershipIds.member1A, { status: "completed" });
    assert.deepEqual(completedOnly.data.workoutSessions.map((s) => s.id), [sessions.session1.id]);

    const runningOnly = await listCoachedSessions(accounts.trainer1A, studioA.id, membershipIds.member1A, { status: "in_progress" });
    assert.deepEqual(runningOnly.data.workoutSessions.map((s) => s.id), [sessions.sessionRunning.id]);
});

test("trainer 2 cannot list or read member 1's sessions; owner/admin without their own relationship get the same not-found", async () => {
    for (const [label, actor] of [
        ["a different trainer with no relationship to this member", accounts.trainer2A],
        ["the owner without their own relationship to this member", accounts.ownerA],
        ["an admin without their own relationship to this member", accounts.adminA]
    ]) {
        const list = await listCoachedSessions(actor, studioA.id, membershipIds.member1A);
        assert.equal(list.response.status, 404, `${label} list must be denied: ${JSON.stringify(list.data)}`);
        assert.equal(list.data.error.code, "WORKOUT_SESSION_NOT_FOUND");
    }
});

test("owner with their own relationship and admin with their own relationship can read their coached member's session", async () => {
    const ownerList = await listCoachedSessions(accounts.ownerA, studioA.id, membershipIds.member3A);
    assert.equal(ownerList.response.status, 200, JSON.stringify(ownerList.data));
    assert.ok(ownerList.data.workoutSessions.some((s) => s.id === sessions.session3.id));

    const adminList = await listCoachedSessions(accounts.adminA, studioA.id, membershipIds.member4A);
    assert.equal(adminList.response.status, 200, JSON.stringify(adminList.data));
    assert.ok(adminList.data.workoutSessions.some((s) => s.id === sessions.session4.id));
});

test("a foreign studio's trainer gets a uniform not-found for a coached member list in studio A", async () => {
    const result = await listCoachedSessions(accounts.trainerB, studioA.id, membershipIds.member1A);
    assert.equal(result.response.status, 404);
    assert.equal(result.data.error.code, "STUDIO_NOT_FOUND");
});

// ---- feedback: creation eligibility, terminal-session requirement ----

test("the authorized coach can add feedback to a completed session", async () => {
    const result = await createFeedback(accounts.trainer1A, studioA.id, sessions.session1.id, {
        clientFeedbackKey: crypto.randomUUID(),
        body: "Solid squat depth today, keep the tempo controlled."
    });
    assert.equal(result.response.status, 201, JSON.stringify(result.data));
    assert.equal(result.data.workoutSessionFeedback.body, "Solid squat depth today, keep the tempo controlled.");
    assert.equal(result.data.workoutSessionFeedback.coach.membershipId, membershipIds.trainer1A);
    assert.ok(result.data.workoutSessionFeedback.createdAt);
    assert.equal(Object.hasOwn(result.data.workoutSessionFeedback, "id"), true);
});

test("the authorized coach can add feedback to an aborted session", async () => {
    const result = await createFeedback(accounts.trainer2A, studioA.id, sessions.session2.id, {
        clientFeedbackKey: crypto.randomUUID(),
        body: "No worries about stopping early, rest up and we'll try again."
    });
    assert.equal(result.response.status, 201, JSON.stringify(result.data));
});

test("feedback on an in_progress session is rejected with a stable, non-terminal-specific conflict code", async () => {
    const result = await createFeedback(accounts.trainer1A, studioA.id, sessions.sessionRunning.id, {
        clientFeedbackKey: crypto.randomUUID(),
        body: "Too early for feedback."
    });
    assert.equal(result.response.status, 409, JSON.stringify(result.data));
    assert.equal(result.data.error.code, "WORKOUT_FEEDBACK_SESSION_NOT_TERMINAL");
});

test("owner/admin with their own relationship can create feedback; without one, they cannot, no bypass", async () => {
    const ownerOwn = await createFeedback(accounts.ownerA, studioA.id, sessions.session3.id, {
        clientFeedbackKey: crypto.randomUUID(), body: "Great consistency this week."
    });
    assert.equal(ownerOwn.response.status, 201, JSON.stringify(ownerOwn.data));

    const adminOwn = await createFeedback(accounts.adminA, studioA.id, sessions.session4.id, {
        clientFeedbackKey: crypto.randomUUID(), body: "Nice work on form."
    });
    assert.equal(adminOwn.response.status, 201, JSON.stringify(adminOwn.data));

    const ownerForeign = await createFeedback(accounts.ownerA, studioA.id, sessions.session1.id, {
        clientFeedbackKey: crypto.randomUUID(), body: "Owner has no relationship with member1A."
    });
    assert.equal(ownerForeign.response.status, 404, JSON.stringify(ownerForeign.data));
    assert.equal(ownerForeign.data.error.code, "WORKOUT_SESSION_NOT_FOUND");

    const adminForeign = await createFeedback(accounts.adminA, studioA.id, sessions.session2.id, {
        clientFeedbackKey: crypto.randomUUID(), body: "Admin has no relationship with member2A."
    });
    assert.equal(adminForeign.response.status, 404, JSON.stringify(adminForeign.data));
    assert.equal(adminForeign.data.error.code, "WORKOUT_SESSION_NOT_FOUND");
});

test("a member can never create feedback, even on their own session", async () => {
    const result = await createFeedback(accounts.member1A, studioA.id, sessions.session1.id, {
        clientFeedbackKey: crypto.randomUUID(), body: "I'll give myself feedback."
    });
    assert.equal(result.response.status, 403, JSON.stringify(result.data));
    assert.equal(result.data.error.code, "INSUFFICIENT_STUDIO_ROLE");
});

// ---- idempotency and conflict ----

test("a retried create with the same clientFeedbackKey and body returns the exact same entry, never a duplicate", async () => {
    const key = crypto.randomUUID();
    const first = await createFeedback(accounts.trainer1A, studioA.id, sessions.session1.id, {
        clientFeedbackKey: key, body: "Idempotency check."
    });
    assert.equal(first.response.status, 201, JSON.stringify(first.data));

    const retry = await createFeedback(accounts.trainer1A, studioA.id, sessions.session1.id, {
        clientFeedbackKey: key, body: "Idempotency check."
    });
    assert.equal(retry.response.status, 201, JSON.stringify(retry.data));
    assert.equal(retry.data.workoutSessionFeedback.id, first.data.workoutSessionFeedback.id);

    const list = await listFeedback(accounts.trainer1A, studioA.id, sessions.session1.id);
    const matching = list.data.workoutSessionFeedback.filter((item) => item.id === first.data.workoutSessionFeedback.id);
    assert.equal(matching.length, 1, "a retried identical request must never create a second row");
});

test("the same clientFeedbackKey with a different body is a safe conflict, not a silent overwrite or a new entry", async () => {
    const key = crypto.randomUUID();
    const first = await createFeedback(accounts.trainer1A, studioA.id, sessions.session1.id, {
        clientFeedbackKey: key, body: "Original text."
    });
    assert.equal(first.response.status, 201, JSON.stringify(first.data));

    const conflicting = await createFeedback(accounts.trainer1A, studioA.id, sessions.session1.id, {
        clientFeedbackKey: key, body: "Different text."
    });
    assert.equal(conflicting.response.status, 409, JSON.stringify(conflicting.data));
    assert.equal(conflicting.data.error.code, "WORKOUT_FEEDBACK_KEY_CONFLICT");

    const list = await listFeedback(accounts.trainer1A, studioA.id, sessions.session1.id);
    const entry = list.data.workoutSessionFeedback.find((item) => item.id === first.data.workoutSessionFeedback.id);
    assert.equal(entry.body, "Original text.", "the conflicting request must never overwrite the original entry");
});

test("feedback is append-only: there is no update or delete route for it", async () => {
    const list = await listFeedback(accounts.trainer1A, studioA.id, sessions.session1.id);
    const feedbackId = list.data.workoutSessionFeedback[0].id;
    const patchAttempt = await api(`/api/v1/studios/${studioA.id}/workout-sessions/${sessions.session1.id}/feedback/${feedbackId}`, {
        method: "PATCH", token: accounts.trainer1A.token, body: { body: "edited" }
    });
    assert.equal(patchAttempt.response.status, 404, "no PATCH route exists for a feedback entry");
    const deleteAttempt = await api(`/api/v1/studios/${studioA.id}/workout-sessions/${sessions.session1.id}/feedback/${feedbackId}`, {
        method: "DELETE", token: accounts.trainer1A.token
    });
    assert.equal(deleteAttempt.response.status, 404, "no DELETE route exists for a feedback entry");
});

// ---- reading feedback: member-own, coach, and denial paths ----

test("the member reads every feedback entry on their own session, with the authoring coach's display name", async () => {
    const result = await listFeedback(accounts.member1A, studioA.id, sessions.session1.id);
    assert.equal(result.response.status, 200, JSON.stringify(result.data));
    assert.ok(result.data.workoutSessionFeedback.length >= 1);
    assert.ok(result.data.workoutSessionFeedback.every((item) => typeof item.body === "string" && item.body.length > 0));
    assert.ok(result.data.workoutSessionFeedback.every((item) => item.coach.displayName));
});

test("a different member cannot read another member's session feedback", async () => {
    const result = await listFeedback(accounts.member2A, studioA.id, sessions.session1.id);
    assert.equal(result.response.status, 404);
    assert.equal(result.data.error.code, "WORKOUT_SESSION_NOT_FOUND");
});

test("a different coach cannot read a session's feedback outside their own relationship", async () => {
    const result = await listFeedback(accounts.trainer2A, studioA.id, sessions.session1.id);
    assert.equal(result.response.status, 404);
    assert.equal(result.data.error.code, "WORKOUT_SESSION_NOT_FOUND");
});

test("owner/admin without their own relationship cannot read feedback either", async () => {
    const ownerResult = await listFeedback(accounts.ownerA, studioA.id, sessions.session1.id);
    assert.equal(ownerResult.response.status, 404);
    const adminResult = await listFeedback(accounts.adminA, studioA.id, sessions.session2.id);
    assert.equal(adminResult.response.status, 404);
});

test("feedback pagination is bounded and chronologically stable", async () => {
    const result = await listFeedback(accounts.trainer1A, studioA.id, sessions.session1.id, { page: "1", limit: "1" });
    assert.equal(result.response.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.workoutSessionFeedback.length, 1);
    assert.ok(result.data.pagination.total >= 3, "at least the three feedback entries created above must be counted");
});

// ---- relationship end: immediate coach lockout, member keeps feedback, new coach sees nothing old ----

test("ending the coaching relationship immediately revokes the coach's session, list, and feedback access", async () => {
    await endRelationship(accounts.ownerA, studioA.id, relationships.rel1.id);

    const list = await listCoachedSessions(accounts.trainer1A, studioA.id, membershipIds.member1A);
    assert.equal(list.response.status, 404);

    const detail = await api(
        `/api/v1/studios/${studioA.id}/coached-members/${membershipIds.member1A}/workout-sessions/${sessions.session1.id}`,
        { token: accounts.trainer1A.token }
    );
    assert.equal(detail.response.status, 404);

    const feedbackRead = await listFeedback(accounts.trainer1A, studioA.id, sessions.session1.id);
    assert.equal(feedbackRead.response.status, 404);

    const feedbackCreate = await createFeedback(accounts.trainer1A, studioA.id, sessions.session1.id, {
        clientFeedbackKey: crypto.randomUUID(), body: "Too late, relationship ended."
    });
    assert.equal(feedbackCreate.response.status, 404);
});

test("the member keeps their own session and every feedback entry after the coaching relationship ends", async () => {
    const sessionRead = await api(`/api/v1/studios/${studioA.id}/workout-sessions/${sessions.session1.id}`, {
        token: accounts.member1A.token
    });
    assert.equal(sessionRead.response.status, 200, JSON.stringify(sessionRead.data));

    const feedbackRead = await listFeedback(accounts.member1A, studioA.id, sessions.session1.id);
    assert.equal(feedbackRead.response.status, 200, JSON.stringify(feedbackRead.data));
    assert.ok(feedbackRead.data.workoutSessionFeedback.length >= 3, "feedback given before the relationship ended must not be deleted");
});

test("a new coach for the same member gains no automatic access to a session from the earlier, now-ended relationship", async () => {
    const newRelationship = await createRelationship(accounts.ownerA, studioA.id, membershipIds.trainer2A, membershipIds.member1A);
    try {
        const list = await listCoachedSessions(accounts.trainer2A, studioA.id, membershipIds.member1A);
        assert.equal(list.response.status, 200, JSON.stringify(list.data));
        assert.equal(
            list.data.workoutSessions.some((s) => s.id === sessions.session1.id),
            false,
            "a session recorded under the previous (now-ended) relationship must not appear for the new coach"
        );

        const detail = await api(
            `/api/v1/studios/${studioA.id}/coached-members/${membershipIds.member1A}/workout-sessions/${sessions.session1.id}`,
            { token: accounts.trainer2A.token }
        );
        assert.equal(detail.response.status, 404, JSON.stringify(detail.data));

        const feedbackRead = await listFeedback(accounts.trainer2A, studioA.id, sessions.session1.id);
        assert.equal(feedbackRead.response.status, 404, JSON.stringify(feedbackRead.data));
    } finally {
        await endRelationship(accounts.ownerA, studioA.id, newRelationship.id);
    }
});

// ---- cross-studio isolation ----

test("studio B stays fully isolated: no cross-studio session, feedback, or relationship access in either direction", async () => {
    const crossList = await listCoachedSessions(accounts.trainerB, studioA.id, membershipIds.member3A);
    assert.equal(crossList.response.status, 404);
    assert.equal(crossList.data.error.code, "STUDIO_NOT_FOUND");

    const crossFeedback = await listFeedback(accounts.trainerB, studioB.id, sessions.session1.id);
    assert.equal(crossFeedback.response.status, 404);

    const ownB = await listOwnCoachingRelationships(accounts.trainerB, studioB.id);
    assert.equal(ownB.response.status, 200, JSON.stringify(ownB.data));
    assert.equal(ownB.data.coachingRelationships.length, 1);
    assert.equal(ownB.data.coachingRelationships[0].id, relationships.relB.id);
});

test("personal workouts remain fully unaffected by any of the above", async () => {
    const exercises = await api("/api/exercises", { token: accounts.member1A.token });
    assert.equal(exercises.response.status, 200);
    const exercise = exercises.data.find((item) => item.category !== "Cardio");

    const personalWorkout = await api("/api/workouts", {
        method: "POST", token: accounts.member1A.token,
        body: {
            title: "Private session", workout_date: "2026-01-10",
            exercises: [{ exercise_id: exercise.id, sets: 3, reps: 8, weight: 40 }]
        }
    });
    assert.equal(personalWorkout.response.status, 201, JSON.stringify(personalWorkout.data));

    const coachWorkouts = await api("/api/workouts", { token: accounts.trainer1A.token });
    assert.equal(coachWorkouts.response.status, 200);
    assert.equal(coachWorkouts.data.some((w) => w.title === "Private session"), false);
});

// ---- audit and logging: feedback text never leaks ----

test("the feedback audit trail records only public feedback/session identifiers, never the feedback text", async () => {
    const [rows] = await pool.query(
        `SELECT event_type, details_json
         FROM studio_audit_events sae
         INNER JOIN studios s ON s.id = sae.studio_id
         WHERE s.public_id = ? AND sae.event_type = 'workout_feedback.created'
         ORDER BY sae.id ASC`,
        [studioA.id]
    );
    assert.ok(rows.length >= 3, "every successful feedback creation above must have produced exactly one audit row");

    for (const row of rows) {
        assert.deepEqual(Object.keys(row.details_json).sort(), ["feedbackId", "sessionId"]);
    }

    const serialized = JSON.stringify(rows.map((row) => row.details_json));
    for (const forbidden of [
        "Solid squat depth", "Idempotency check", "Original text", "Great consistency",
        "weight", "reps", "rpe", "body", "note", "password", "token"
    ]) {
        assert.equal(
            serialized.toLowerCase().includes(forbidden.toLowerCase()),
            false,
            `audit details must never contain "${forbidden}"`
        );
    }
});

// ---- own-relationships status filter, checked last since rel1 is already ended above and
// nothing further in this file depends on trainer1A's relationship still being active ----

test("own-relationships defaults to status=active and supports an explicit ended filter", async () => {
    const trainer1Active = await listOwnCoachingRelationships(accounts.trainer1A, studioA.id);
    assert.equal(trainer1Active.response.status, 200, JSON.stringify(trainer1Active.data));
    assert.equal(trainer1Active.data.coachingRelationships.length, 0, "rel1 was already ended earlier in this suite");

    const trainer1Ended = await listOwnCoachingRelationships(accounts.trainer1A, studioA.id, { status: "ended" });
    assert.equal(trainer1Ended.response.status, 200, JSON.stringify(trainer1Ended.data));
    assert.equal(trainer1Ended.data.coachingRelationships.length, 1);
    assert.equal(trainer1Ended.data.coachingRelationships[0].id, relationships.rel1.id);
    assert.equal(trainer1Ended.data.coachingRelationships[0].status, "ended");
});
