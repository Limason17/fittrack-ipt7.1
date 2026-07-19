const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mysql = require("mysql2/promise");

const TEST_DATABASE = `fittrack_api_test_training_${process.pid}_${Date.now()}`;
if (!/^fittrack_api_test_training_[A-Za-z0-9_]+$/.test(TEST_DATABASE)) {
    throw new Error("Refusing to use an unsafe training API test database name.");
}

process.env.NODE_ENV = "test";
process.env.DB_NAME = TEST_DATABASE;
process.env.JWT_SECRET = "fittrack-stage-1b1-test-secret-with-at-least-32-characters";
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
let relationship1;
let relationship2;
let programA;
let versionA1;
let dayA1;
let assignmentMember1;

function fixture(name) {
    return {
        username: `stage1b1-${name}-${runId}`,
        email: `stage1b1-${name}-${runId}@example.test`,
        password: "correct horse battery staple stage1b1"
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
    return api(`/api/v1/studios/${studioId}/coaching-relationships`, {
        method: "POST",
        token: actor.token,
        body: { coachMembershipId, memberMembershipId }
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
        "ownerA", "adminA", "trainer1A", "trainer2A",
        "member1A", "member2A", "member3A",
        "ownerB", "trainerB", "memberB"
    ]) {
        accounts[name] = await registerAndLogin(name);
    }

    const createdA = await api("/api/v1/studios", {
        method: "POST",
        token: accounts.ownerA.token,
        body: {
            name: "Stage 1B.1 Alpha",
            slug: `stage1b1-alpha-${runId}`,
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
            name: "Stage 1B.1 Beta",
            slug: `stage1b1-beta-${runId}`,
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

    for (const [name, role] of [
        ["trainerB", "trainer"],
        ["memberB", "member"]
    ]) {
        const membership = await inviteAndAccept(accounts.ownerB, studioB.id, accounts[name], role);
        membershipIds[name] = membership.id;
    }

    // owner creates (trainer1, member1); admin creates (trainer2, member3)
    const rel1 = await createRelationship(
        accounts.ownerA, studioA.id, membershipIds.trainer1A, membershipIds.member1A
    );
    assert.equal(rel1.response.status, 201, JSON.stringify(rel1.data));
    relationship1 = rel1.data.coachingRelationship;

    const rel2 = await createRelationship(
        accounts.adminA, studioA.id, membershipIds.trainer2A, membershipIds.member3A
    );
    assert.equal(rel2.response.status, 201, JSON.stringify(rel2.data));
    relationship2 = rel2.data.coachingRelationship;
});

after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.closePool(db);
    if (adminConnection) {
        assert.match(TEST_DATABASE, /^fittrack_api_test_training_[A-Za-z0-9_]+$/);
        await adminConnection.query(`DROP DATABASE IF EXISTS \`${TEST_DATABASE}\``);
        await adminConnection.end();
    }
});

test("owner and admin can create coaching relationships; a trainer cannot self-invent one", async () => {
    assert.equal(relationship1.status, "active");
    assert.equal(relationship1.coach.membershipId, membershipIds.trainer1A);
    assert.equal(relationship1.member.membershipId, membershipIds.member1A);
    assert.equal(relationship2.coach.membershipId, membershipIds.trainer2A);

    const trainerAttempt = await createRelationship(
        accounts.trainer1A, studioA.id, membershipIds.trainer1A, membershipIds.member2A
    );
    assert.equal(trainerAttempt.response.status, 403, JSON.stringify(trainerAttempt.data));
    assert.equal(trainerAttempt.data.error.code, "INSUFFICIENT_STUDIO_ROLE");

    const memberAttempt = await createRelationship(
        accounts.member1A, studioA.id, membershipIds.trainer1A, membershipIds.member2A
    );
    assert.equal(memberAttempt.response.status, 403, JSON.stringify(memberAttempt.data));
});

test("a coach sees only their own coaching relationships; owner and admin see all", async () => {
    const asTrainer1 = await api(`/api/v1/studios/${studioA.id}/coaching-relationships`, {
        token: accounts.trainer1A.token
    });
    assert.equal(asTrainer1.response.status, 200);
    assert.equal(asTrainer1.data.coachingRelationships.length, 1);
    assert.equal(asTrainer1.data.coachingRelationships[0].id, relationship1.id);

    const asOwner = await api(`/api/v1/studios/${studioA.id}/coaching-relationships`, {
        token: accounts.ownerA.token
    });
    assert.equal(asOwner.response.status, 200);
    const ownerVisibleIds = asOwner.data.coachingRelationships.map((row) => row.id).sort();
    assert.deepEqual(ownerVisibleIds, [relationship1.id, relationship2.id].sort());
});

test("a foreign studio member gets an identical not-found on every Stage 1B.1 studio-A endpoint", async () => {
    const endpoints = [
        () => api(`/api/v1/studios/${studioA.id}/coaching-relationships`, { token: accounts.trainerB.token }),
        () => api(`/api/v1/studios/${studioA.id}/training-programs`, { token: accounts.trainerB.token }),
        () => api(`/api/v1/studios/${studioA.id}/program-assignments/me`, { token: accounts.memberB.token }),
        () => api(`/api/v1/studios/${studioA.id}/program-assignments`, { token: accounts.trainerB.token })
    ];
    for (const call of endpoints) {
        const result = await call();
        assert.equal(result.response.status, 404, JSON.stringify(result.data));
        assert.equal(result.data.error.code, "STUDIO_NOT_FOUND");
    }

    const guessedStudio = await api(
        "/api/v1/studios/423e4567-e89b-42d3-a456-426614174000/training-programs",
        { token: accounts.ownerA.token }
    );
    assert.equal(guessedStudio.response.status, 404);
    assert.equal(guessedStudio.data.error.code, "STUDIO_NOT_FOUND");
});

test("a trainer builds a draft program with a day and exercise, then publishes it", async () => {
    const created = await api(`/api/v1/studios/${studioA.id}/training-programs`, {
        method: "POST",
        token: accounts.trainer1A.token,
        body: { name: "Beginner Strength", description: "4 week onboarding plan" }
    });
    assert.equal(created.response.status, 201, JSON.stringify(created.data));
    programA = created.data.trainingProgram;
    assert.equal(programA.status, "draft");

    const version = await api(
        `/api/v1/studios/${studioA.id}/training-programs/${programA.id}/versions`,
        { method: "POST", token: accounts.trainer1A.token, body: {} }
    );
    assert.equal(version.response.status, 201, JSON.stringify(version.data));
    versionA1 = version.data.programVersion;
    assert.equal(versionA1.versionNumber, 1);
    assert.equal(versionA1.status, "draft");

    const day = await api(
        `/api/v1/studios/${studioA.id}/training-programs/${programA.id}/versions/${versionA1.id}/days`,
        { method: "POST", token: accounts.trainer1A.token, body: { name: "Day 1: Push" } }
    );
    assert.equal(day.response.status, 201, JSON.stringify(day.data));
    dayA1 = day.data.programDay;

    const exercise = await api(
        `/api/v1/studios/${studioA.id}/training-programs/${programA.id}/versions/${versionA1.id}/days/${dayA1.id}/exercises`,
        {
            method: "POST",
            token: accounts.trainer1A.token,
            body: { exerciseNameSnapshot: "Bench Press", targetSets: 4, targetRepsMin: 6, targetRepsMax: 8 }
        }
    );
    assert.equal(exercise.response.status, 201, JSON.stringify(exercise.data));

    const fetched = await api(
        `/api/v1/studios/${studioA.id}/training-programs/${programA.id}/versions/${versionA1.id}`,
        { token: accounts.adminA.token }
    );
    assert.equal(fetched.response.status, 200);
    assert.equal(fetched.data.programVersion.days.length, 1);
    assert.equal(fetched.data.programVersion.days[0].exercises.length, 1);
    assert.equal(fetched.data.programVersion.days[0].exercises[0].exerciseNameSnapshot, "Bench Press");

    const published = await api(
        `/api/v1/studios/${studioA.id}/training-programs/${programA.id}/versions/${versionA1.id}/publish`,
        { method: "POST", token: accounts.trainer1A.token }
    );
    assert.equal(published.response.status, 200, JSON.stringify(published.data));
    versionA1 = published.data.programVersion;
    assert.equal(versionA1.status, "published");
    assert.ok(versionA1.publishedAt);

    const programAfterPublish = await api(
        `/api/v1/studios/${studioA.id}/training-programs/${programA.id}`,
        { token: accounts.trainer1A.token }
    );
    assert.equal(programAfterPublish.data.trainingProgram.status, "active");
});

test("a published version is immutable and a new draft version does not alter the published one", async () => {
    const patchAttempt = await api(
        `/api/v1/studios/${studioA.id}/training-programs/${programA.id}/versions/${versionA1.id}`,
        { method: "PATCH", token: accounts.trainer1A.token, body: { notes: "should not apply" } }
    );
    assert.equal(patchAttempt.response.status, 409, JSON.stringify(patchAttempt.data));
    assert.equal(patchAttempt.data.error.code, "PROGRAM_VERSION_NOT_DRAFT");

    const dayAttempt = await api(
        `/api/v1/studios/${studioA.id}/training-programs/${programA.id}/versions/${versionA1.id}/days`,
        { method: "POST", token: accounts.trainer1A.token, body: { name: "Illegal extra day" } }
    );
    assert.equal(dayAttempt.response.status, 409);
    assert.equal(dayAttempt.data.error.code, "PROGRAM_VERSION_NOT_DRAFT");

    const version2 = await api(
        `/api/v1/studios/${studioA.id}/training-programs/${programA.id}/versions`,
        { method: "POST", token: accounts.trainer1A.token, body: { notes: "v2 draft" } }
    );
    assert.equal(version2.response.status, 201, JSON.stringify(version2.data));
    assert.equal(version2.data.programVersion.versionNumber, 2);
    assert.equal(version2.data.programVersion.status, "draft");

    const v1Reread = await api(
        `/api/v1/studios/${studioA.id}/training-programs/${programA.id}/versions/${versionA1.id}`,
        { token: accounts.trainer1A.token }
    );
    assert.equal(v1Reread.data.programVersion.status, "published");
    assert.equal(
        v1Reread.data.programVersion.days.length,
        1,
        "the original version's day must be untouched by the new draft"
    );

    const draftAssignAttempt = await api(`/api/v1/studios/${studioA.id}/program-assignments`, {
        method: "POST",
        token: accounts.trainer1A.token,
        body: {
            programVersionId: version2.data.programVersion.id,
            memberMembershipId: membershipIds.member1A,
            coachingRelationshipId: relationship1.id
        }
    });
    assert.equal(draftAssignAttempt.response.status, 409, JSON.stringify(draftAssignAttempt.data));
    assert.equal(draftAssignAttempt.data.error.code, "PROGRAM_VERSION_NOT_PUBLISHED");
});

test("assigning a published version requires an explicit coaching relationship id that actually matches the target member", async () => {
    const okAssignment = await api(`/api/v1/studios/${studioA.id}/program-assignments`, {
        method: "POST",
        token: accounts.trainer1A.token,
        body: {
            programVersionId: versionA1.id,
            memberMembershipId: membershipIds.member1A,
            coachingRelationshipId: relationship1.id
        }
    });
    assert.equal(okAssignment.response.status, 201, JSON.stringify(okAssignment.data));
    assignmentMember1 = okAssignment.data.programAssignment;
    assert.equal(assignmentMember1.status, "active");
    assert.equal(assignmentMember1.programVersion.versionNumber, 1);

    // relationship1 is trainer1's relationship with member1, not member2 — a
    // mismatched (relationship, member) pair must be rejected exactly like a
    // non-existent relationship, not disclosed as "wrong member".
    const mismatchedMemberAttempt = await api(`/api/v1/studios/${studioA.id}/program-assignments`, {
        method: "POST",
        token: accounts.trainer1A.token,
        body: {
            programVersionId: versionA1.id,
            memberMembershipId: membershipIds.member2A,
            coachingRelationshipId: relationship1.id
        }
    });
    assert.equal(mismatchedMemberAttempt.response.status, 404, JSON.stringify(mismatchedMemberAttempt.data));
    assert.equal(mismatchedMemberAttempt.data.error.code, "COACHING_RELATIONSHIP_NOT_FOUND");

    const missingRelationshipId = await api(`/api/v1/studios/${studioA.id}/program-assignments`, {
        method: "POST",
        token: accounts.trainer1A.token,
        body: { programVersionId: versionA1.id, memberMembershipId: membershipIds.member2A }
    });
    assert.equal(missingRelationshipId.response.status, 400, JSON.stringify(missingRelationshipId.data));
    assert.equal(missingRelationshipId.data.error.code, "VALIDATION_ERROR");
    assert.ok(Object.hasOwn(missingRelationshipId.data.error.fields, "coachingRelationshipId"));
});

test("a member sees only their own assignments; a trainer cannot see an unassigned member's list entry", async () => {
    const ownAssignments = await api(`/api/v1/studios/${studioA.id}/program-assignments/me`, {
        token: accounts.member1A.token
    });
    assert.equal(ownAssignments.response.status, 200);
    assert.equal(ownAssignments.data.programAssignments.length, 1);
    assert.equal(ownAssignments.data.programAssignments[0].id, assignmentMember1.id);
    assert.equal(
        Object.hasOwn(ownAssignments.data.programAssignments[0], "member"),
        false,
        "a member's own assignment view must not repeat their own membership identity as a separate field"
    );

    const otherMemberAssignments = await api(`/api/v1/studios/${studioA.id}/program-assignments/me`, {
        token: accounts.member3A.token
    });
    assert.equal(otherMemberAssignments.response.status, 200);
    assert.equal(otherMemberAssignments.data.programAssignments.length, 0);

    const memberListAttempt = await api(`/api/v1/studios/${studioA.id}/program-assignments`, {
        token: accounts.member1A.token
    });
    assert.equal(memberListAttempt.response.status, 403);
    assert.equal(memberListAttempt.data.error.code, "INSUFFICIENT_STUDIO_ROLE");

    const trainer2GetsForeignAssignment = await api(
        `/api/v1/studios/${studioA.id}/program-assignments/${assignmentMember1.id}`,
        { token: accounts.trainer2A.token }
    );
    assert.equal(trainer2GetsForeignAssignment.response.status, 404, JSON.stringify(trainer2GetsForeignAssignment.data));
    assert.equal(trainer2GetsForeignAssignment.data.error.code, "PROGRAM_ASSIGNMENT_NOT_FOUND");

    const trainer1ListOnlyOwnCoached = await api(`/api/v1/studios/${studioA.id}/program-assignments`, {
        token: accounts.trainer1A.token
    });
    assert.equal(trainer1ListOnlyOwnCoached.response.status, 200);
    assert.equal(trainer1ListOnlyOwnCoached.data.programAssignments.length, 1);
    assert.equal(trainer1ListOnlyOwnCoached.data.programAssignments[0].id, assignmentMember1.id);
});

test("a member can read the full day and exercise detail of their own assignment, and only their own", async () => {
    const detail = await api(
        `/api/v1/studios/${studioA.id}/program-assignments/me/${assignmentMember1.id}`,
        { token: accounts.member1A.token }
    );
    assert.equal(detail.response.status, 200, JSON.stringify(detail.data));
    assert.equal(detail.data.programAssignment.id, assignmentMember1.id);
    assert.equal(Object.hasOwn(detail.data.programAssignment, "member"), false);
    assert.equal(detail.data.programAssignment.days.length, 1);
    assert.equal(detail.data.programAssignment.days[0].exercises.length, 1);
    assert.equal(detail.data.programAssignment.days[0].exercises[0].exerciseNameSnapshot, "Bench Press");

    const foreignMemberAttempt = await api(
        `/api/v1/studios/${studioA.id}/program-assignments/me/${assignmentMember1.id}`,
        { token: accounts.member3A.token }
    );
    assert.equal(foreignMemberAttempt.response.status, 404, JSON.stringify(foreignMemberAttempt.data));
    assert.equal(foreignMemberAttempt.data.error.code, "PROGRAM_ASSIGNMENT_NOT_FOUND");

    const trainerAttempt = await api(
        `/api/v1/studios/${studioA.id}/program-assignments/me/${assignmentMember1.id}`,
        { token: accounts.trainer1A.token }
    );
    assert.equal(
        trainerAttempt.response.status, 404,
        "a trainer has no membership row matching this assignment's own member_membership_id, so this must 404 like any other mismatch"
    );

    const guessedAssignmentId = await api(
        `/api/v1/studios/${studioA.id}/program-assignments/me/00000000-0000-4000-8000-000000000000`,
        { token: accounts.member1A.token }
    );
    assert.equal(guessedAssignmentId.response.status, 404);
    assert.equal(guessedAssignmentId.data.error.code, "PROGRAM_ASSIGNMENT_NOT_FOUND");
});

test("ending a coaching relationship immediately revokes the trainer's access to that member's assignment", async () => {
    const trainer1CanReadBeforeEnding = await api(
        `/api/v1/studios/${studioA.id}/program-assignments/${assignmentMember1.id}`,
        { token: accounts.trainer1A.token }
    );
    assert.equal(trainer1CanReadBeforeEnding.response.status, 200);

    const ended = await api(
        `/api/v1/studios/${studioA.id}/coaching-relationships/${relationship1.id}`,
        { method: "PATCH", token: accounts.ownerA.token, body: { status: "ended" } }
    );
    assert.equal(ended.response.status, 200, JSON.stringify(ended.data));
    assert.equal(ended.data.coachingRelationship.status, "ended");

    const trainer1AfterEnding = await api(
        `/api/v1/studios/${studioA.id}/program-assignments/${assignmentMember1.id}`,
        { token: accounts.trainer1A.token }
    );
    assert.equal(trainer1AfterEnding.response.status, 404, JSON.stringify(trainer1AfterEnding.data));
    assert.equal(trainer1AfterEnding.data.error.code, "PROGRAM_ASSIGNMENT_NOT_FOUND");

    const newAssignmentAttempt = await api(`/api/v1/studios/${studioA.id}/program-assignments`, {
        method: "POST",
        token: accounts.trainer1A.token,
        body: {
            programVersionId: versionA1.id,
            memberMembershipId: membershipIds.member1A,
            coachingRelationshipId: relationship1.id
        }
    });
    assert.equal(newAssignmentAttempt.response.status, 404, JSON.stringify(newAssignmentAttempt.data));
    assert.equal(newAssignmentAttempt.data.error.code, "COACHING_RELATIONSHIP_NOT_FOUND");

    const doubleEndAttempt = await api(
        `/api/v1/studios/${studioA.id}/coaching-relationships/${relationship1.id}`,
        { method: "PATCH", token: accounts.ownerA.token, body: { status: "ended" } }
    );
    assert.equal(doubleEndAttempt.response.status, 409);
    assert.equal(doubleEndAttempt.data.error.code, "COACHING_RELATIONSHIP_ALREADY_ENDED");

    const memberStillSeesOwnHistory = await api(`/api/v1/studios/${studioA.id}/program-assignments/me`, {
        token: accounts.member1A.token
    });
    assert.equal(memberStillSeesOwnHistory.response.status, 200);
    assert.equal(
        memberStillSeesOwnHistory.data.programAssignments.length,
        1,
        "ending the coaching relationship must not erase the member's own assignment history"
    );
});

test("forged or foreign public ids are rejected with the same not-found as a non-existent resource", async () => {
    const neverExistedUuid = "00000000-0000-4000-8000-000000000000";

    const noSuchProgram = await api(
        `/api/v1/studios/${studioA.id}/training-programs/${neverExistedUuid}`,
        { token: accounts.ownerA.token }
    );
    assert.equal(noSuchProgram.response.status, 404);
    assert.equal(noSuchProgram.data.error.code, "TRAINING_PROGRAM_NOT_FOUND");

    const foreignStudioProgramInsideA = await api(
        `/api/v1/studios/${studioA.id}/training-programs/${studioB.id}`,
        { token: accounts.ownerA.token }
    );
    assert.equal(foreignStudioProgramInsideA.response.status, 404);
    assert.equal(foreignStudioProgramInsideA.data.error.code, "TRAINING_PROGRAM_NOT_FOUND");

    const numericId = await api(
        `/api/v1/studios/${studioA.id}/training-programs/1`,
        { token: accounts.ownerA.token }
    );
    assert.equal(numericId.response.status, 400, JSON.stringify(numericId.data));
    assert.equal(numericId.data.error.code, "VALIDATION_ERROR");

    const foreignMembershipAsCoach = await createRelationship(
        accounts.ownerA, studioA.id, membershipIds.trainerB, membershipIds.member2A
    );
    assert.equal(foreignMembershipAsCoach.response.status, 409, JSON.stringify(foreignMembershipAsCoach.data));
    assert.equal(foreignMembershipAsCoach.data.error.code, "COACH_MEMBERSHIP_INELIGIBLE");

    const foreignVersionInAssignment = await api(`/api/v1/studios/${studioA.id}/program-assignments`, {
        method: "POST",
        token: accounts.ownerA.token,
        body: {
            programVersionId: neverExistedUuid,
            memberMembershipId: membershipIds.member3A,
            coachingRelationshipId: relationship2.id
        }
    });
    assert.equal(foreignVersionInAssignment.response.status, 404);
    assert.equal(foreignVersionInAssignment.data.error.code, "PROGRAM_VERSION_NOT_FOUND");

    const guessedCoachingRelationship = await api(`/api/v1/studios/${studioA.id}/program-assignments`, {
        method: "POST",
        token: accounts.ownerA.token,
        body: {
            programVersionId: versionA1.id,
            memberMembershipId: membershipIds.member3A,
            coachingRelationshipId: neverExistedUuid
        }
    });
    assert.equal(guessedCoachingRelationship.response.status, 404);
    assert.equal(guessedCoachingRelationship.data.error.code, "COACHING_RELATIONSHIP_NOT_FOUND");
});

test("assignment creation deterministically selects between two active coaches and rejects every invalid relationship reference", async () => {
    // member3A already has an active relationship with trainer2A (relationship2).
    // Give member3A a second, fully independent active coach: trainer1A.
    const rel3Created = await createRelationship(
        accounts.adminA, studioA.id, membershipIds.trainer1A, membershipIds.member3A
    );
    assert.equal(rel3Created.response.status, 201, JSON.stringify(rel3Created.data));
    const relationship3 = rel3Created.data.coachingRelationship;

    const viaCoachA = await api(`/api/v1/studios/${studioA.id}/program-assignments`, {
        method: "POST",
        token: accounts.ownerA.token,
        body: {
            programVersionId: versionA1.id,
            memberMembershipId: membershipIds.member3A,
            coachingRelationshipId: relationship3.id
        }
    });
    assert.equal(viaCoachA.response.status, 201, JSON.stringify(viaCoachA.data));

    // Owner explicitly picks coach B (trainer2A / relationship2) for the very
    // same member — must independently succeed, proving there is no hidden
    // "most recently started" or "first match" auto-selection left anywhere.
    const viaCoachB = await api(`/api/v1/studios/${studioA.id}/program-assignments`, {
        method: "POST",
        token: accounts.ownerA.token,
        body: {
            programVersionId: versionA1.id,
            memberMembershipId: membershipIds.member3A,
            coachingRelationshipId: relationship2.id
        }
    });
    assert.equal(viaCoachB.response.status, 201, JSON.stringify(viaCoachB.data));

    const [[coachAAssignmentRow]] = await pool.query(
        `SELECT cr.public_id AS relationship_public_id
         FROM studio_program_assignments pa
         INNER JOIN studio_coaching_relationships cr ON cr.id = pa.coaching_relationship_id
         WHERE pa.public_id = ?`,
        [viaCoachA.data.programAssignment.id]
    );
    const [[coachBAssignmentRow]] = await pool.query(
        `SELECT cr.public_id AS relationship_public_id
         FROM studio_program_assignments pa
         INNER JOIN studio_coaching_relationships cr ON cr.id = pa.coaching_relationship_id
         WHERE pa.public_id = ?`,
        [viaCoachB.data.programAssignment.id]
    );
    assert.equal(
        coachAAssignmentRow.relationship_public_id, relationship3.id,
        "the assignment must persist exactly the relationship the caller chose"
    );
    assert.equal(coachBAssignmentRow.relationship_public_id, relationship2.id);

    // A relationship that exists only in another studio must be rejected
    // exactly like a non-existent one.
    const foreignRelationship = await createRelationship(
        accounts.ownerB, studioB.id, membershipIds.trainerB, membershipIds.memberB
    );
    assert.equal(foreignRelationship.response.status, 201, JSON.stringify(foreignRelationship.data));
    const foreignStudioAttempt = await api(`/api/v1/studios/${studioA.id}/program-assignments`, {
        method: "POST",
        token: accounts.ownerA.token,
        body: {
            programVersionId: versionA1.id,
            memberMembershipId: membershipIds.member3A,
            coachingRelationshipId: foreignRelationship.data.coachingRelationship.id
        }
    });
    assert.equal(foreignStudioAttempt.response.status, 404);
    assert.equal(foreignStudioAttempt.data.error.code, "COACHING_RELATIONSHIP_NOT_FOUND");

    // relationship1 (trainer1A / member1A) was ended in an earlier test; an
    // already-ended relationship must be rejected the same way as a foreign one.
    const endedRelationshipAttempt = await api(`/api/v1/studios/${studioA.id}/program-assignments`, {
        method: "POST",
        token: accounts.ownerA.token,
        body: {
            programVersionId: versionA1.id,
            memberMembershipId: membershipIds.member1A,
            coachingRelationshipId: relationship1.id
        }
    });
    assert.equal(endedRelationshipAttempt.response.status, 404);
    assert.equal(endedRelationshipAttempt.data.error.code, "COACHING_RELATIONSHIP_NOT_FOUND");

    // A trainer must never be able to use another trainer's relationship, even
    // though they themselves separately coach the very same member.
    const foreignTrainerAttempt = await api(`/api/v1/studios/${studioA.id}/program-assignments`, {
        method: "POST",
        token: accounts.trainer2A.token,
        body: {
            programVersionId: versionA1.id,
            memberMembershipId: membershipIds.member3A,
            coachingRelationshipId: relationship3.id
        }
    });
    assert.equal(foreignTrainerAttempt.response.status, 404, JSON.stringify(foreignTrainerAttempt.data));
    assert.equal(foreignTrainerAttempt.data.error.code, "COACHING_RELATIONSHIP_NOT_FOUND");

    // A relationship whose coach membership is no longer active (suspended or
    // left) must be rejected, since eligibility is loaded fresh every request.
    const suspendCoach = await api(
        `/api/v1/studios/${studioA.id}/memberships/${membershipIds.trainer2A}`,
        { method: "PATCH", token: accounts.ownerA.token, body: { status: "suspended" } }
    );
    assert.equal(suspendCoach.response.status, 200, JSON.stringify(suspendCoach.data));
    try {
        const suspendedCoachAttempt = await api(`/api/v1/studios/${studioA.id}/program-assignments`, {
            method: "POST",
            token: accounts.ownerA.token,
            body: {
                programVersionId: versionA1.id,
                memberMembershipId: membershipIds.member3A,
                coachingRelationshipId: relationship2.id
            }
        });
        assert.equal(suspendedCoachAttempt.response.status, 404, JSON.stringify(suspendedCoachAttempt.data));
        assert.equal(suspendedCoachAttempt.data.error.code, "COACHING_RELATIONSHIP_NOT_FOUND");
    } finally {
        const restoreCoach = await api(
            `/api/v1/studios/${studioA.id}/memberships/${membershipIds.trainer2A}`,
            { method: "PATCH", token: accounts.ownerA.token, body: { status: "active" } }
        );
        assert.equal(restoreCoach.response.status, 200, JSON.stringify(restoreCoach.data));
    }

    // Two concurrent, independently valid assignments through the same
    // explicit relationship must both succeed consistently without deadlock
    // or corruption.
    const [concurrentA, concurrentB] = await Promise.all([
        api(`/api/v1/studios/${studioA.id}/program-assignments`, {
            method: "POST",
            token: accounts.ownerA.token,
            body: {
                programVersionId: versionA1.id,
                memberMembershipId: membershipIds.member3A,
                coachingRelationshipId: relationship3.id,
                startsOn: "2026-03-01"
            }
        }),
        api(`/api/v1/studios/${studioA.id}/program-assignments`, {
            method: "POST",
            token: accounts.adminA.token,
            body: {
                programVersionId: versionA1.id,
                memberMembershipId: membershipIds.member3A,
                coachingRelationshipId: relationship3.id,
                startsOn: "2026-04-01"
            }
        })
    ]);
    assert.equal(concurrentA.response.status, 201, JSON.stringify(concurrentA.data));
    assert.equal(concurrentB.response.status, 201, JSON.stringify(concurrentB.data));
    const [[concurrentCount]] = await pool.query(
        `SELECT COUNT(*) AS total
         FROM studio_program_assignments pa
         INNER JOIN studio_coaching_relationships cr ON cr.id = pa.coaching_relationship_id
         WHERE cr.public_id = ?`,
        [relationship3.id]
    );
    assert.equal(
        Number(concurrentCount.total), 3,
        "coach A now has three consistent assignments through the same relationship (viaCoachA + two concurrent)"
    );

    // The audit trail correctly references the relationship the caller
    // actually selected, not an internal id or an auto-picked alternative.
    const [[auditRow]] = await pool.query(
        `SELECT details_json
         FROM studio_audit_events sae
         INNER JOIN studios s ON s.id = sae.studio_id
         WHERE s.public_id = ? AND sae.event_type = 'training_program_assignment.created'
           AND sae.target_public_id = ?`,
        [studioA.id, viaCoachA.data.programAssignment.id]
    );
    assert.equal(auditRow.details_json.memberMembershipId, membershipIds.member3A);
});

test("two concurrent attempts to create the same active coaching relationship leave exactly one active row", async () => {
    const [first, second] = await Promise.all([
        createRelationship(accounts.ownerA, studioA.id, membershipIds.trainer2A, membershipIds.member2A),
        createRelationship(accounts.adminA, studioA.id, membershipIds.trainer2A, membershipIds.member2A)
    ]);
    const statuses = [first.response.status, second.response.status].sort();
    assert.deepEqual(statuses, [201, 409]);
    const failed = first.response.status === 409 ? first : second;
    assert.equal(failed.data.error.code, "COACHING_RELATIONSHIP_ALREADY_ACTIVE");

    const [[countRow]] = await pool.query(
        `SELECT COUNT(*) AS total
         FROM studio_coaching_relationships cr
         INNER JOIN studio_memberships coach ON coach.id = cr.coach_membership_id
         INNER JOIN studio_memberships member ON member.id = cr.member_membership_id
         WHERE coach.public_id = ? AND member.public_id = ? AND cr.status = 'active'`,
        [membershipIds.trainer2A, membershipIds.member2A]
    );
    assert.equal(Number(countRow.total), 1);
});

test("Stage 1B.1 audit events are recorded with only allowlisted, non-sensitive detail fields", async () => {
    const [rows] = await pool.query(
        `SELECT event_type, details_json
         FROM studio_audit_events sae
         INNER JOIN studios s ON s.id = sae.studio_id
         WHERE s.public_id = ?
         ORDER BY sae.id ASC`,
        [studioA.id]
    );
    const eventTypes = new Set(rows.map((row) => row.event_type));
    for (const expected of [
        "coaching_relationship.created",
        "coaching_relationship.ended",
        "training_program.created",
        "training_program_version.created",
        "training_program_version.published",
        "training_program_assignment.created"
    ]) {
        assert.ok(eventTypes.has(expected), `missing audit event ${expected}`);
    }

    const serialized = JSON.stringify(rows.map((row) => row.details_json));
    for (const forbidden of ["weight", "reps", "sets", "targetWeight", "password", "token", "requestBody"]) {
        assert.equal(
            serialized.toLowerCase().includes(forbidden.toLowerCase()),
            false,
            `audit details must never contain "${forbidden}"`
        );
    }
});

test("personal workout data stays fully invisible through the Stage 1B.1 API and unaffected by it", async () => {
    const exercises = await api("/api/exercises", { token: accounts.member1A.token });
    assert.equal(exercises.response.status, 200);
    const exercise = exercises.data.find((item) => item.category !== "Cardio");

    const personalWorkout = await api("/api/workouts", {
        method: "POST",
        token: accounts.member1A.token,
        body: {
            title: "Private leg day",
            workout_date: "2026-01-10",
            exercises: [{ exercise_id: exercise.id, sets: 3, reps: 8, weight: 42 }]
        }
    });
    assert.equal(personalWorkout.response.status, 201, JSON.stringify(personalWorkout.data));

    const trainerWorkouts = await api("/api/workouts", { token: accounts.trainer1A.token });
    assert.equal(trainerWorkouts.response.status, 200);
    assert.equal(
        trainerWorkouts.data.some((workout) => workout.title === "Private leg day"),
        false,
        "the personal workouts endpoint must never return another user's data, coached or not"
    );

    const assignmentDetail = await api(
        `/api/v1/studios/${studioA.id}/program-assignments/me`,
        { token: accounts.member1A.token }
    );
    const serializedAssignments = JSON.stringify(assignmentDetail.data);
    assert.equal(serializedAssignments.includes("Private leg day"), false);

    const memberOwnWorkouts = await api("/api/workouts", { token: accounts.member1A.token });
    assert.equal(memberOwnWorkouts.response.status, 200);
    assert.ok(memberOwnWorkouts.data.some((workout) => workout.title === "Private leg day"));
});
