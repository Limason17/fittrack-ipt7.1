const test = require("node:test");
const assert = require("node:assert/strict");

const {
    PERMISSIONS,
    ROLE_PERMISSIONS,
    canAssignProgramVersion,
    canMutateProgramVersion,
    canPublishProgramVersion,
    coachActionEligibility,
    coachingRelationshipEligibility,
    hasStudioPermission
} = require("../../domain/studioPolicy");

function membership(role, status = "active", internalId = 1) {
    return { role, status, internalId };
}

test("coachingRelationshipEligibility requires an active owner/admin/trainer coach and an active member", () => {
    assert.deepEqual(
        coachingRelationshipEligibility({
            coachMembership: membership("trainer", "active", 1),
            memberMembership: membership("member", "active", 2)
        }),
        { allowed: true }
    );

    assert.equal(
        coachingRelationshipEligibility({
            coachMembership: membership("member", "active", 1),
            memberMembership: membership("member", "active", 2)
        }).allowed,
        false,
        "a member cannot be a coach"
    );

    assert.equal(
        coachingRelationshipEligibility({
            coachMembership: membership("trainer", "suspended", 1),
            memberMembership: membership("member", "active", 2)
        }).allowed,
        false,
        "a suspended coach is ineligible"
    );

    assert.equal(
        coachingRelationshipEligibility({
            coachMembership: membership("trainer", "active", 1),
            memberMembership: membership("trainer", "active", 2)
        }).allowed,
        false,
        "the target must hold the member role, not another trainer"
    );

    assert.equal(
        coachingRelationshipEligibility({
            coachMembership: membership("trainer", "active", 1),
            memberMembership: membership("member", "left", 2)
        }).allowed,
        false,
        "a member who left is ineligible"
    );
});

test("coachingRelationshipEligibility rejects a coach and member that are the same membership", () => {
    const decision = coachingRelationshipEligibility({
        coachMembership: membership("owner", "active", 5),
        memberMembership: membership("member", "active", 5)
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, "COACH_MEMBER_SAME_MEMBERSHIP");
});

test("owner and admin are eligible coaches; trainer is eligible; member is not", () => {
    for (const role of ["owner", "admin", "trainer"]) {
        assert.equal(
            coachingRelationshipEligibility({
                coachMembership: membership(role, "active", 1),
                memberMembership: membership("member", "active", 2)
            }).allowed,
            true,
            `${role} should be an eligible coach`
        );
    }
});

test("program version mutation and publication require a draft version", () => {
    assert.equal(canMutateProgramVersion({ status: "draft" }), true);
    assert.equal(canMutateProgramVersion({ status: "published" }), false);
    assert.equal(canMutateProgramVersion({ status: "retired" }), false);
    assert.equal(canMutateProgramVersion(null), false);

    assert.equal(canPublishProgramVersion({ status: "draft" }), true);
    assert.equal(canPublishProgramVersion({ status: "published" }), false);
});

test("canAssignProgramVersion requires a published version on a non-archived program", () => {
    assert.deepEqual(
        canAssignProgramVersion({ program: { status: "active" }, version: { status: "published" } }),
        { allowed: true }
    );
    assert.equal(
        canAssignProgramVersion({ program: { status: "archived" }, version: { status: "published" } }).reason,
        "PROGRAM_ARCHIVED"
    );
    assert.equal(
        canAssignProgramVersion({ program: { status: "active" }, version: { status: "draft" } }).reason,
        "VERSION_NOT_PUBLISHED"
    );
});

test("coachActionEligibility always allows owner/admin and requires an active relationship for trainers", () => {
    assert.equal(coachActionEligibility({ actorRole: "owner", coachingRelationship: null }).allowed, true);
    assert.equal(coachActionEligibility({ actorRole: "admin", coachingRelationship: null }).allowed, true);
    assert.equal(coachActionEligibility({ actorRole: "member", coachingRelationship: { status: "active" } }).allowed, false);
    assert.equal(
        coachActionEligibility({ actorRole: "trainer", coachingRelationship: { status: "active" } }).allowed,
        true
    );
    assert.equal(
        coachActionEligibility({ actorRole: "trainer", coachingRelationship: { status: "ended" } }).allowed,
        false,
        "an ended relationship must not authorize the trainer"
    );
    assert.equal(
        coachActionEligibility({ actorRole: "trainer", coachingRelationship: null }).allowed,
        false
    );
});

test("role permission matrix grants the exact Stage 1B.1 capabilities per role", () => {
    assert.ok(ROLE_PERMISSIONS.owner.has(PERMISSIONS.COACHING_MANAGE));
    assert.ok(ROLE_PERMISSIONS.admin.has(PERMISSIONS.COACHING_MANAGE));
    assert.ok(!ROLE_PERMISSIONS.trainer.has(PERMISSIONS.COACHING_MANAGE), "trainers cannot manage coaching relationships");
    assert.ok(!ROLE_PERMISSIONS.member.has(PERMISSIONS.COACHING_MANAGE));

    assert.ok(ROLE_PERMISSIONS.trainer.has(PERMISSIONS.PROGRAM_MANAGE), "trainers can create/edit programs");
    assert.ok(ROLE_PERMISSIONS.trainer.has(PERMISSIONS.PROGRAM_PUBLISH));
    assert.ok(!ROLE_PERMISSIONS.member.has(PERMISSIONS.PROGRAM_READ), "members cannot browse the program catalog");
    assert.ok(!ROLE_PERMISSIONS.member.has(PERMISSIONS.PROGRAM_MANAGE));

    assert.ok(ROLE_PERMISSIONS.trainer.has(PERMISSIONS.ASSIGNMENT_MANAGE));
    assert.ok(!ROLE_PERMISSIONS.member.has(PERMISSIONS.ASSIGNMENT_MANAGE));
    assert.ok(ROLE_PERMISSIONS.member.has(PERMISSIONS.ASSIGNMENT_READ_SELF), "members can read their own assignments");
    assert.ok(ROLE_PERMISSIONS.trainer.has(PERMISSIONS.ASSIGNMENT_READ_SELF));
});

test("hasStudioPermission is default-deny for inactive memberships across the new permissions", () => {
    for (const permission of [
        PERMISSIONS.COACHING_LIST,
        PERMISSIONS.PROGRAM_READ,
        PERMISSIONS.ASSIGNMENT_READ_SELF
    ]) {
        assert.equal(hasStudioPermission({ role: "owner", status: "suspended" }, permission), false);
        assert.equal(hasStudioPermission(null, permission), false);
    }
});
