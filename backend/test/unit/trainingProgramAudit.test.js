const test = require("node:test");
const assert = require("node:assert/strict");

const { allowlistedAuditDetails, buildAuditEvent, SAFE_DETAIL_KEYS } = require("../../audit/studioAudit");

const STUDIO_ID = 1;
const ACTOR_ID = 2;
const TARGET_ID = "123e4567-e89b-42d3-a456-426614174000";
const MEMBERSHIP_ID_A = "223e4567-e89b-42d3-a456-426614174000";
const MEMBERSHIP_ID_B = "323e4567-e89b-42d3-a456-426614174000";

test("Stage 1B.1 introduces exactly the required granular audit event types", () => {
    for (const eventType of [
        "coaching_relationship.created",
        "coaching_relationship.ended",
        "training_program.created",
        "training_program.updated",
        "training_program.archived",
        "training_program_version.created",
        "training_program_version.published",
        "training_program_assignment.created",
        "training_program_assignment.completed",
        "training_program_assignment.cancelled"
    ]) {
        assert.ok(Object.hasOwn(SAFE_DETAIL_KEYS, eventType), `${eventType} must have a safe detail contract`);
    }
});

test("coaching relationship audit events allowlist only the two membership public ids", () => {
    const details = { coachMembershipId: MEMBERSHIP_ID_A, memberMembershipId: MEMBERSHIP_ID_B };
    assert.deepEqual(allowlistedAuditDetails("coaching_relationship.created", details), details);
    assert.deepEqual(allowlistedAuditDetails("coaching_relationship.ended", details), details);
    assert.throws(
        () => allowlistedAuditDetails("coaching_relationship.created", { ...details, note: "off the record" }),
        /not allowlisted/
    );
    assert.throws(
        () => allowlistedAuditDetails("coaching_relationship.created", { coachMembershipId: "not-a-uuid", memberMembershipId: MEMBERSHIP_ID_B }),
        /invalid/
    );
});

test("training program audit details allowlist name on create and a bounded field list on update", () => {
    assert.deepEqual(allowlistedAuditDetails("training_program.created", { name: "Beginner Strength" }), { name: "Beginner Strength" });
    assert.deepEqual(
        allowlistedAuditDetails("training_program.updated", { fields: ["name", "description"] }),
        { fields: ["name", "description"] }
    );
    assert.throws(
        () => allowlistedAuditDetails("training_program.updated", { fields: ["status"] }),
        /invalid/,
        "status is a transition, not a plain field edit, and must not be listed here"
    );
    assert.throws(() => allowlistedAuditDetails("training_program.created", { name: "" }), /invalid/);
    assert.deepEqual(allowlistedAuditDetails("training_program.archived", {}), {});
});

test("version audit events allowlist only a positive version number", () => {
    assert.deepEqual(allowlistedAuditDetails("training_program_version.created", { versionNumber: 1 }), { versionNumber: 1 });
    assert.deepEqual(allowlistedAuditDetails("training_program_version.published", { versionNumber: 3 }), { versionNumber: 3 });
    assert.throws(() => allowlistedAuditDetails("training_program_version.created", { versionNumber: 0 }), /invalid/);
    assert.throws(() => allowlistedAuditDetails("training_program_version.created", { versionNumber: 1.5 }), /invalid/);
});

test("assignment audit events never carry training results, only the member public id (and version number on create)", () => {
    assert.deepEqual(
        allowlistedAuditDetails("training_program_assignment.created", { memberMembershipId: MEMBERSHIP_ID_A, versionNumber: 2 }),
        { memberMembershipId: MEMBERSHIP_ID_A, versionNumber: 2 }
    );
    assert.deepEqual(
        allowlistedAuditDetails("training_program_assignment.completed", { memberMembershipId: MEMBERSHIP_ID_A }),
        { memberMembershipId: MEMBERSHIP_ID_A }
    );
    for (const forbidden of ["weight", "reps", "notes", "result", "requestBody"]) {
        assert.throws(
            () => allowlistedAuditDetails("training_program_assignment.completed", { memberMembershipId: MEMBERSHIP_ID_A, [forbidden]: "x" }),
            /not allowlisted/,
            `${forbidden} must never be an allowlisted assignment audit detail`
        );
    }
});

test("buildAuditEvent produces a well-formed, sanitized event for a Stage 1B.1 event type", () => {
    const event = buildAuditEvent({
        studioId: STUDIO_ID,
        actorUserId: ACTOR_ID,
        eventType: "training_program_assignment.created",
        targetType: "program_assignment",
        targetPublicId: TARGET_ID,
        details: { memberMembershipId: MEMBERSHIP_ID_A, versionNumber: 1 }
    });
    assert.equal(event.eventType, "training_program_assignment.created");
    assert.equal(event.targetPublicId, TARGET_ID);
    assert.deepEqual(JSON.parse(event.detailsJson), { memberMembershipId: MEMBERSHIP_ID_A, versionNumber: 1 });
    assert.doesNotMatch(event.detailsJson, /password|token|secret/i);
});

test("buildAuditEvent rejects an event type without a registered detail contract", () => {
    assert.throws(
        () => buildAuditEvent({
            studioId: STUDIO_ID,
            actorUserId: ACTOR_ID,
            eventType: "training_program.deleted",
            targetType: "training_program",
            targetPublicId: TARGET_ID,
            details: {}
        }),
        /safe detail contract/
    );
});
