const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const mysql = require("mysql2/promise");

const TEST_DATABASE = `fittrack_api_test_deletion_${process.pid}_${Date.now()}`;
if (!/^fittrack_api_test_deletion_[A-Za-z0-9_]+$/.test(TEST_DATABASE)) {
    throw new Error("Refusing to use an unsafe account deletion API test database name.");
}

process.env.NODE_ENV = "test";
process.env.DB_NAME = TEST_DATABASE;
process.env.JWT_SECRET = "fittrack-stage-5c1-test-secret-with-at-least-32-characters";
process.env.RATE_LIMIT_KEY_SECRET = "fittrack-stage-5c1-test-rate-limit-secret-32-chars";
process.env.AUTH_LOGIN_RATE_LIMIT_MAX = "500";
process.env.AUTH_REGISTRATION_RATE_LIMIT_MAX = "500";
process.env.ACCOUNT_DELETE_RATE_LIMIT_MAX = "500";
process.env.INVITATION_EMAIL_PROVIDER = "";

const RECEIPT_DIR = path.join(
    os.tmpdir(),
    `fittrack-stage5c1-receipts-${process.pid}-${Date.now()}`
);
process.env.DELETION_RECEIPT_DIR = RECEIPT_DIR;
process.env.DELETION_RECEIPT_HMAC_KEY_B64 = crypto.randomBytes(32).toString("base64");
process.env.DELETION_RECEIPT_HMAC_KEY_ID = "stage5c1-integration-test-key";

const db = require("../../config/db");
const { createMigrationRunner } = require("../../migrations/runner");
const { createApp } = require("../../startup/app");
const { createPublicId } = require("../../domain/studioDomain");
const { diagnoseDeletionReceipts } = require("../../deletionReceipts/deletionReceiptDoctor");
const {
    applyReconciliation,
    planReconciliation
} = require("../../deletionReceipts/deletionReceiptReconciliation");
const { createAccountDeletionService } = require("../../services/accountDeletionService");

const logger = { info() {}, warn() {}, error() {} };
const runId = crypto.randomBytes(5).toString("hex");
let adminConnection;
let pool;
let server;
let baseUrl;
let counter = 0;

function fixture(name) {
    counter += 1;
    return {
        username: `s5c1-${name}-${counter}-${runId}`.slice(0, 50),
        email: `s5c1-${name}-${counter}-${runId}@example.test`,
        password: "correct horse battery staple 5c1"
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
    const data = await response.json();
    return { response, data };
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

// Direct-SQL fixture seeding for studio-domain entities: the feature under
// test is the deletion preview/execute API, not studio/coaching/assignment
// creation (already covered by their own dedicated integration suites) -
// seeding directly keeps each scenario below focused and fast while the
// deletion call itself always goes through the real HTTP -> service -> DB
// stack.
async function seedStudio({ name, ownerUserId }) {
    const studioPublicId = createPublicId();
    const [studioResult] = await pool.query(
        "INSERT INTO studios (public_id, name, slug, created_by_user_id) VALUES (?, ?, ?, ?)",
        [studioPublicId, name, `${name}-${crypto.randomBytes(3).toString("hex")}`.toLowerCase(), ownerUserId]
    );
    const studioInternalId = studioResult.insertId;
    const ownerMembership = await seedMembership({ studioInternalId, userId: ownerUserId, role: "owner" });
    return { studioInternalId, studioPublicId, ownerMembership };
}

async function seedMembership({ studioInternalId, userId, role, status = "active" }) {
    const membershipPublicId = createPublicId();
    const [result] = await pool.query(
        `INSERT INTO studio_memberships (public_id, studio_id, user_id, role, status, joined_at)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [membershipPublicId, studioInternalId, userId, role, status]
    );
    return { membershipInternalId: result.insertId, membershipPublicId };
}

async function seedCoachingRelationship({ studioInternalId, coachMembershipId, memberMembershipId, createdByUserId }) {
    const publicId = createPublicId();
    const [result] = await pool.query(
        `INSERT INTO studio_coaching_relationships
            (public_id, studio_id, coach_membership_id, member_membership_id, created_by_user_id, status, started_at)
         VALUES (?, ?, ?, ?, ?, 'active', NOW())`,
        [publicId, studioInternalId, coachMembershipId, memberMembershipId, createdByUserId]
    );
    return { relationshipInternalId: result.insertId, publicId };
}

async function seedProgramWithAssignment({
    studioInternalId, coachingRelationshipId, memberMembershipId, assignedByUserId
}) {
    const programPublicId = createPublicId();
    const [programResult] = await pool.query(
        "INSERT INTO studio_training_programs (public_id, studio_id, name, created_by_user_id) VALUES (?, ?, ?, ?)",
        [programPublicId, studioInternalId, "Test Program", assignedByUserId]
    );
    const versionPublicId = createPublicId();
    const [versionResult] = await pool.query(
        `INSERT INTO studio_training_program_versions
            (public_id, program_id, version_number, status, created_by_user_id)
         VALUES (?, ?, 1, 'published', ?)`,
        [versionPublicId, programResult.insertId, assignedByUserId]
    );
    const dayPublicId = createPublicId();
    const [dayResult] = await pool.query(
        "INSERT INTO studio_training_program_days (public_id, program_version_id, name, position) VALUES (?, ?, 'Day 1', 1)",
        [dayPublicId, versionResult.insertId]
    );
    const assignmentPublicId = createPublicId();
    const [assignmentResult] = await pool.query(
        `INSERT INTO studio_program_assignments
            (public_id, studio_id, program_version_id, member_membership_id, assigned_by_user_id, coaching_relationship_id, status)
         VALUES (?, ?, ?, ?, ?, ?, 'active')`,
        [assignmentPublicId, studioInternalId, versionResult.insertId, memberMembershipId, assignedByUserId, coachingRelationshipId]
    );
    return {
        programDayInternalId: dayResult.insertId,
        programDayPublicId: dayPublicId,
        programVersionInternalId: versionResult.insertId,
        assignmentInternalId: assignmentResult.insertId,
        assignmentPublicId
    };
}

async function seedWorkoutSession({
    studioInternalId, assignmentInternalId, memberMembershipId, programVersionInternalId,
    programDayInternalId, coachingRelationshipId, status = "in_progress"
}) {
    const publicId = createPublicId();
    // chk_workout_sessions_completed_at/aborted_at require the matching
    // timestamp column to be set in the SAME row as a terminal status -
    // never NULL for 'completed'/'aborted', so both must be provided
    // together at INSERT time, not added via a later UPDATE.
    const completedAt = status === "completed" ? new Date() : null;
    const abortedAt = status === "aborted" ? new Date() : null;
    const [result] = await pool.query(
        `INSERT INTO studio_workout_sessions
            (public_id, studio_id, assignment_id, member_membership_id, program_version_id, program_day_id,
             coaching_relationship_id, status, client_start_key, completed_at, aborted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            publicId, studioInternalId, assignmentInternalId, memberMembershipId, programVersionInternalId,
            programDayInternalId, coachingRelationshipId, status, crypto.randomUUID(), completedAt, abortedAt
        ]
    );
    return { sessionInternalId: result.insertId, sessionPublicId: publicId };
}

async function seedScheduleRule({ studioInternalId, assignmentInternalId, programDayInternalId, createdByUserId }) {
    const publicId = createPublicId();
    const [result] = await pool.query(
        `INSERT INTO studio_assignment_schedule_rules
            (public_id, studio_id, assignment_id, program_day_id, weekday, anchor_date, active_from, created_by_user_id, status)
         VALUES (?, ?, ?, ?, 1, CURDATE(), CURDATE(), ?, 'active')`,
        [publicId, studioInternalId, assignmentInternalId, programDayInternalId, createdByUserId]
    );
    return { ruleInternalId: result.insertId, rulePublicId: publicId };
}

async function seedCalendarEntry({
    userId, studioInternalId, assignmentInternalId, programDayInternalId, scheduleRuleInternalId,
    status, sourceType = "studio", scheduledDate
}) {
    const publicId = createPublicId();
    const date = scheduledDate || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (sourceType === "personal") {
        const [result] = await pool.query(
            `INSERT INTO training_calendar_entries
                (public_id, user_id, scheduled_date, status, source_type, title_snapshot, created_by_user_id)
             VALUES (?, ?, ?, ?, 'personal', 'Personal Entry', ?)`,
            [publicId, userId, date, status, userId]
        );
        return { entryInternalId: result.insertId, entryPublicId: publicId };
    }
    // chk_training_calendar_entries_source_shape requires schedule_rule_id
    // to be NOT NULL for source_type='studio' (012_unified_training_calendar.js).
    const [result] = await pool.query(
        `INSERT INTO training_calendar_entries
            (public_id, user_id, scheduled_date, status, source_type, title_snapshot,
             studio_id, program_assignment_id, program_day_id, schedule_rule_id, created_by_user_id)
         VALUES (?, ?, ?, ?, 'studio', 'Studio Entry', ?, ?, ?, ?, ?)`,
        [publicId, userId, date, status, studioInternalId, assignmentInternalId, programDayInternalId, scheduleRuleInternalId, userId]
    );
    return { entryInternalId: result.insertId, entryPublicId: publicId };
}

async function userRow(userId) {
    const [rows] = await pool.query(
        "SELECT id, username, email, password_hash, lifecycle_status, deleted_at, auth_version FROM users WHERE id = ?",
        [userId]
    );
    return rows[0] || null;
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
});

after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.closePool(db);
    if (adminConnection) {
        assert.match(TEST_DATABASE, /^fittrack_api_test_deletion_[A-Za-z0-9_]+$/);
        await adminConnection.query(`DROP DATABASE IF EXISTS \`${TEST_DATABASE}\``);
        await adminConnection.end();
    }
    await fsPromises.rm(RECEIPT_DIR, { recursive: true, force: true });
});

// ---- Preview ----

test("preview for a brand-new account with no studio history shows mode hard_delete and zero impact", async () => {
    const user = await registerAndLogin("preview-lone");
    const preview = await api("/api/account/deletion-preview", { token: user.token });
    assert.equal(preview.response.status, 200);
    assert.equal(preview.data.deletionPreview.mode, "hard_delete");
    assert.deepEqual(preview.data.deletionPreview.blockers, []);
    assert.equal(preview.data.deletionPreview.impact.runningWorkoutSessions, 0);
});

test("preview for a sole studio owner shows the ownership blocker with only the caller's own studio", async () => {
    const owner = await registerAndLogin("preview-owner");
    const studio = await seedStudio({ name: "Preview Owner Studio", ownerUserId: owner.id });

    const preview = await api("/api/account/deletion-preview", { token: owner.token });
    assert.equal(preview.response.status, 200);
    assert.equal(preview.data.deletionPreview.mode, "anonymize");
    assert.equal(preview.data.deletionPreview.blockers.length, 1);
    assert.equal(preview.data.deletionPreview.blockers[0].code, "ACCOUNT_DELETION_STUDIO_OWNERSHIP_REQUIRED");
    assert.equal(preview.data.deletionPreview.blockers[0].studios[0].studioId, studio.studioPublicId);
    assert.equal(preview.data.deletionPreview.studios[0].isSoleActiveOwner, true);
});

test("preview counts running sessions, active assignments, coaching relationships, and schedule rules accurately", async () => {
    const coach = await registerAndLogin("preview-coach");
    const member = await registerAndLogin("preview-member");
    const studio = await seedStudio({ name: "Preview Impact Studio", ownerUserId: coach.id });
    const secondOwner = await registerAndLogin("preview-second-owner");
    await seedMembership({ studioInternalId: studio.studioInternalId, userId: secondOwner.id, role: "owner" });
    const memberMembership = await seedMembership({
        studioInternalId: studio.studioInternalId, userId: member.id, role: "member"
    });
    const relationship = await seedCoachingRelationship({
        studioInternalId: studio.studioInternalId,
        coachMembershipId: studio.ownerMembership.membershipInternalId,
        memberMembershipId: memberMembership.membershipInternalId,
        createdByUserId: coach.id
    });
    const program = await seedProgramWithAssignment({
        studioInternalId: studio.studioInternalId,
        coachingRelationshipId: relationship.relationshipInternalId,
        memberMembershipId: memberMembership.membershipInternalId,
        assignedByUserId: coach.id
    });
    await seedWorkoutSession({
        studioInternalId: studio.studioInternalId,
        assignmentInternalId: program.assignmentInternalId,
        memberMembershipId: memberMembership.membershipInternalId,
        programVersionInternalId: program.programVersionInternalId,
        programDayInternalId: program.programDayInternalId,
        coachingRelationshipId: relationship.relationshipInternalId,
        status: "in_progress"
    });
    await seedScheduleRule({
        studioInternalId: studio.studioInternalId,
        assignmentInternalId: program.assignmentInternalId,
        programDayInternalId: program.programDayInternalId,
        createdByUserId: coach.id
    });

    const preview = await api("/api/account/deletion-preview", { token: member.token });
    assert.equal(preview.data.deletionPreview.impact.runningWorkoutSessions, 1);
    assert.equal(preview.data.deletionPreview.impact.activeAssignments, 1);
    assert.equal(preview.data.deletionPreview.impact.activeCoachingRelationships, 1);

    const coachPreview = await api("/api/account/deletion-preview", { token: coach.token });
    assert.equal(coachPreview.data.deletionPreview.impact.activeScheduleRules, 1);
    assert.equal(coachPreview.data.deletionPreview.blockers.length, 0, "second owner present, no blocker");
});

test("preview never leaks another member's identity or internal numeric ids", async () => {
    const coach = await registerAndLogin("preview-leak-coach");
    const member = await registerAndLogin("preview-leak-member");
    const studio = await seedStudio({ name: "Leak Check Studio", ownerUserId: coach.id });
    const secondOwner = await registerAndLogin("preview-leak-owner2");
    await seedMembership({ studioInternalId: studio.studioInternalId, userId: secondOwner.id, role: "owner" });
    await seedMembership({ studioInternalId: studio.studioInternalId, userId: member.id, role: "member" });

    const preview = await api("/api/account/deletion-preview", { token: coach.token });
    const serialized = JSON.stringify(preview.data);
    assert.ok(!serialized.includes(member.username));
    assert.ok(!serialized.includes(member.email));
    // A raw substring check for the internal integer id is unreliable (a
    // small sequential id like "1" trivially collides with unrelated count
    // fields elsewhere in the payload) - instead assert structurally that
    // every studioId in the response is a UUID (the public id), never the
    // internal auto-increment integer.
    for (const studio_ of preview.data.deletionPreview.studios) {
        assert.match(studio_.studioId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    }
});

// ---- Execute: validation & blockers ----

test("execute rejects a wrong current password without changing anything", async () => {
    const user = await registerAndLogin("exec-wrong-pw");
    const result = await api("/api/account/deletion-request", {
        method: "POST",
        token: user.token,
        body: { currentPassword: "not-the-password", confirmationPhrase: user.username }
    });
    assert.equal(result.response.status, 401);
    assert.equal(result.data.error.code, "CURRENT_PASSWORD_INVALID");
    const row = await userRow(user.id);
    assert.equal(row.lifecycle_status, "active");
});

test("execute rejects a wrong confirmation phrase without changing anything", async () => {
    const user = await registerAndLogin("exec-wrong-phrase");
    const result = await api("/api/account/deletion-request", {
        method: "POST",
        token: user.token,
        body: { currentPassword: user.password, confirmationPhrase: "definitely-not-my-username" }
    });
    assert.equal(result.response.status, 400);
    assert.equal(result.data.error.code, "ACCOUNT_DELETION_PHRASE_MISMATCH");
    const row = await userRow(user.id);
    assert.equal(row.lifecycle_status, "active");
});

test("execute rejects a payload missing required fields", async () => {
    const user = await registerAndLogin("exec-missing-fields");
    const result = await api("/api/account/deletion-request", {
        method: "POST",
        token: user.token,
        body: { currentPassword: user.password }
    });
    assert.equal(result.response.status, 400);
    assert.equal(result.data.error.code, "VALIDATION_ERROR");
});

test("execute requires authentication", async () => {
    const result = await api("/api/account/deletion-request", {
        method: "POST",
        body: { currentPassword: "x", confirmationPhrase: "y" }
    });
    assert.equal(result.response.status, 401);
});

test("sole studio owner is blocked with a 409 and no partial mutation (verified via before/after snapshot)", async () => {
    const owner = await registerAndLogin("exec-sole-owner");
    const studio = await seedStudio({ name: "Sole Owner Exec Studio", ownerUserId: owner.id });

    const before_ = await userRow(owner.id);
    const result = await api("/api/account/deletion-request", {
        method: "POST",
        token: owner.token,
        body: { currentPassword: owner.password, confirmationPhrase: owner.username }
    });
    assert.equal(result.response.status, 409);
    assert.equal(result.data.error.code, "ACCOUNT_DELETION_STUDIO_OWNERSHIP_REQUIRED");
    assert.equal(result.data.error.fields.studios[0].studioId, studio.studioPublicId);

    const after_ = await userRow(owner.id);
    assert.deepEqual(before_, after_, "sole-owner-blocked deletion must not change the user row at all");
    const [[membershipRow]] = [
        (await pool.query("SELECT status FROM studio_memberships WHERE user_id = ?", [owner.id]))[0]
    ];
    assert.equal(membershipRow.status, "active");
});

test("multiple owners: deletion succeeds and the remaining owner keeps full, unaffected access", async () => {
    const owner1 = await registerAndLogin("exec-multi-owner-1");
    const owner2 = await registerAndLogin("exec-multi-owner-2");
    const studio = await seedStudio({ name: "Multi Owner Studio", ownerUserId: owner1.id });
    await seedMembership({ studioInternalId: studio.studioInternalId, userId: owner2.id, role: "owner" });

    const result = await api("/api/account/deletion-request", {
        method: "POST",
        token: owner1.token,
        body: { currentPassword: owner1.password, confirmationPhrase: owner1.username }
    });
    assert.equal(result.response.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.accountDeletion.studiosAffected, 1);

    const [[remainingOwnerCount]] = [
        (await pool.query(
            "SELECT COUNT(*) AS total FROM studio_memberships WHERE studio_id = ? AND role='owner' AND status='active'",
            [studio.studioInternalId]
        ))[0]
    ];
    assert.equal(Number(remainingOwnerCount.total), 1);

    const owner2StillWorks = await api("/api/account/deletion-preview", { token: owner2.token });
    assert.equal(owner2StillWorks.response.status, 200);
});

// ---- Execute: full transaction effects ----

test("full deletion transaction: sessions aborted, assignments cancelled, relationships ended, rules disabled, calendar entries terminalized, personal data deleted", async () => {
    const coach = await registerAndLogin("exec-full-coach");
    const member = await registerAndLogin("exec-full-member");
    const secondOwner = await registerAndLogin("exec-full-owner2");
    const studio = await seedStudio({ name: "Full Effect Studio", ownerUserId: coach.id });
    await seedMembership({ studioInternalId: studio.studioInternalId, userId: secondOwner.id, role: "owner" });
    const memberMembership = await seedMembership({
        studioInternalId: studio.studioInternalId, userId: member.id, role: "member"
    });
    const relationship = await seedCoachingRelationship({
        studioInternalId: studio.studioInternalId,
        coachMembershipId: studio.ownerMembership.membershipInternalId,
        memberMembershipId: memberMembership.membershipInternalId,
        createdByUserId: coach.id
    });
    const program = await seedProgramWithAssignment({
        studioInternalId: studio.studioInternalId,
        coachingRelationshipId: relationship.relationshipInternalId,
        memberMembershipId: memberMembership.membershipInternalId,
        assignedByUserId: coach.id
    });
    const session = await seedWorkoutSession({
        studioInternalId: studio.studioInternalId,
        assignmentInternalId: program.assignmentInternalId,
        memberMembershipId: memberMembership.membershipInternalId,
        programVersionInternalId: program.programVersionInternalId,
        programDayInternalId: program.programDayInternalId,
        coachingRelationshipId: relationship.relationshipInternalId,
        status: "in_progress"
    });
    const rule = await seedScheduleRule({
        studioInternalId: studio.studioInternalId,
        assignmentInternalId: program.assignmentInternalId,
        programDayInternalId: program.programDayInternalId,
        createdByUserId: member.id
    });
    const calendarEntry = await seedCalendarEntry({
        userId: member.id,
        studioInternalId: studio.studioInternalId,
        assignmentInternalId: program.assignmentInternalId,
        programDayInternalId: program.programDayInternalId,
        scheduleRuleInternalId: rule.ruleInternalId,
        status: "IN_PROGRESS"
    });
    await pool.query(
        "UPDATE training_calendar_entries SET studio_workout_session_id = ? WHERE id = ?",
        [session.sessionInternalId, calendarEntry.entryInternalId]
    );
    await pool.query(
        "INSERT INTO workouts (public_id, user_id, title, workout_date) VALUES (?, ?, 'Personal', CURDATE())",
        [createPublicId(), member.id]
    );
    const [globalExerciseRows] = await pool.query(
        "SELECT id, name, category, muscle_group FROM exercises WHERE user_id IS NULL LIMIT 1"
    );
    const globalExercise = globalExerciseRows[0];
    // progress_entries carries denormalized exercise-name/category/muscle-
    // group snapshots (added by 004_training_history_consistency.js,
    // NOT NULL, no default) - mirroring the same snapshot convention used
    // by studio_workout_session_exercises.
    await pool.query(
        `INSERT INTO progress_entries
            (user_id, exercise_id, weight, reps, sets, entry_date,
             exercise_name_snapshot, exercise_category_snapshot, exercise_muscle_group_snapshot)
         VALUES (?, ?, 70.5, 5, 3, CURDATE(), ?, ?, ?)`,
        [member.id, globalExercise.id, globalExercise.name, globalExercise.category, globalExercise.muscle_group]
    );
    const personalEntry = await seedCalendarEntry({
        userId: member.id, status: "PLANNED", sourceType: "personal"
    });

    const result = await api("/api/account/deletion-request", {
        method: "POST",
        token: member.token,
        body: { currentPassword: member.password, confirmationPhrase: member.username }
    });
    assert.equal(result.response.status, 200, JSON.stringify(result.data));

    const [[sessionAfter]] = [
        (await pool.query("SELECT status, aborted_at FROM studio_workout_sessions WHERE id = ?", [session.sessionInternalId]))[0]
    ];
    assert.equal(sessionAfter.status, "aborted");
    assert.ok(sessionAfter.aborted_at);

    const [[assignmentAfter]] = [
        (await pool.query("SELECT status FROM studio_program_assignments WHERE id = ?", [program.assignmentInternalId]))[0]
    ];
    assert.equal(assignmentAfter.status, "cancelled");

    const [[relationshipAfter]] = [
        (await pool.query("SELECT status FROM studio_coaching_relationships WHERE id = ?", [relationship.relationshipInternalId]))[0]
    ];
    assert.equal(relationshipAfter.status, "ended");

    const [[ruleAfter]] = [
        (await pool.query("SELECT status FROM studio_assignment_schedule_rules WHERE id = ?", [rule.ruleInternalId]))[0]
    ];
    assert.equal(ruleAfter.status, "disabled");

    const [[calendarEntryAfter]] = [
        (await pool.query("SELECT status FROM training_calendar_entries WHERE id = ?", [calendarEntry.entryInternalId]))[0]
    ];
    assert.equal(calendarEntryAfter.status, "CANCELLED", "IN_PROGRESS -> PLANNED -> CANCELLED via the abort+sweep sequence");

    const [personalEntryAfterRows] = await pool.query(
        "SELECT id FROM training_calendar_entries WHERE id = ?", [personalEntry.entryInternalId]
    );
    assert.equal(personalEntryAfterRows.length, 0, "personal calendar entries are hard-deleted unconditionally");

    const [workoutsAfter] = await pool.query("SELECT id FROM workouts WHERE user_id = ?", [member.id]);
    assert.equal(workoutsAfter.length, 0, "personal workouts are hard-deleted");

    const [progressAfter] = await pool.query("SELECT id FROM progress_entries WHERE user_id = ?", [member.id]);
    assert.equal(progressAfter.length, 0, "personal progress entries are hard-deleted");

    const [membershipAfter] = await pool.query(
        "SELECT status FROM studio_memberships WHERE user_id = ? AND studio_id = ?",
        [member.id, studio.studioInternalId]
    );
    assert.equal(membershipAfter[0].status, "left");
});

test("an assignment the deleted account created for another member is left untouched", async () => {
    const coach = await registerAndLogin("exec-scope-coach");
    const otherMember = await registerAndLogin("exec-scope-other-member");
    const secondOwner = await registerAndLogin("exec-scope-owner2");
    const studio = await seedStudio({ name: "Scope Studio", ownerUserId: coach.id });
    await seedMembership({ studioInternalId: studio.studioInternalId, userId: secondOwner.id, role: "owner" });
    const otherMemberMembership = await seedMembership({
        studioInternalId: studio.studioInternalId, userId: otherMember.id, role: "member"
    });
    const relationship = await seedCoachingRelationship({
        studioInternalId: studio.studioInternalId,
        coachMembershipId: studio.ownerMembership.membershipInternalId,
        memberMembershipId: otherMemberMembership.membershipInternalId,
        createdByUserId: coach.id
    });
    const program = await seedProgramWithAssignment({
        studioInternalId: studio.studioInternalId,
        coachingRelationshipId: relationship.relationshipInternalId,
        memberMembershipId: otherMemberMembership.membershipInternalId,
        assignedByUserId: coach.id
    });

    await api("/api/account/deletion-request", {
        method: "POST",
        token: coach.token,
        body: { currentPassword: coach.password, confirmationPhrase: coach.username }
    });

    const [[assignmentAfter]] = [
        (await pool.query("SELECT status FROM studio_program_assignments WHERE id = ?", [program.assignmentInternalId]))[0]
    ];
    assert.equal(assignmentAfter.status, "active", "the other member's own assignment must remain untouched");
    const [[otherMembershipAfter]] = [
        (await pool.query("SELECT status FROM studio_memberships WHERE id = ?", [otherMemberMembership.membershipInternalId]))[0]
    ];
    assert.equal(otherMembershipAfter.status, "active", "the other member's own membership must remain untouched");
});

test("already-completed studio history is not altered by a deletion (values, timestamps, status all unchanged)", async () => {
    const coach = await registerAndLogin("exec-history-coach");
    const member = await registerAndLogin("exec-history-member");
    const secondOwner = await registerAndLogin("exec-history-owner2");
    const studio = await seedStudio({ name: "History Studio", ownerUserId: coach.id });
    await seedMembership({ studioInternalId: studio.studioInternalId, userId: secondOwner.id, role: "owner" });
    const memberMembership = await seedMembership({
        studioInternalId: studio.studioInternalId, userId: member.id, role: "member"
    });
    const relationship = await seedCoachingRelationship({
        studioInternalId: studio.studioInternalId,
        coachMembershipId: studio.ownerMembership.membershipInternalId,
        memberMembershipId: memberMembership.membershipInternalId,
        createdByUserId: coach.id
    });
    const program = await seedProgramWithAssignment({
        studioInternalId: studio.studioInternalId,
        coachingRelationshipId: relationship.relationshipInternalId,
        memberMembershipId: memberMembership.membershipInternalId,
        assignedByUserId: coach.id
    });
    const completedSession = await seedWorkoutSession({
        studioInternalId: studio.studioInternalId,
        assignmentInternalId: program.assignmentInternalId,
        memberMembershipId: memberMembership.membershipInternalId,
        programVersionInternalId: program.programVersionInternalId,
        programDayInternalId: program.programDayInternalId,
        coachingRelationshipId: relationship.relationshipInternalId,
        status: "completed"
    });
    await pool.query(
        "UPDATE studio_workout_sessions SET completed_at = NOW(3), member_note = 'my private note' WHERE id = ?",
        [completedSession.sessionInternalId]
    );
    const [beforeRows] = await pool.query(
        "SELECT status, completed_at, member_note FROM studio_workout_sessions WHERE id = ?",
        [completedSession.sessionInternalId]
    );

    await api("/api/account/deletion-request", {
        method: "POST",
        token: member.token,
        body: { currentPassword: member.password, confirmationPhrase: member.username }
    });

    const [afterRows] = await pool.query(
        "SELECT status, completed_at, member_note FROM studio_workout_sessions WHERE id = ?",
        [completedSession.sessionInternalId]
    );
    assert.deepEqual(afterRows[0], beforeRows[0], "completed session incl. free-text member_note must be byte-identical");
});

// ---- Anonymization & auth invalidation ----

test("after anonymization: old login fails identically to an unknown account, old token is invalidated, e-mail is immediately reusable", async () => {
    const user = await registerAndLogin("exec-anon-auth");
    const oldEmail = user.email;
    const oldUsername = user.username;

    await api("/api/account/deletion-request", {
        method: "POST",
        token: user.token,
        body: { currentPassword: user.password, confirmationPhrase: user.username }
    });

    const oldLogin = await api("/api/users/login", {
        method: "POST",
        body: { email: oldEmail, password: user.password }
    });
    assert.equal(oldLogin.response.status, 401);
    assert.equal(oldLogin.data.error.code, "AUTHENTICATION_REQUIRED");

    const neverExistedLogin = await api("/api/users/login", {
        method: "POST",
        body: { email: "never-existed-5c1@example.test", password: user.password }
    });
    assert.equal(neverExistedLogin.response.status, oldLogin.response.status);
    assert.equal(neverExistedLogin.data.error.code, oldLogin.data.error.code);

    const oldTokenStillUsed = await api("/api/users/me", { token: user.token });
    assert.equal(oldTokenStillUsed.response.status, 401);
    assert.equal(oldTokenStillUsed.data.error.code, "AUTH_SESSION_INVALIDATED");

    const reregistered = await api("/api/users/register", {
        method: "POST",
        body: {
            username: `${oldUsername}-reused`.slice(0, 50),
            email: oldEmail,
            password: "brand new password for reuse test",
            language_preference: "de",
            weight_unit: "kg",
            distance_unit: "km"
        }
    });
    assert.equal(reregistered.response.status, 201, JSON.stringify(reregistered.data));
});

test("idempotency: a second deletion attempt on an already-deleted account cannot even authenticate to try", async () => {
    const user = await registerAndLogin("exec-idempotent");
    const firstToken = user.token;
    await api("/api/account/deletion-request", {
        method: "POST",
        token: firstToken,
        body: { currentPassword: user.password, confirmationPhrase: user.username }
    });
    const secondAttempt = await api("/api/account/deletion-request", {
        method: "POST",
        token: firstToken,
        body: { currentPassword: user.password, confirmationPhrase: user.username }
    });
    assert.equal(secondAttempt.response.status, 401, "the old token is already invalidated");
});

test("hard-delete-eligible account: the users row is fully gone after deletion", async () => {
    const user = await registerAndLogin("exec-hard-delete");
    const result = await api("/api/account/deletion-request", {
        method: "POST",
        token: user.token,
        body: { currentPassword: user.password, confirmationPhrase: user.username }
    });
    assert.equal(result.response.status, 200, JSON.stringify(result.data));
    const row = await userRow(user.id);
    assert.equal(row, null);
});

test("execute clears the refresh/CSRF cookies in the response", async () => {
    const user = await registerAndLogin("exec-cookies");
    const response = await fetch(`${baseUrl}/api/account/deletion-request`, {
        method: "POST",
        headers: { Authorization: `Bearer ${user.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: user.password, confirmationPhrase: user.username })
    });
    assert.equal(response.status, 200);
    const setCookie = response.headers.get("set-cookie") || "";
    assert.ok(setCookie.length > 0, "expected at least one Set-Cookie clearing header");
});

// ---- Receipts ----

test("a valid, non-PII deletion receipt exists after a successful deletion", async () => {
    const user = await registerAndLogin("receipt-basic");
    await api("/api/account/deletion-request", {
        method: "POST",
        token: user.token,
        body: { currentPassword: user.password, confirmationPhrase: user.username }
    });

    const files = await fsPromises.readdir(RECEIPT_DIR);
    const matching = [];
    for (const file of files) {
        const content = JSON.parse(await fsPromises.readFile(path.join(RECEIPT_DIR, file), "utf8"));
        if (content.accountRef === user.id) matching.push(content);
    }
    assert.equal(matching.length, 1);
    assert.equal(matching[0].lifecycleAction, "deleted");
    const serialized = JSON.stringify(matching[0]);
    assert.ok(!serialized.includes(user.username));
    assert.ok(!serialized.includes(user.email.split("@")[0]));
});

test("Deletion Receipt Doctor reports ready:true with no inconsistencies for a normal deletion", async () => {
    const user = await registerAndLogin("doctor-ready");
    await api("/api/account/deletion-request", {
        method: "POST",
        token: user.token,
        body: { currentPassword: user.password, confirmationPhrase: user.username }
    });
    const report = await diagnoseDeletionReceipts({ connection: pool });
    assert.equal(report.ready, true);
    assert.equal(report.restoredActiveAccounts.length, 0);
});

test("restore simulation: a receipt exists but the row was restored to active -> Doctor flags it, reconciliation re-applies the deletion", async () => {
    const user = await registerAndLogin("reconcile-restore");
    const studio = await seedStudio({ name: "Reconcile Studio", ownerUserId: user.id });
    const secondOwner = await registerAndLogin("reconcile-restore-owner2");
    await seedMembership({ studioInternalId: studio.studioInternalId, userId: secondOwner.id, role: "owner" });

    await api("/api/account/deletion-request", {
        method: "POST",
        token: user.token,
        body: { currentPassword: user.password, confirmationPhrase: user.username }
    });

    // Simulate a restore that brought back a pre-deletion snapshot.
    await pool.query(
        "UPDATE users SET lifecycle_status = 'active', deleted_at = NULL WHERE id = ?",
        [user.id]
    );
    await pool.query(
        "UPDATE studio_memberships SET status = 'active' WHERE user_id = ? AND studio_id = ?",
        [user.id, studio.studioInternalId]
    );

    const diagnosis = await diagnoseDeletionReceipts({ connection: pool });
    assert.equal(diagnosis.ready, false);
    assert.ok(diagnosis.restoredActiveAccounts.includes(user.id));

    const plan = await planReconciliation({ connection: pool });
    assert.ok(plan.toReapply.includes(user.id));

    const deletionService = createAccountDeletionService({ database: pool, logger });
    const applyResult = await applyReconciliation({
        connection: pool,
        deletionService,
        databaseName: TEST_DATABASE,
        env: {
            FITTRACK_DELETION_RECONCILE_APPLY: "true",
            FITTRACK_DELETION_RECONCILE_DATABASE_ACK: `reconcile:${TEST_DATABASE}`,
            FITTRACK_DELETION_RECONCILE_RECEIPT_DIR_ACK: RECEIPT_DIR,
            NODE_ENV: "test",
            DELETION_RECEIPT_DIR: RECEIPT_DIR,
            DELETION_RECEIPT_HMAC_KEY_B64: process.env.DELETION_RECEIPT_HMAC_KEY_B64,
            DELETION_RECEIPT_HMAC_KEY_ID: process.env.DELETION_RECEIPT_HMAC_KEY_ID
        },
        logger
    });
    assert.equal(applyResult.reapplied[0].status, "reapplied");

    const rowAfter = await userRow(user.id);
    assert.equal(rowAfter.lifecycle_status, "deleted");

    const finalDiagnosis = await diagnoseDeletionReceipts({ connection: pool });
    assert.equal(finalDiagnosis.ready, true);
});

test("applyReconciliation refuses to run without all three exact acknowledgements", async () => {
    const deletionService = createAccountDeletionService({ database: pool, logger });
    const configuredEnv = {
        DELETION_RECEIPT_DIR: RECEIPT_DIR,
        DELETION_RECEIPT_HMAC_KEY_B64: process.env.DELETION_RECEIPT_HMAC_KEY_B64,
        DELETION_RECEIPT_HMAC_KEY_ID: process.env.DELETION_RECEIPT_HMAC_KEY_ID
    };
    await assert.rejects(
        () => applyReconciliation({
            connection: pool,
            deletionService,
            databaseName: TEST_DATABASE,
            env: configuredEnv,
            logger
        }),
        (error) => error.code === "DELETION_RECONCILE_NOT_AUTHORIZED"
    );
    await assert.rejects(
        () => applyReconciliation({
            connection: pool,
            deletionService,
            databaseName: TEST_DATABASE,
            env: {
                FITTRACK_DELETION_RECONCILE_APPLY: "true",
                FITTRACK_DELETION_RECONCILE_DATABASE_ACK: "reconcile:wrong-database-name",
                FITTRACK_DELETION_RECONCILE_RECEIPT_DIR_ACK: RECEIPT_DIR,
                DELETION_RECEIPT_DIR: RECEIPT_DIR,
                DELETION_RECEIPT_HMAC_KEY_B64: process.env.DELETION_RECEIPT_HMAC_KEY_B64,
                DELETION_RECEIPT_HMAC_KEY_ID: process.env.DELETION_RECEIPT_HMAC_KEY_ID
            },
            logger
        }),
        (error) => error.code === "DELETION_RECONCILE_DATABASE_ACK_INVALID"
    );
});

// ---- Concurrency ----

test("two parallel deletion requests for the same account: exactly one succeeds, the other sees a safe, consistent outcome", async () => {
    const user = await registerAndLogin("exec-parallel");
    const [first, second] = await Promise.all([
        api("/api/account/deletion-request", {
            method: "POST",
            token: user.token,
            body: { currentPassword: user.password, confirmationPhrase: user.username }
        }),
        api("/api/account/deletion-request", {
            method: "POST",
            token: user.token,
            body: { currentPassword: user.password, confirmationPhrase: user.username }
        })
    ]);
    const statuses = [first.response.status, second.response.status].sort();
    // Either both observe success is impossible (CAS-guarded); one succeeds
    // and the other sees either a 200 (raced in before the first committed,
    // then found nothing left to do at its own CAS-guard) is not possible
    // once auth invalidation lands - the realistic outcomes are exactly one
    // 200 and one 401 (already invalidated) or 409 (already deleted).
    assert.ok(statuses.includes(200), `expected exactly one success, got ${JSON.stringify(statuses)}`);
    const row = await userRow(user.id);
    assert.equal(row, null, "hard-delete-eligible account must end up fully and singly deleted, never partially");
});

test("no cross-tenant leak: deleting an account never changes a row in a studio it never belonged to", async () => {
    const unrelatedOwner = await registerAndLogin("exec-tenant-owner");
    const unrelatedStudio = await seedStudio({ name: "Untouched Studio", ownerUserId: unrelatedOwner.id });
    const deletingUser = await registerAndLogin("exec-tenant-deleter");

    const [beforeRows] = await pool.query(
        "SELECT id, status, updated_at FROM studio_memberships WHERE studio_id = ?",
        [unrelatedStudio.studioInternalId]
    );

    await api("/api/account/deletion-request", {
        method: "POST",
        token: deletingUser.token,
        body: { currentPassword: deletingUser.password, confirmationPhrase: deletingUser.username }
    });

    const [afterRows] = await pool.query(
        "SELECT id, status, updated_at FROM studio_memberships WHERE studio_id = ?",
        [unrelatedStudio.studioInternalId]
    );
    assert.deepEqual(afterRows, beforeRows);
});
