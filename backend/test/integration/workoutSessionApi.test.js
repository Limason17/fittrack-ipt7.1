const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mysql = require("mysql2/promise");

const TEST_DATABASE = `fittrack_api_test_workout_${process.pid}_${Date.now()}`;
if (!/^fittrack_api_test_workout_[A-Za-z0-9_]+$/.test(TEST_DATABASE)) {
    throw new Error("Refusing to use an unsafe workout API test database name.");
}

process.env.NODE_ENV = "test";
process.env.DB_NAME = TEST_DATABASE;
process.env.JWT_SECRET = "fittrack-stage-1b2b1-test-secret-with-at-least-32-characters";
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
let rel1;
let rel2;
let rel3;
let programAId;
let versionA1;
let dayA1;
let assignment1;
let assignment1b;
let assignment2;
let assignment3;
let assignment4;
let sessionId1;
let sessionId2;

function fixture(name) {
    return {
        username: `stage1b2b1-${name}-${runId}`,
        email: `stage1b2b1-${name}-${runId}@example.test`,
        password: "correct horse battery staple stage1b2b1"
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
    assert.equal(typeof url, "string");
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

async function setMembershipStatus(actor, studioId, membershipId, status) {
    const result = await api(`/api/v1/studios/${studioId}/memberships/${membershipId}`, {
        method: "PATCH", token: actor.token, body: { status }
    });
    assert.equal(result.response.status, 200, JSON.stringify(result.data));
    return result.data.membership;
}

async function startSession(actor, assignmentId, { programDayId, clientStartKey }) {
    return api(`/api/v1/studios/${studioA.id}/program-assignments/${assignmentId}/workout-sessions`, {
        method: "POST",
        token: actor.token,
        body: { programDayId, clientStartKey }
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
        "ownerA", "adminA", "trainer1A", "trainer2A", "member1A", "member2A", "member3A",
        "ownerB", "trainerB", "memberB"
    ]) {
        accounts[name] = await registerAndLogin(name);
    }

    const createdA = await api("/api/v1/studios", {
        method: "POST",
        token: accounts.ownerA.token,
        body: {
            name: "Stage 1B.2B1 Alpha",
            slug: `stage1b2b1-alpha-${runId}`,
            defaultLocale: "de",
            defaultTimezone: "Europe/Zurich",
            defaultWeightUnit: "kg"
        }
    });
    assert.equal(createdA.response.status, 201, JSON.stringify(createdA.data));
    studioA = createdA.data.studio;
    membershipIds.ownerA = studioA.membership.id;

    const createdB = await api("/api/v1/studios", {
        method: "POST",
        token: accounts.ownerB.token,
        body: {
            name: "Stage 1B.2B1 Beta",
            slug: `stage1b2b1-beta-${runId}`,
            defaultLocale: "de",
            defaultTimezone: "Europe/Zurich",
            defaultWeightUnit: "kg"
        }
    });
    assert.equal(createdB.response.status, 201, JSON.stringify(createdB.data));
    studioB = createdB.data.studio;
    membershipIds.ownerB = studioB.membership.id;

    for (const [name, role] of [
        ["adminA", "admin"],
        ["trainer1A", "trainer"],
        ["trainer2A", "trainer"],
        ["member1A", "member"],
        ["member2A", "member"],
        ["member3A", "member"]
    ]) {
        const membership = await inviteAndAccept(accounts.ownerA, studioA.id, accounts[name], role);
        membershipIds[name] = membership.id;
    }
    for (const [name, role] of [["trainerB", "trainer"], ["memberB", "member"]]) {
        const membership = await inviteAndAccept(accounts.ownerB, studioB.id, accounts[name], role);
        membershipIds[name] = membership.id;
    }

    rel1 = await createRelationship(accounts.ownerA, studioA.id, membershipIds.trainer1A, membershipIds.member1A);
    rel2 = await createRelationship(accounts.ownerA, studioA.id, membershipIds.trainer2A, membershipIds.member2A);
    rel3 = await createRelationship(accounts.ownerA, studioA.id, membershipIds.trainer1A, membershipIds.member3A);

    const program = await api(`/api/v1/studios/${studioA.id}/training-programs`, {
        method: "POST", token: accounts.trainer1A.token,
        body: { name: "Stage 1B.2B1 Program" }
    });
    assert.equal(program.response.status, 201, JSON.stringify(program.data));
    const programId = program.data.trainingProgram.id;
    programAId = programId;

    const version = await api(`/api/v1/studios/${studioA.id}/training-programs/${programId}/versions`, {
        method: "POST", token: accounts.trainer1A.token, body: {}
    });
    assert.equal(version.response.status, 201, JSON.stringify(version.data));
    versionA1 = version.data.programVersion;

    const day = await api(
        `/api/v1/studios/${studioA.id}/training-programs/${programId}/versions/${versionA1.id}/days`,
        { method: "POST", token: accounts.trainer1A.token, body: { name: "Day 1: Push" } }
    );
    assert.equal(day.response.status, 201, JSON.stringify(day.data));
    dayA1 = day.data.programDay;

    const exercise = await api(
        `/api/v1/studios/${studioA.id}/training-programs/${programId}/versions/${versionA1.id}/days/${dayA1.id}/exercises`,
        {
            method: "POST", token: accounts.trainer1A.token,
            body: { exerciseNameSnapshot: "Bench Press", targetSets: 2, targetRepsMin: 6, targetRepsMax: 8 }
        }
    );
    assert.equal(exercise.response.status, 201, JSON.stringify(exercise.data));

    const published = await api(
        `/api/v1/studios/${studioA.id}/training-programs/${programId}/versions/${versionA1.id}/publish`,
        { method: "POST", token: accounts.trainer1A.token }
    );
    assert.equal(published.response.status, 200, JSON.stringify(published.data));
    versionA1 = published.data.programVersion;

    async function createAssignment(actor, memberMembershipId, coachingRelationshipId, overrides = {}) {
        const result = await api(`/api/v1/studios/${studioA.id}/program-assignments`, {
            method: "POST", token: actor.token,
            body: { programVersionId: versionA1.id, memberMembershipId, coachingRelationshipId, ...overrides }
        });
        assert.equal(result.response.status, 201, JSON.stringify(result.data));
        return result.data.programAssignment;
    }

    assignment1 = await createAssignment(accounts.trainer1A, membershipIds.member1A, rel1.id);
    assignment1b = await createAssignment(accounts.trainer1A, membershipIds.member1A, rel1.id);
    assignment2 = await createAssignment(accounts.trainer2A, membershipIds.member2A, rel2.id);
    assignment3 = await createAssignment(
        accounts.trainer1A, membershipIds.member3A, rel3.id, { startsOn: "2099-01-01" }
    );
    assignment4 = await createAssignment(accounts.trainer1A, membershipIds.member3A, rel3.id);
});

after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.closePool(db);
    if (adminConnection) {
        assert.match(TEST_DATABASE, /^fittrack_api_test_workout_[A-Za-z0-9_]+$/);
        await adminConnection.query(`DROP DATABASE IF EXISTS \`${TEST_DATABASE}\``);
        await adminConnection.end();
    }
});

test("a member starts a workout session from an active assignment; the snapshot matches the published version exactly", async () => {
    const started1 = await startSession(
        accounts.member1A, assignment1.id, { programDayId: dayA1.id, clientStartKey: "device-1" }
    );
    assert.equal(started1.response.status, 201, JSON.stringify(started1.data));
    sessionId1 = started1.data.workoutSession.id;
    assert.equal(started1.data.workoutSession.assignmentId, assignment1.id);
    assert.equal(started1.data.workoutSession.status, "in_progress");
    assert.equal(started1.data.workoutSession.revision, 0);
    assert.equal(started1.data.workoutSession.exercises.length, 1);
    const exercise1 = started1.data.workoutSession.exercises[0];
    assert.equal(exercise1.exerciseNameSnapshot, "Bench Press");
    assert.equal(exercise1.targetSets, 2);
    assert.equal(exercise1.status, "pending");
    assert.equal(exercise1.revision, 0);
    assert.equal(exercise1.sets.length, 2);
    assert.ok(exercise1.sets.every((set) => set.status === "pending" && set.revision === 0 && set.actualReps === null));
    assert.equal(
        Object.hasOwn(started1.data.workoutSession, "member"),
        false,
        "a member's own session view must not repeat their own membership identity"
    );

    const started2 = await startSession(
        accounts.member1A, assignment1b.id, { programDayId: dayA1.id, clientStartKey: "device-2" }
    );
    assert.equal(started2.response.status, 201, JSON.stringify(started2.data));
    sessionId2 = started2.data.workoutSession.id;
    assert.equal(started2.data.workoutSession.assignmentId, assignment1b.id);
    assert.notEqual(sessionId2, sessionId1);
});

test("an incomplete session cannot be completed", async () => {
    const attempt = await api(`/api/v1/studios/${studioA.id}/workout-sessions/${sessionId2}/complete`, {
        method: "POST", token: accounts.member1A.token
    });
    assert.equal(attempt.response.status, 409, JSON.stringify(attempt.data));
    assert.equal(attempt.data.error.code, "WORKOUT_SESSION_INCOMPLETE");
});

test("starting again with the same assignment and idempotency key returns the existing session unchanged", async () => {
    const replay = await startSession(
        accounts.member1A, assignment1.id, { programDayId: dayA1.id, clientStartKey: "device-1" }
    );
    assert.equal(replay.response.status, 201, JSON.stringify(replay.data));
    assert.equal(replay.data.workoutSession.id, sessionId1);
});

test("reusing the same idempotency key against a different assignment is rejected, not silently accepted", async () => {
    const conflict = await startSession(
        accounts.member1A, assignment1b.id, { programDayId: dayA1.id, clientStartKey: "device-1" }
    );
    assert.equal(conflict.response.status, 409, JSON.stringify(conflict.data));
    assert.equal(conflict.data.error.code, "WORKOUT_START_KEY_CONFLICT");
});

test("a day from a different program version cannot start a session, and a later version never alters an already-started one", async () => {
    const programId = programAId;
    const version2 = await api(
        `/api/v1/studios/${studioA.id}/training-programs/${programId}/versions`,
        { method: "POST", token: accounts.trainer1A.token, body: {} }
    );
    assert.equal(version2.response.status, 201, JSON.stringify(version2.data));
    const day2 = await api(
        `/api/v1/studios/${studioA.id}/training-programs/${programId}/versions/${version2.data.programVersion.id}/days`,
        { method: "POST", token: accounts.trainer1A.token, body: { name: "Day 1: Legs" } }
    );
    assert.equal(day2.response.status, 201, JSON.stringify(day2.data));
    await api(
        `/api/v1/studios/${studioA.id}/training-programs/${programId}/versions/${version2.data.programVersion.id}/days/${day2.data.programDay.id}/exercises`,
        { method: "POST", token: accounts.trainer1A.token, body: { exerciseNameSnapshot: "Squat", targetSets: 3 } }
    );
    const published2 = await api(
        `/api/v1/studios/${studioA.id}/training-programs/${programId}/versions/${version2.data.programVersion.id}/publish`,
        { method: "POST", token: accounts.trainer1A.token }
    );
    assert.equal(published2.response.status, 200, JSON.stringify(published2.data));

    const wrongVersionDay = await startSession(
        accounts.member1A, assignment1.id,
        { programDayId: day2.data.programDay.id, clientStartKey: "device-wrong-version" }
    );
    assert.equal(wrongVersionDay.response.status, 409, JSON.stringify(wrongVersionDay.data));
    assert.equal(wrongVersionDay.data.error.code, "WORKOUT_DAY_NOT_AVAILABLE");

    const reread = await api(`/api/v1/studios/${studioA.id}/workout-sessions/${sessionId1}`, {
        token: accounts.member1A.token
    });
    assert.equal(reread.response.status, 200);
    assert.equal(reread.data.workoutSession.exercises.length, 1);
    assert.equal(reread.data.workoutSession.exercises[0].exerciseNameSnapshot, "Bench Press");
    assert.equal(
        reread.data.workoutSession.exercises[0].targetSets, 2,
        "publishing a second program version must never retroactively alter an already-started session's snapshot"
    );
});

test("a member cannot start a session on another member's assignment; a foreign studio member is told the studio itself doesn't exist", async () => {
    const wrongMember = await startSession(
        accounts.member2A, assignment1.id, { programDayId: dayA1.id, clientStartKey: "device-wrong-member" }
    );
    assert.equal(wrongMember.response.status, 409, JSON.stringify(wrongMember.data));
    assert.equal(wrongMember.data.error.code, "WORKOUT_ASSIGNMENT_NOT_AVAILABLE");

    const foreignStudio = await startSession(
        accounts.memberB, assignment1.id, { programDayId: dayA1.id, clientStartKey: "device-foreign" }
    );
    assert.equal(foreignStudio.response.status, 404, JSON.stringify(foreignStudio.data));
    assert.equal(foreignStudio.data.error.code, "STUDIO_NOT_FOUND");
});

test("a cancelled assignment can no longer start a workout session", async () => {
    const cancelled = await api(`/api/v1/studios/${studioA.id}/program-assignments/${assignment2.id}`, {
        method: "PATCH", token: accounts.trainer2A.token, body: { status: "cancelled" }
    });
    assert.equal(cancelled.response.status, 200, JSON.stringify(cancelled.data));

    const attempt = await startSession(
        accounts.member2A, assignment2.id, { programDayId: dayA1.id, clientStartKey: "device-cancelled" }
    );
    assert.equal(attempt.response.status, 409, JSON.stringify(attempt.data));
    assert.equal(attempt.data.error.code, "WORKOUT_ASSIGNMENT_NOT_AVAILABLE");
});

test("an assignment that has not started yet cannot start a workout session", async () => {
    const tooEarly = await startSession(
        accounts.member3A, assignment3.id, { programDayId: dayA1.id, clientStartKey: "device-too-early" }
    );
    assert.equal(tooEarly.response.status, 409, JSON.stringify(tooEarly.data));
    assert.equal(tooEarly.data.error.code, "WORKOUT_ASSIGNMENT_NOT_AVAILABLE");
});

test("ending the coaching relationship blocks starting any new session, even while the assignment itself stays active", async () => {
    await endRelationship(accounts.ownerA, studioA.id, rel3.id);

    const attempt = await startSession(
        accounts.member3A, assignment4.id, { programDayId: dayA1.id, clientStartKey: "device-ended-relationship" }
    );
    assert.equal(attempt.response.status, 409, JSON.stringify(attempt.data));
    assert.equal(attempt.data.error.code, "WORKOUT_ASSIGNMENT_NOT_AVAILABLE");
});

test("a member reads their own in-progress session; a different member gets a uniform not-found, never a 403", async () => {
    const list = await api(`/api/v1/studios/${studioA.id}/workout-sessions/me`, { token: accounts.member1A.token });
    assert.equal(list.response.status, 200, JSON.stringify(list.data));
    assert.ok(list.data.workoutSessions.some((session) => session.id === sessionId1));
    assert.equal(
        list.data.workoutSessions.find((session) => session.id === sessionId1).assignmentId, assignment1.id,
        "the assignment id must be resolvable from the list view so the frontend can distinguish sessions across assignments of the same program"
    );

    const own = await api(`/api/v1/studios/${studioA.id}/workout-sessions/${sessionId1}`, {
        token: accounts.member1A.token
    });
    assert.equal(own.response.status, 200);
    assert.equal(own.data.workoutSession.assignmentId, assignment1.id);

    const foreign = await api(`/api/v1/studios/${studioA.id}/workout-sessions/${sessionId1}`, {
        token: accounts.member2A.token
    });
    assert.equal(foreign.response.status, 404, JSON.stringify(foreign.data));
    assert.equal(foreign.data.error.code, "WORKOUT_SESSION_NOT_FOUND");
});

test("a coach with an active relationship reads the member's sessions; a different coach, a foreign studio trainer, and the owner/admin without a relationship all get the same not-found", async () => {
    const list = await api(
        `/api/v1/studios/${studioA.id}/coached-members/${membershipIds.member1A}/workout-sessions`,
        { token: accounts.trainer1A.token }
    );
    assert.equal(list.response.status, 200, JSON.stringify(list.data));
    assert.ok(list.data.workoutSessions.some((session) => session.id === sessionId1));
    assert.equal(
        list.data.workoutSessions[0].member.membershipId, membershipIds.member1A,
        "a coach's view of a member's session must identify the member"
    );

    const detail = await api(
        `/api/v1/studios/${studioA.id}/coached-members/${membershipIds.member1A}/workout-sessions/${sessionId1}`,
        { token: accounts.trainer1A.token }
    );
    assert.equal(detail.response.status, 200, JSON.stringify(detail.data));
    assert.equal(detail.data.workoutSession.member.membershipId, membershipIds.member1A);

    for (const [label, actor] of [
        ["a different coach with no relationship to this member", accounts.trainer2A],
        ["the studio owner without their own coaching relationship", accounts.ownerA],
        ["a studio admin without their own coaching relationship", accounts.adminA]
    ]) {
        const attempt = await api(
            `/api/v1/studios/${studioA.id}/coached-members/${membershipIds.member1A}/workout-sessions/${sessionId1}`,
            { token: actor.token }
        );
        assert.equal(attempt.response.status, 404, `${label} must be denied: ${JSON.stringify(attempt.data)}`);
        assert.equal(attempt.data.error.code, "WORKOUT_SESSION_NOT_FOUND");
    }

    const foreignStudioTrainer = await api(
        `/api/v1/studios/${studioA.id}/coached-members/${membershipIds.member1A}/workout-sessions`,
        { token: accounts.trainerB.token }
    );
    assert.equal(foreignStudioTrainer.response.status, 404);
    assert.equal(foreignStudioTrainer.data.error.code, "STUDIO_NOT_FOUND");
});

test("suspending the coach's own membership immediately revokes their read access, independent of the coaching relationship status", async () => {
    await setMembershipStatus(accounts.ownerA, studioA.id, membershipIds.trainer1A, "suspended");
    try {
        const attempt = await api(
            `/api/v1/studios/${studioA.id}/coached-members/${membershipIds.member1A}/workout-sessions/${sessionId1}`,
            { token: accounts.trainer1A.token }
        );
        // the studio context lookup itself is scoped to active memberships only, so a
        // suspended actor is treated identically to a non-member: the studio "does not
        // exist" for them, without ever reaching the permission or relationship checks.
        assert.equal(attempt.response.status, 404, JSON.stringify(attempt.data));
        assert.equal(attempt.data.error.code, "STUDIO_NOT_FOUND");
    } finally {
        await setMembershipStatus(accounts.ownerA, studioA.id, membershipIds.trainer1A, "active");
    }
});

test("ending the coaching relationship immediately revokes the coach's read access while the member keeps their own", async () => {
    await endRelationship(accounts.ownerA, studioA.id, rel1.id);

    const coachAfterEnding = await api(
        `/api/v1/studios/${studioA.id}/coached-members/${membershipIds.member1A}/workout-sessions/${sessionId1}`,
        { token: accounts.trainer1A.token }
    );
    assert.equal(coachAfterEnding.response.status, 404, JSON.stringify(coachAfterEnding.data));
    assert.equal(coachAfterEnding.data.error.code, "WORKOUT_SESSION_NOT_FOUND");

    const memberStillOwnsIt = await api(`/api/v1/studios/${studioA.id}/workout-sessions/${sessionId1}`, {
        token: accounts.member1A.token
    });
    assert.equal(
        memberStillOwnsIt.response.status, 200,
        "ending the coaching relationship must never revoke the member's own access to their own session"
    );
});

test("a member updates a set's actual metrics with optimistic concurrency, and the values persist", async () => {
    const before = await api(`/api/v1/studios/${studioA.id}/workout-sessions/${sessionId1}`, {
        token: accounts.member1A.token
    });
    const exercise = before.data.workoutSession.exercises[0];
    const [setA, setB] = exercise.sets;

    const updated = await api(
        `/api/v1/studios/${studioA.id}/workout-sessions/${sessionId1}/exercises/${exercise.id}/sets/${setA.id}`,
        {
            method: "PATCH", token: accounts.member1A.token,
            body: { status: "completed", actualReps: 8, actualWeight: 50, expectedRevision: setA.revision }
        }
    );
    assert.equal(updated.response.status, 200, JSON.stringify(updated.data));
    assert.equal(updated.data.workoutSet.status, "completed");
    assert.equal(updated.data.workoutSet.actualReps, 8);
    assert.equal(updated.data.workoutSet.actualWeight, 50);
    assert.equal(updated.data.workoutSet.revision, setA.revision + 1);
    assert.ok(updated.data.workoutSet.completedAt);

    const reread = await api(`/api/v1/studios/${studioA.id}/workout-sessions/${sessionId1}`, {
        token: accounts.member1A.token
    });
    const rereadSetA = reread.data.workoutSession.exercises[0].sets.find((set) => set.id === setA.id);
    assert.equal(rereadSetA.actualReps, 8);
    assert.equal(rereadSetA.actualWeight, 50);
    assert.equal(rereadSetA.status, "completed");
});

test("a stale expectedRevision is rejected, and two concurrent updates to the same set never both silently apply", async () => {
    const before = await api(`/api/v1/studios/${studioA.id}/workout-sessions/${sessionId1}`, {
        token: accounts.member1A.token
    });
    const exercise = before.data.workoutSession.exercises[0];
    const setA = exercise.sets.find((set) => set.status === "completed");
    const setB = exercise.sets.find((set) => set.status !== "completed");

    const stale = await api(
        `/api/v1/studios/${studioA.id}/workout-sessions/${sessionId1}/exercises/${exercise.id}/sets/${setA.id}`,
        {
            method: "PATCH", token: accounts.member1A.token,
            body: { actualReps: 9, expectedRevision: 0 }
        }
    );
    assert.equal(stale.response.status, 409, JSON.stringify(stale.data));
    assert.equal(stale.data.error.code, "WORKOUT_SET_CONFLICT");

    const [concurrentA, concurrentB] = await Promise.all([
        api(
            `/api/v1/studios/${studioA.id}/workout-sessions/${sessionId1}/exercises/${exercise.id}/sets/${setB.id}`,
            {
                method: "PATCH", token: accounts.member1A.token,
                body: { status: "completed", actualReps: 6, expectedRevision: setB.revision }
            }
        ),
        api(
            `/api/v1/studios/${studioA.id}/workout-sessions/${sessionId1}/exercises/${exercise.id}/sets/${setB.id}`,
            {
                method: "PATCH", token: accounts.member1A.token,
                body: { status: "completed", actualReps: 7, expectedRevision: setB.revision }
            }
        )
    ]);
    const statuses = [concurrentA.response.status, concurrentB.response.status].sort();
    assert.deepEqual(statuses, [200, 409]);
    const failed = concurrentA.response.status === 409 ? concurrentA : concurrentB;
    assert.equal(failed.data.error.code, "WORKOUT_SET_CONFLICT");

    const [[revisionRow]] = await pool.query(
        "SELECT revision FROM studio_workout_session_sets WHERE public_id = ?",
        [setB.id]
    );
    assert.equal(
        Number(revisionRow.revision), setB.revision + 1,
        "exactly one of the two concurrent updates must have applied, never both"
    );
});

test("a set cannot be marked completed without at least one plausible result metric", async () => {
    const before = await api(`/api/v1/studios/${studioA.id}/workout-sessions/${sessionId1}`, {
        token: accounts.member1A.token
    });
    const exercise = before.data.workoutSession.exercises[0];

    const created = await api(
        `/api/v1/studios/${studioA.id}/workout-sessions/${sessionId1}/exercises/${exercise.id}/sets`,
        { method: "POST", token: accounts.member1A.token, body: {} }
    );
    assert.equal(created.response.status, 201, JSON.stringify(created.data));
    const setC = created.data.workoutSet;

    const noMetric = await api(
        `/api/v1/studios/${studioA.id}/workout-sessions/${sessionId1}/exercises/${exercise.id}/sets/${setC.id}`,
        { method: "PATCH", token: accounts.member1A.token, body: { status: "completed", expectedRevision: setC.revision } }
    );
    assert.equal(noMetric.response.status, 400, JSON.stringify(noMetric.data));
    assert.equal(noMetric.data.error.code, "WORKOUT_RESULT_INVALID");

    const withMetric = await api(
        `/api/v1/studios/${studioA.id}/workout-sessions/${sessionId1}/exercises/${exercise.id}/sets/${setC.id}`,
        {
            method: "PATCH", token: accounts.member1A.token,
            body: { status: "completed", actualReps: 0, expectedRevision: setC.revision }
        }
    );
    assert.equal(
        withMetric.response.status, 200,
        "a logged zero rep is still a meaningful, present metric, unlike an absent field"
    );
});

test("the exercise can be marked completed once every one of its sets is resolved, guarded by the same optimistic concurrency", async () => {
    const before = await api(`/api/v1/studios/${studioA.id}/workout-sessions/${sessionId1}`, {
        token: accounts.member1A.token
    });
    const exercise = before.data.workoutSession.exercises[0];
    assert.ok(exercise.sets.every((set) => set.status === "completed"), "every set must already be resolved by this point");

    const staleAttempt = await api(
        `/api/v1/studios/${studioA.id}/workout-sessions/${sessionId1}/exercises/${exercise.id}`,
        { method: "PATCH", token: accounts.member1A.token, body: { status: "completed", expectedRevision: 999 } }
    );
    assert.equal(staleAttempt.response.status, 409, JSON.stringify(staleAttempt.data));
    assert.equal(staleAttempt.data.error.code, "WORKOUT_EXERCISE_CONFLICT");

    const completed = await api(
        `/api/v1/studios/${studioA.id}/workout-sessions/${sessionId1}/exercises/${exercise.id}`,
        { method: "PATCH", token: accounts.member1A.token, body: { status: "completed", expectedRevision: exercise.revision } }
    );
    assert.equal(completed.response.status, 200, JSON.stringify(completed.data));
    assert.equal(completed.data.workoutExercise.status, "completed");
});

test("a fully resolved session completes atomically", async () => {
    const completed = await api(`/api/v1/studios/${studioA.id}/workout-sessions/${sessionId1}/complete`, {
        method: "POST", token: accounts.member1A.token
    });
    assert.equal(completed.response.status, 200, JSON.stringify(completed.data));
    assert.equal(completed.data.workoutSession.status, "completed");
    assert.ok(completed.data.workoutSession.completedAt);
});

test("a completed session is immutable to every further mutation attempt", async () => {
    const before = await api(`/api/v1/studios/${studioA.id}/workout-sessions/${sessionId1}`, {
        token: accounts.member1A.token
    });
    const exercise = before.data.workoutSession.exercises[0];
    const set = exercise.sets[0];

    const noteAttempt = await api(`/api/v1/studios/${studioA.id}/workout-sessions/${sessionId1}`, {
        method: "PATCH", token: accounts.member1A.token,
        body: { memberNote: "too late", expectedRevision: before.data.workoutSession.revision }
    });
    assert.equal(noteAttempt.response.status, 409);
    assert.equal(noteAttempt.data.error.code, "WORKOUT_SESSION_NOT_MUTABLE");

    const exerciseAttempt = await api(
        `/api/v1/studios/${studioA.id}/workout-sessions/${sessionId1}/exercises/${exercise.id}`,
        { method: "PATCH", token: accounts.member1A.token, body: { status: "pending", expectedRevision: exercise.revision } }
    );
    assert.equal(exerciseAttempt.response.status, 409);
    assert.equal(exerciseAttempt.data.error.code, "WORKOUT_SESSION_NOT_MUTABLE");

    const setAttempt = await api(
        `/api/v1/studios/${studioA.id}/workout-sessions/${sessionId1}/exercises/${exercise.id}/sets/${set.id}`,
        { method: "PATCH", token: accounts.member1A.token, body: { actualReps: 1, expectedRevision: set.revision } }
    );
    assert.equal(setAttempt.response.status, 409);
    assert.equal(setAttempt.data.error.code, "WORKOUT_SESSION_NOT_MUTABLE");

    const createSetAttempt = await api(
        `/api/v1/studios/${studioA.id}/workout-sessions/${sessionId1}/exercises/${exercise.id}/sets`,
        { method: "POST", token: accounts.member1A.token, body: {} }
    );
    assert.equal(createSetAttempt.response.status, 409);
    assert.equal(createSetAttempt.data.error.code, "WORKOUT_SESSION_NOT_MUTABLE");

    const completeAgain = await api(`/api/v1/studios/${studioA.id}/workout-sessions/${sessionId1}/complete`, {
        method: "POST", token: accounts.member1A.token
    });
    assert.equal(completeAgain.response.status, 409);
    assert.equal(completeAgain.data.error.code, "WORKOUT_SESSION_ALREADY_TERMINAL");

    const abortAfterComplete = await api(`/api/v1/studios/${studioA.id}/workout-sessions/${sessionId1}/abort`, {
        method: "POST", token: accounts.member1A.token
    });
    assert.equal(abortAfterComplete.response.status, 409);
    assert.equal(abortAfterComplete.data.error.code, "WORKOUT_SESSION_ALREADY_TERMINAL");
});

test("aborting a session preserves whatever was already logged, and an aborted session is likewise immutable afterward", async () => {
    const before = await api(`/api/v1/studios/${studioA.id}/workout-sessions/${sessionId2}`, {
        token: accounts.member1A.token
    });
    const exercise = before.data.workoutSession.exercises[0];
    const set = exercise.sets[0];

    const logged = await api(
        `/api/v1/studios/${studioA.id}/workout-sessions/${sessionId2}/exercises/${exercise.id}/sets/${set.id}`,
        {
            method: "PATCH", token: accounts.member1A.token,
            body: { actualReps: 5, actualWeight: 40, expectedRevision: set.revision }
        }
    );
    assert.equal(logged.response.status, 200, JSON.stringify(logged.data));

    const aborted = await api(`/api/v1/studios/${studioA.id}/workout-sessions/${sessionId2}/abort`, {
        method: "POST", token: accounts.member1A.token
    });
    assert.equal(aborted.response.status, 200, JSON.stringify(aborted.data));
    assert.equal(aborted.data.workoutSession.status, "aborted");
    assert.ok(aborted.data.workoutSession.abortedAt);

    const reread = await api(`/api/v1/studios/${studioA.id}/workout-sessions/${sessionId2}`, {
        token: accounts.member1A.token
    });
    const rereadSet = reread.data.workoutSession.exercises[0].sets.find((item) => item.id === set.id);
    assert.equal(rereadSet.actualReps, 5, "aborting must not discard already-logged set data");
    assert.equal(rereadSet.actualWeight, 40);

    const mutationAfterAbort = await api(`/api/v1/studios/${studioA.id}/workout-sessions/${sessionId2}`, {
        method: "PATCH", token: accounts.member1A.token,
        body: { memberNote: "too late", expectedRevision: reread.data.workoutSession.revision }
    });
    assert.equal(mutationAfterAbort.response.status, 409);
    assert.equal(mutationAfterAbort.data.error.code, "WORKOUT_SESSION_NOT_MUTABLE");
});

test("the workout session audit trail records that sessions happened, but never any performance value, note, or request body", async () => {
    const [rows] = await pool.query(
        `SELECT event_type, details_json
         FROM studio_audit_events sae
         INNER JOIN studios s ON s.id = sae.studio_id
         WHERE s.public_id = ? AND sae.event_type LIKE 'workout_session.%'
         ORDER BY sae.id ASC`,
        [studioA.id]
    );
    const eventTypes = new Set(rows.map((row) => row.event_type));
    for (const expected of ["workout_session.started", "workout_session.completed", "workout_session.aborted"]) {
        assert.ok(eventTypes.has(expected), `missing audit event ${expected}`);
    }
    for (const row of rows) {
        if (row.event_type !== "workout_session.started") {
            assert.deepEqual(row.details_json, {}, `${row.event_type} must carry zero details`);
        }
    }

    const serialized = JSON.stringify(rows.map((row) => row.details_json));
    for (const forbidden of [
        "weight", "reps", "rpe", "distance", "duration", "note",
        "actualReps", "actualWeight", "password", "token", "requestBody"
    ]) {
        assert.equal(
            serialized.toLowerCase().includes(forbidden.toLowerCase()),
            false,
            `audit details must never contain "${forbidden}"`
        );
    }
});

test("personal workout and progress data remain fully separate from, and unaffected by, studio workout sessions", async () => {
    const exercises = await api("/api/exercises", { token: accounts.member1A.token });
    assert.equal(exercises.response.status, 200);
    const exercise = exercises.data.find((item) => item.category !== "Cardio");

    const personalWorkout = await api("/api/workouts", {
        method: "POST", token: accounts.member1A.token,
        body: {
            title: "Private leg day",
            workout_date: "2026-01-10",
            exercises: [{ exercise_id: exercise.id, sets: 3, reps: 8, weight: 42 }]
        }
    });
    assert.equal(personalWorkout.response.status, 201, JSON.stringify(personalWorkout.data));

    const coachWorkouts = await api("/api/workouts", { token: accounts.trainer1A.token });
    assert.equal(coachWorkouts.response.status, 200);
    assert.equal(
        coachWorkouts.data.some((workout) => workout.title === "Private leg day"),
        false,
        "personal workouts must never leak to another user, coached or not"
    );

    const sessionDetail = await api(`/api/v1/studios/${studioA.id}/workout-sessions/${sessionId1}`, {
        token: accounts.member1A.token
    });
    assert.equal(JSON.stringify(sessionDetail.data).includes("Private leg day"), false);

    const [[personalCount]] = await pool.query(
        "SELECT COUNT(*) AS total FROM workouts WHERE title = 'Private leg day'"
    );
    assert.equal(Number(personalCount.total), 1, "starting/completing studio workout sessions must never write into the personal workouts table");
});
