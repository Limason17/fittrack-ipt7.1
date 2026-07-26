const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const mysql = require("mysql2/promise");

const TEST_DATABASE = `fittrack_api_test_calendar_${process.pid}_${Date.now()}`;
if (!/^fittrack_api_test_calendar_[A-Za-z0-9_]+$/.test(TEST_DATABASE)) {
    throw new Error("Refusing to use an unsafe calendar API test database name.");
}

process.env.NODE_ENV = "test";
process.env.DB_NAME = TEST_DATABASE;
process.env.JWT_SECRET = "fittrack-stage-5a1-test-secret-with-at-least-32-characters";
process.env.AUTH_LOGIN_RATE_LIMIT_MAX = "1000";
process.env.AUTH_REGISTRATION_RATE_LIMIT_MAX = "1000";
process.env.INVITATION_ACCEPT_BASE_URL = "http://127.0.0.1:4173";
process.env.INVITATION_EMAIL_PROVIDER = "";

const db = require("../../config/db");
const { createMigrationRunner } = require("../../migrations/runner");
const { createApp } = require("../../startup/app");
const { isoWeekdayOf, addDays, todayInTimezone } = require("../../domain/trainingCalendarDomain");

const logger = { info() {}, warn() {}, error() {} };
const runId = crypto.randomBytes(5).toString("hex");
let adminConnection;
let pool;
let server;
let baseUrl;
const accounts = {};
const membershipIds = {};
let studioA;
let studioB;
let relationshipA;
let assignmentA;
let programDayA;
let today;
let todayWeekday;
let todayRuleId;

function fixture(name) {
    return {
        username: `stage5a1-${name}-${runId}`,
        email: `stage5a1-${name}-${runId}@example.test`,
        password: "correct horse battery staple stage5a1"
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
        body: { username: user.username, email: user.email, password: user.password }
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
        method: "POST", token: inviter.token, body: { email: invitee.email, role }
    });
    const token = invitationToken(created);
    const accepted = await api(`/api/v1/invitations/${token}/accept`, { method: "POST", token: invitee.token });
    assert.equal(accepted.response.status, 200, JSON.stringify(accepted.data));
    return accepted.data.membership;
}

async function createStudio(owner, name) {
    const created = await api("/api/v1/studios", {
        method: "POST", token: owner.token,
        body: { name, slug: `${name.toLowerCase().replace(/\s+/g, "-")}-${runId}`, defaultLocale: "de", defaultTimezone: "Europe/Zurich", defaultWeightUnit: "kg" }
    });
    assert.equal(created.response.status, 201, JSON.stringify(created.data));
    return created.data.studio;
}

async function buildAssignment(studio, owner, coachToken, coachMembershipId, memberMembershipId, relationshipId) {
    const program = await api(`/api/v1/studios/${studio.id}/training-programs`, {
        method: "POST", token: coachToken, body: { name: `Program ${runId}` }
    });
    assert.equal(program.response.status, 201, JSON.stringify(program.data));
    const version = await api(`/api/v1/studios/${studio.id}/training-programs/${program.data.trainingProgram.id}/versions`, {
        method: "POST", token: coachToken, body: {}
    });
    assert.equal(version.response.status, 201, JSON.stringify(version.data));
    const day = await api(
        `/api/v1/studios/${studio.id}/training-programs/${program.data.trainingProgram.id}/versions/${version.data.programVersion.id}/days`,
        { method: "POST", token: coachToken, body: { name: "Leg Day" } }
    );
    assert.equal(day.response.status, 201, JSON.stringify(day.data));
    const exercise = await api(
        `/api/v1/studios/${studio.id}/training-programs/${program.data.trainingProgram.id}/versions/${version.data.programVersion.id}/days/${day.data.programDay.id}/exercises`,
        { method: "POST", token: coachToken, body: { exerciseNameSnapshot: "Squat", targetSets: 1, targetRepsMin: 5, targetRepsMax: 5 } }
    );
    assert.equal(exercise.response.status, 201, JSON.stringify(exercise.data));
    const published = await api(
        `/api/v1/studios/${studio.id}/training-programs/${program.data.trainingProgram.id}/versions/${version.data.programVersion.id}/publish`,
        { method: "POST", token: coachToken }
    );
    assert.equal(published.response.status, 200, JSON.stringify(published.data));
    const assignment = await api(`/api/v1/studios/${studio.id}/program-assignments`, {
        method: "POST", token: owner.token,
        body: {
            programVersionId: version.data.programVersion.id, memberMembershipId,
            coachingRelationshipId: relationshipId, startsOn: null, endsOn: null
        }
    });
    assert.equal(assignment.response.status, 201, JSON.stringify(assignment.data));
    return { assignment: assignment.data.programAssignment, programDay: day.data.programDay };
}

// `date` anchors both `weekday` (derived from it) and `anchorDate`/
// `activeFrom` together, so every call site is free to just say "make this
// rule fire on this date" without ever risking an inconsistent
// weekday/anchorDate pairing (the service rejects anchorDate values that
// don't themselves fall on the given weekday - see scheduleRuleService.js).
function createRule(actorToken, studioId, assignmentId, { date = today, activeUntil = null, weekInterval = 1 } = {}) {
    return api(`/api/v1/studios/${studioId}/program-assignments/${assignmentId}/schedule-rules`, {
        method: "POST", token: actorToken,
        body: {
            programDayId: programDayA.id, weekday: isoWeekdayOf(date), weekInterval,
            anchorDate: date, activeFrom: date, activeUntil
        }
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

    for (const name of ["ownerA", "adminA", "trainerA", "trainer2A", "memberA", "ownerB", "memberB"]) {
        accounts[name] = await registerAndLogin(name);
    }

    studioA = await createStudio(accounts.ownerA, "Calendar Studio A");
    membershipIds.ownerA = studioA.membership.id;
    studioB = await createStudio(accounts.ownerB, "Calendar Studio B");
    membershipIds.ownerB = studioB.membership.id;

    for (const [name, role] of [["adminA", "admin"], ["trainerA", "trainer"], ["trainer2A", "trainer"], ["memberA", "member"]]) {
        const membership = await inviteAndAccept(accounts.ownerA, studioA.id, accounts[name], role);
        membershipIds[name] = membership.id;
    }
    membershipIds.memberB = (await inviteAndAccept(accounts.ownerB, studioB.id, accounts.memberB, "member")).id;

    const relResult = await api(`/api/v1/studios/${studioA.id}/coaching-relationships`, {
        method: "POST", token: accounts.ownerA.token,
        body: { coachMembershipId: membershipIds.trainerA, memberMembershipId: membershipIds.memberA }
    });
    assert.equal(relResult.response.status, 201, JSON.stringify(relResult.data));
    relationshipA = relResult.data.coachingRelationship;

    const built = await buildAssignment(
        studioA, accounts.ownerA, accounts.trainerA.token,
        membershipIds.trainerA, membershipIds.memberA, relationshipA.id
    );
    assignmentA = built.assignment;
    programDayA = built.programDay;

    today = todayInTimezone("Europe/Zurich");
    todayWeekday = isoWeekdayOf(today);
});

after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (pool) await pool.end();
    if (adminConnection) {
        await adminConnection.query(`DROP DATABASE IF EXISTS \`${TEST_DATABASE}\``);
        await adminConnection.end();
    }
});

// ---- Schedule rule RBAC ----

test("owner can create a schedule rule for an assignment in their own studio", async () => {
    const result = await createRule(accounts.ownerA.token, studioA.id, assignmentA.id);
    assert.equal(result.response.status, 201, JSON.stringify(result.data));
    assert.equal(result.data.scheduleRule.weekday, todayWeekday);
    todayRuleId = result.data.scheduleRule.id;
});

test("a duplicate active rule for the same assignment+day+weekday is rejected with CALENDAR_SCHEDULE_RULE_CONFLICT", async () => {
    const result = await createRule(accounts.ownerA.token, studioA.id, assignmentA.id);
    assert.equal(result.response.status, 409);
    assert.equal(result.data.error.code, "CALENDAR_SCHEDULE_RULE_CONFLICT");
});

test("member can list schedule rules but cannot create one (403 via existing permission middleware)", async () => {
    const listResult = await api(`/api/v1/studios/${studioA.id}/program-assignments/${assignmentA.id}/schedule-rules`, {
        token: accounts.memberA.token
    });
    assert.equal(listResult.response.status, 200);
    assert.ok(listResult.data.scheduleRules.length >= 1);

    const createResult = await createRule(accounts.memberA.token, studioA.id, assignmentA.id, { date: addDays(today, 1) });
    assert.equal(createResult.response.status, 403);
});

test("a trainer without an active coaching relationship to this assignment cannot manage its schedule rules", async () => {
    const result = await createRule(accounts.trainer2A.token, studioA.id, assignmentA.id, { date: addDays(today, 2) });
    assert.equal(result.response.status, 403);
    assert.equal(result.data.error.code, "CALENDAR_ENTRY_FORBIDDEN");
});

test("a foreign studio's owner cannot manage schedule rules for another studio's assignment (tenant isolation)", async () => {
    const result = await createRule(accounts.ownerB.token, studioA.id, assignmentA.id, { date: addDays(today, 3) });
    assert.equal(result.response.status, 404, "foreign studio yields the generic studio-context 404, not a calendar-specific leak");
});

test("updating a rule to disabled emits assignment.schedule_rule.disabled and stops future materialization", async () => {
    const createResult = await createRule(accounts.ownerA.token, studioA.id, assignmentA.id, { date: addDays(today, 4) });
    assert.equal(createResult.response.status, 201, JSON.stringify(createResult.data));
    const ruleId = createResult.data.scheduleRule.id;

    const disableResult = await api(
        `/api/v1/studios/${studioA.id}/program-assignments/${assignmentA.id}/schedule-rules/${ruleId}`,
        { method: "PATCH", token: accounts.ownerA.token, body: { status: "disabled" } }
    );
    assert.equal(disableResult.response.status, 200, JSON.stringify(disableResult.data));
    assert.equal(disableResult.data.scheduleRule.status, "disabled");

    const [[event]] = await pool.query(
        "SELECT event_type FROM studio_audit_events WHERE event_type = 'assignment.schedule_rule.disabled' AND target_public_id = ?",
        [ruleId]
    );
    assert.ok(event, "assignment.schedule_rule.disabled audit event recorded");
});

// ---- Materialization, display status, no duplicates ----

test("member sees today's studio occurrence as PLANNED/DUE_TODAY after the coach creates a weekly rule", async () => {
    const result = await api(`/api/v1/training-calendar?from=${today}&to=${today}`, { token: accounts.memberA.token });
    assert.equal(result.response.status, 200, JSON.stringify(result.data));
    const studioEntry = result.data.entries.find((entry) => entry.sourceType === "studio");
    assert.ok(studioEntry, "studio occurrence materialized");
    assert.equal(studioEntry.persistedStatus, "PLANNED");
    assert.equal(studioEntry.displayStatus, "DUE_TODAY");
    assert.deepEqual(studioEntry.availableActions, ["START", "SKIP", "CANCEL"]);
    assert.equal(studioEntry.linkedWorkoutPublicId, null);
});

test("loading the same range twice never creates a duplicate occurrence row", async () => {
    await api(`/api/v1/training-calendar?from=${today}&to=${today}`, { token: accounts.memberA.token });
    await api(`/api/v1/training-calendar?from=${today}&to=${today}`, { token: accounts.memberA.token });
    const [[row]] = await pool.query(
        "SELECT COUNT(*) AS total FROM training_calendar_entries WHERE program_assignment_id = (SELECT id FROM studio_program_assignments WHERE public_id = ?) AND scheduled_date = ?",
        [assignmentA.id, today]
    );
    assert.equal(Number(row.total), 1);
});

test("parallel calendar reads for the same range never create duplicate occurrences (race-safe materialization)", async () => {
    const targetDate = addDays(today, -1);
    // A fresh weekly rule scoped to exactly this one already-past day, so
    // this test's own materialization is isolated from the entries created
    // by earlier tests.
    const ruleResult = await createRule(accounts.ownerA.token, studioA.id, assignmentA.id, {
        date: targetDate, activeUntil: targetDate
    });
    assert.equal(ruleResult.response.status, 201, JSON.stringify(ruleResult.data));

    await Promise.all(Array.from({ length: 5 }, () =>
        api(`/api/v1/training-calendar?from=${targetDate}&to=${targetDate}`, { token: accounts.memberA.token })
    ));
    const [[row]] = await pool.query(
        `SELECT COUNT(*) AS total FROM training_calendar_entries
         WHERE schedule_rule_id = (SELECT id FROM studio_assignment_schedule_rules WHERE public_id = ?)`,
        [ruleResult.data.scheduleRule.id]
    );
    assert.equal(Number(row.total), 1, "five concurrent materializing reads collapsed onto exactly one row");
});

// ---- Session integration ----

test("starting the workout session flips the linked occurrence to IN_PROGRESS and records calendar.studio_workout.started", async () => {
    const startResult = await api(`/api/v1/studios/${studioA.id}/program-assignments/${assignmentA.id}/workout-sessions`, {
        method: "POST", token: accounts.memberA.token,
        body: { programDayId: programDayA.id, clientStartKey: `cal-start-${runId}` }
    });
    assert.equal(startResult.response.status, 201, JSON.stringify(startResult.data));
    const sessionId = startResult.data.workoutSession.id;

    const calResult = await api(`/api/v1/training-calendar?from=${today}&to=${today}`, { token: accounts.memberA.token });
    const entry = calResult.data.entries.find((e) => e.sourceType === "studio" && e.linkedWorkoutPublicId === sessionId);
    assert.ok(entry, "occurrence linked to the new session");
    assert.equal(entry.persistedStatus, "IN_PROGRESS");
    assert.equal(entry.displayStatus, "IN_PROGRESS");
    assert.deepEqual(entry.availableActions, ["COMPLETE", "VIEW_WORKOUT"]);

    const [[event]] = await pool.query(
        "SELECT event_type FROM studio_audit_events WHERE event_type = 'calendar.studio_workout.started' AND target_public_id = ?",
        [entry.id]
    );
    assert.ok(event);

    // A second, genuinely new start attempt (different clientStartKey) for
    // the same occurrence must be blocked - "doppelten Start verhindern".
    const secondStart = await api(`/api/v1/studios/${studioA.id}/program-assignments/${assignmentA.id}/workout-sessions`, {
        method: "POST", token: accounts.memberA.token,
        body: { programDayId: programDayA.id, clientStartKey: `cal-start-${runId}-second` }
    });
    assert.equal(secondStart.response.status, 409);

    // Complete the session (needs one completed set to satisfy the existing
    // sessionCompletionEligibility contract, unchanged by this phase).
    const detail = await api(`/api/v1/studios/${studioA.id}/workout-sessions/${sessionId}`, { token: accounts.memberA.token });
    const exercise = detail.data.workoutSession.exercises[0];
    const set = exercise.sets[0];
    await api(`/api/v1/studios/${studioA.id}/workout-sessions/${sessionId}/exercises/${exercise.id}/sets/${set.id}`, {
        method: "PATCH", token: accounts.memberA.token,
        body: { status: "completed", actualReps: 5, expectedRevision: set.revision }
    });
    await api(`/api/v1/studios/${studioA.id}/workout-sessions/${sessionId}/exercises/${exercise.id}`, {
        method: "PATCH", token: accounts.memberA.token, body: { status: "completed", expectedRevision: exercise.revision }
    });
    const completeResult = await api(`/api/v1/studios/${studioA.id}/workout-sessions/${sessionId}/complete`, {
        method: "POST", token: accounts.memberA.token
    });
    assert.equal(completeResult.response.status, 200, JSON.stringify(completeResult.data));

    const calAfterComplete = await api(`/api/v1/training-calendar?from=${today}&to=${today}`, { token: accounts.memberA.token });
    const completedEntry = calAfterComplete.data.entries.find((e) => e.id === entry.id);
    assert.equal(completedEntry.persistedStatus, "COMPLETED");
    assert.equal(completedEntry.displayStatus, "COMPLETED");
    assert.deepEqual(completedEntry.availableActions, ["VIEW_WORKOUT"]);

    const [[completedEvent]] = await pool.query(
        "SELECT event_type FROM studio_audit_events WHERE event_type = 'calendar.studio_workout.completed' AND target_public_id = ?",
        [entry.id]
    );
    assert.ok(completedEvent);
});

test("aborting an in-progress session reverts its calendar occurrence back to PLANNED and clears the session link", async () => {
    // Today's occurrence from the original rule (todayRuleId) is already
    // COMPLETED from the earlier "starting the workout session..." test -
    // only one active rule may cover the same assignment+day+weekday at a
    // time, so this disables that rule and creates a fresh one for the same
    // weekday, which gets its own brand-new, still-PLANNED occurrence row
    // (a different schedule_rule_id, hence a genuinely new row under the
    // (schedule_rule_id, scheduled_date) unique index).
    const disableOld = await api(
        `/api/v1/studios/${studioA.id}/program-assignments/${assignmentA.id}/schedule-rules/${todayRuleId}`,
        { method: "PATCH", token: accounts.ownerA.token, body: { status: "disabled" } }
    );
    assert.equal(disableOld.response.status, 200, JSON.stringify(disableOld.data));
    const freshRule = await createRule(accounts.ownerA.token, studioA.id, assignmentA.id);
    assert.equal(freshRule.response.status, 201, JSON.stringify(freshRule.data));

    const startResult = await api(`/api/v1/studios/${studioA.id}/program-assignments/${assignmentA.id}/workout-sessions`, {
        method: "POST", token: accounts.memberA.token,
        body: { programDayId: programDayA.id, clientStartKey: `cal-abort-${runId}` }
    });
    assert.equal(startResult.response.status, 201, JSON.stringify(startResult.data));
    const sessionId = startResult.data.workoutSession.id;

    const abortResult = await api(`/api/v1/studios/${studioA.id}/workout-sessions/${sessionId}/abort`, {
        method: "POST", token: accounts.memberA.token
    });
    assert.equal(abortResult.response.status, 200, JSON.stringify(abortResult.data));

    const [[row]] = await pool.query(
        `SELECT status, studio_workout_session_id FROM training_calendar_entries
         WHERE schedule_rule_id = (SELECT id FROM studio_assignment_schedule_rules WHERE public_id = ?)`,
        [freshRule.data.scheduleRule.id]
    );
    assert.ok(row, "the fresh occurrence exists");
    assert.equal(row.status, "PLANNED");
    assert.equal(row.studio_workout_session_id, null, "the session link was cleared by the abort");
});

// ---- Personal calendar mutations ----

test("personal entry creation follows the future/today/past default rules and the today override", async () => {
    const future = addDays(today, 10);
    const past = addDays(today, -10);

    const futureResult = await api("/api/v1/training-calendar", {
        method: "POST", token: accounts.memberA.token, body: { scheduledDate: future, title: "Future" }
    });
    assert.equal(futureResult.response.status, 201);
    assert.equal(futureResult.data.calendarEntry.persistedStatus, "PLANNED");

    const pastResult = await api("/api/v1/training-calendar", {
        method: "POST", token: accounts.memberA.token, body: { scheduledDate: past, title: "Past" }
    });
    assert.equal(pastResult.response.status, 201);
    assert.equal(pastResult.data.calendarEntry.persistedStatus, "COMPLETED");
    assert.equal(pastResult.data.calendarEntry.linkedWorkoutType, "personal_workout");

    const todayDefaultResult = await api("/api/v1/training-calendar", {
        method: "POST", token: accounts.memberA.token, body: { scheduledDate: today, title: "Today default" }
    });
    assert.equal(todayDefaultResult.data.calendarEntry.persistedStatus, "COMPLETED");

    const todayOverrideResult = await api("/api/v1/training-calendar", {
        method: "POST", token: accounts.memberA.token, body: { scheduledDate: today, title: "Today override", planAsUpcoming: true }
    });
    assert.equal(todayOverrideResult.data.calendarEntry.persistedStatus, "PLANNED");
    assert.equal(todayOverrideResult.data.calendarEntry.displayStatus, "DUE_TODAY");

    // Verify no duplicate/empty workouts row: exactly one workouts row backs the past entry.
    const [[count]] = await pool.query(
        "SELECT COUNT(*) AS total FROM workouts WHERE public_id = ?",
        [pastResult.data.calendarEntry.linkedWorkoutPublicId]
    );
    assert.equal(Number(count.total), 1);
});

test("reschedule, skip, cancel and invalid-transition rejection on a personal entry", async () => {
    const future = addDays(today, 20);
    const createResult = await api("/api/v1/training-calendar", {
        method: "POST", token: accounts.memberA.token, body: { scheduledDate: future, title: "Reschedule me" }
    });
    const entryId = createResult.data.calendarEntry.id;

    const newDate = addDays(today, 21);
    const rescheduleResult = await api(`/api/v1/training-calendar/${entryId}/reschedule`, {
        method: "POST", token: accounts.memberA.token, body: { scheduledDate: newDate, expectedRevision: 0 }
    });
    assert.equal(rescheduleResult.response.status, 200, JSON.stringify(rescheduleResult.data));
    assert.equal(rescheduleResult.data.calendarEntry.scheduledDate, newDate);

    // Stale revision must be rejected with a stable 409 conflict code.
    const staleResult = await api(`/api/v1/training-calendar/${entryId}/reschedule`, {
        method: "POST", token: accounts.memberA.token, body: { scheduledDate: addDays(today, 22), expectedRevision: 0 }
    });
    assert.equal(staleResult.response.status, 409);
    assert.equal(staleResult.data.error.code, "CALENDAR_ENTRY_CONFLICT");

    const cancelResult = await api(`/api/v1/training-calendar/${entryId}/cancel`, {
        method: "POST", token: accounts.memberA.token, body: { expectedRevision: 1 }
    });
    assert.equal(cancelResult.response.status, 200, JSON.stringify(cancelResult.data));
    assert.equal(cancelResult.data.calendarEntry.persistedStatus, "CANCELLED");

    const invalidResult = await api(`/api/v1/training-calendar/${entryId}/complete`, {
        method: "POST", token: accounts.memberA.token, body: { expectedRevision: 2 }
    });
    assert.equal(invalidResult.response.status, 409);
    assert.equal(invalidResult.data.error.code, "CALENDAR_INVALID_TRANSITION");
});

test("a member cannot access or mutate another user's personal calendar entry - existence is never disclosed", async () => {
    const createResult = await api("/api/v1/training-calendar", {
        method: "POST", token: accounts.memberA.token, body: { scheduledDate: addDays(today, 30), title: "Private" }
    });
    const entryId = createResult.data.calendarEntry.id;

    const crossResult = await api(`/api/v1/training-calendar/${entryId}/cancel`, {
        method: "POST", token: accounts.ownerA.token, body: { expectedRevision: 0 }
    });
    assert.equal(crossResult.response.status, 404);
    assert.equal(crossResult.data.error.code, "CALENDAR_ENTRY_NOT_FOUND");
});

test("a manipulated/non-existent UUID entry id yields a clean 404, not a crash", async () => {
    const result = await api("/api/v1/training-calendar/not-a-real-uuid/cancel", {
        method: "POST", token: accounts.memberA.token, body: { expectedRevision: 0 }
    });
    assert.equal(result.response.status, 404);
    assert.equal(result.data.error.code, "CALENDAR_ENTRY_NOT_FOUND");

    const wellFormedButUnknown = await api(`/api/v1/training-calendar/${crypto.randomUUID()}/cancel`, {
        method: "POST", token: accounts.memberA.token, body: { expectedRevision: 0 }
    });
    assert.equal(wellFormedButUnknown.response.status, 404);
});

// ---- Legacy personal workout union ----

test("an existing personal workout appears as a COMPLETED calendar entry without any migration or duplication", async () => {
    const exercisesResult = await api("/api/exercises", { token: accounts.memberA.token });
    const exerciseId = exercisesResult.data[0].id;
    const legacyDate = addDays(today, -30);
    const legacyResult = await api("/api/workouts", {
        method: "POST", token: accounts.memberA.token,
        body: { title: "Legacy workout", workout_date: legacyDate, exercises: [{ exercise_id: exerciseId, sets: 3, reps: 10, weight: 40 }] }
    });
    assert.equal(legacyResult.response.status, 201, JSON.stringify(legacyResult.data));

    const calResult = await api(`/api/v1/training-calendar?from=${legacyDate}&to=${legacyDate}`, { token: accounts.memberA.token });
    const legacyEntries = calResult.data.entries.filter((e) => e.scheduledDate === legacyDate);
    assert.equal(legacyEntries.length, 1);
    assert.equal(legacyEntries[0].persistedStatus, "COMPLETED");
    assert.equal(legacyEntries[0].sourceType, "personal");
    assert.equal(legacyEntries[0].linkedWorkoutType, "personal_workout");

    // No training_calendar_entries row was created for this legacy workout -
    // the union is read-time only, no backfill/migration of history.
    const [[count]] = await pool.query(
        "SELECT COUNT(*) AS total FROM training_calendar_entries WHERE personal_workout_id = (SELECT id FROM workouts WHERE public_id = ?)",
        [legacyEntries[0].linkedWorkoutPublicId]
    );
    assert.equal(Number(count.total), 0);
});

// ---- Range validation ----

test("calendar range query enforces required from/to, inversion, and the 93-day cap", async () => {
    const missing = await api("/api/v1/training-calendar", { token: accounts.memberA.token });
    assert.equal(missing.response.status, 400);

    const inverted = await api(`/api/v1/training-calendar?from=${today}&to=${addDays(today, -5)}`, { token: accounts.memberA.token });
    assert.equal(inverted.response.status, 400);
    assert.equal(inverted.data.error.code, "CALENDAR_DATE_RANGE_INVALID");

    const tooLarge = await api(`/api/v1/training-calendar?from=${today}&to=${addDays(today, 200)}`, { token: accounts.memberA.token });
    assert.equal(tooLarge.response.status, 400);
    assert.equal(tooLarge.data.error.code, "CALENDAR_RANGE_TOO_LARGE");
});

// ---- Historical immutability under rule changes ----

test("disabling a schedule rule never alters already-materialized historical occurrences", async () => {
    // A distinct historical date from every earlier test's fixtures (the
    // "parallel calendar reads" test already used addDays(today, -1) for
    // the same assignment+day, and an active rule may only cover one
    // weekday combination at a time per program day).
    const historicalDate = addDays(today, -2);
    const ruleResult = await createRule(accounts.ownerA.token, studioA.id, assignmentA.id, {
        date: historicalDate, activeUntil: historicalDate
    });
    assert.equal(ruleResult.response.status, 201, JSON.stringify(ruleResult.data));
    const ruleId = ruleResult.data.scheduleRule.id;

    // Materialize the occurrence and mark it COMPLETED via the same path a
    // real session completion would use: directly flip status for this
    // test's purposes via the skip endpoint (any terminal status proves
    // immutability equally well).
    await api(`/api/v1/training-calendar?from=${historicalDate}&to=${historicalDate}`, { token: accounts.memberA.token });
    const [[entryRow]] = await pool.query(
        "SELECT public_id, revision FROM training_calendar_entries WHERE schedule_rule_id = (SELECT id FROM studio_assignment_schedule_rules WHERE public_id = ?)",
        [ruleId]
    );
    const skipResult = await api(`/api/v1/training-calendar/${entryRow.public_id}/skip`, {
        method: "POST", token: accounts.memberA.token, body: { expectedRevision: entryRow.revision }
    });
    assert.equal(skipResult.response.status, 200, JSON.stringify(skipResult.data));

    const disableResult = await api(
        `/api/v1/studios/${studioA.id}/program-assignments/${assignmentA.id}/schedule-rules/${ruleId}`,
        { method: "PATCH", token: accounts.ownerA.token, body: { status: "disabled" } }
    );
    assert.equal(disableResult.response.status, 200, JSON.stringify(disableResult.data));

    const [[afterRow]] = await pool.query(
        "SELECT status FROM training_calendar_entries WHERE public_id = ?",
        [entryRow.public_id]
    );
    assert.equal(afterRow.status, "SKIPPED", "the already-materialized, already-terminal occurrence is untouched by the rule's own status change");
});
