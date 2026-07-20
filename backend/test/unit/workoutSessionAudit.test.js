const test = require("node:test");
const assert = require("node:assert/strict");

const { allowlistedAuditDetails, buildAuditEvent, SAFE_DETAIL_KEYS } = require("../../audit/studioAudit");

const STUDIO_ID = 1;
const ACTOR_ID = 2;
const TARGET_ID = "123e4567-e89b-42d3-a456-426614174000";
const ASSIGNMENT_ID = "223e4567-e89b-42d3-a456-426614174000";
const PROGRAM_DAY_ID = "323e4567-e89b-42d3-a456-426614174000";
const SESSION_ID = "423e4567-e89b-42d3-a456-426614174000";
const FEEDBACK_ID = "523e4567-e89b-42d3-a456-426614174000";

test("Stage 1B.2B1 introduces exactly the required workout session audit event types", () => {
    for (const eventType of ["workout_session.started", "workout_session.completed", "workout_session.aborted"]) {
        assert.ok(Object.hasOwn(SAFE_DETAIL_KEYS, eventType), `${eventType} must have a safe detail contract`);
    }
});

test("workout_session.started allowlists only assignmentId, programDayId and versionNumber", () => {
    const details = { assignmentId: ASSIGNMENT_ID, programDayId: PROGRAM_DAY_ID, versionNumber: 2 };
    assert.deepEqual(allowlistedAuditDetails("workout_session.started", details), details);
    assert.deepEqual(
        allowlistedAuditDetails("workout_session.started", { assignmentId: ASSIGNMENT_ID, programDayId: PROGRAM_DAY_ID }),
        { assignmentId: ASSIGNMENT_ID, programDayId: PROGRAM_DAY_ID },
        "versionNumber is optional"
    );
    assert.throws(
        () => allowlistedAuditDetails("workout_session.started", { ...details, note: "off the record" }),
        /not allowlisted/
    );
    assert.throws(
        () => allowlistedAuditDetails("workout_session.started", { assignmentId: "not-a-uuid", programDayId: PROGRAM_DAY_ID }),
        /invalid/
    );
});

test("workout_session.completed and workout_session.aborted carry no details at all", () => {
    assert.deepEqual(allowlistedAuditDetails("workout_session.completed", {}), {});
    assert.deepEqual(allowlistedAuditDetails("workout_session.aborted", {}), {});
});

test("workout session audit events never allowlist any performance metric or free-text field", () => {
    for (const eventType of ["workout_session.started", "workout_session.completed", "workout_session.aborted"]) {
        for (const forbidden of [
            "weight", "reps", "rpe", "distance", "duration", "notes", "memberNote",
            "actualReps", "actualWeight", "result", "requestBody", "body"
        ]) {
            assert.throws(
                () => allowlistedAuditDetails(eventType, { [forbidden]: "x" }),
                /not allowlisted/,
                `${forbidden} must never be an allowlisted ${eventType} audit detail`
            );
        }
    }
});

test("buildAuditEvent produces a well-formed, sanitized event for workout_session.started", () => {
    const event = buildAuditEvent({
        studioId: STUDIO_ID,
        actorUserId: ACTOR_ID,
        eventType: "workout_session.started",
        targetType: "workout_session",
        targetPublicId: TARGET_ID,
        details: { assignmentId: ASSIGNMENT_ID, programDayId: PROGRAM_DAY_ID }
    });
    assert.equal(event.eventType, "workout_session.started");
    assert.equal(event.targetPublicId, TARGET_ID);
    assert.deepEqual(JSON.parse(event.detailsJson), { assignmentId: ASSIGNMENT_ID, programDayId: PROGRAM_DAY_ID });
    assert.doesNotMatch(event.detailsJson, /password|token|secret/i);
});

test("buildAuditEvent produces empty-detail events for completion and abort", () => {
    for (const eventType of ["workout_session.completed", "workout_session.aborted"]) {
        const event = buildAuditEvent({
            studioId: STUDIO_ID,
            actorUserId: ACTOR_ID,
            eventType,
            targetType: "workout_session",
            targetPublicId: TARGET_ID,
            details: {}
        });
        assert.equal(event.detailsJson, "{}");
    }
});

test("Stage 1B.2B2B introduces the workout_feedback.created audit event type", () => {
    assert.ok(Object.hasOwn(SAFE_DETAIL_KEYS, "workout_feedback.created"));
});

test("workout_feedback.created allowlists only feedbackId and sessionId, both public UUIDs", () => {
    const details = { feedbackId: FEEDBACK_ID, sessionId: SESSION_ID };
    assert.deepEqual(allowlistedAuditDetails("workout_feedback.created", details), details);
    assert.throws(
        () => allowlistedAuditDetails("workout_feedback.created", { ...details, note: "off the record" }),
        /not allowlisted/
    );
    assert.throws(
        () => allowlistedAuditDetails("workout_feedback.created", { feedbackId: "not-a-uuid", sessionId: SESSION_ID }),
        /invalid/
    );
    assert.throws(
        () => allowlistedAuditDetails("workout_feedback.created", { feedbackId: FEEDBACK_ID, sessionId: "not-a-uuid" }),
        /invalid/
    );
});

test("workout_feedback.created never allowlists the feedback text or any training metric", () => {
    for (const forbidden of [
        "body", "text", "message", "weight", "reps", "rpe", "distance", "duration",
        "notes", "memberNote", "actualReps", "actualWeight", "requestBody"
    ]) {
        assert.throws(
            () => allowlistedAuditDetails("workout_feedback.created", { feedbackId: FEEDBACK_ID, sessionId: SESSION_ID, [forbidden]: "x" }),
            /not allowlisted/,
            `${forbidden} must never be an allowlisted workout_feedback.created audit detail`
        );
    }
});

test("buildAuditEvent produces a well-formed, sanitized event for workout_feedback.created", () => {
    const event = buildAuditEvent({
        studioId: STUDIO_ID,
        actorUserId: ACTOR_ID,
        eventType: "workout_feedback.created",
        targetType: "workout_session_feedback",
        targetPublicId: FEEDBACK_ID,
        details: { feedbackId: FEEDBACK_ID, sessionId: SESSION_ID }
    });
    assert.equal(event.eventType, "workout_feedback.created");
    assert.equal(event.targetPublicId, FEEDBACK_ID);
    assert.deepEqual(JSON.parse(event.detailsJson), { feedbackId: FEEDBACK_ID, sessionId: SESSION_ID });
    assert.doesNotMatch(event.detailsJson, /password|token|secret/i);
});
