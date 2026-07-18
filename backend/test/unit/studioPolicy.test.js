const test = require("node:test");
const assert = require("node:assert/strict");

const {
    PERMISSIONS,
    hasStudioPermission,
    invitationRoleDecision,
    membershipChangeDecision,
    studioPatchPermission
} = require("../../domain/studioPolicy");

function membership(role, overrides = {}) {
    return { userId: overrides.userId || 1, role, status: "active", ...overrides };
}

test("studio permissions default deny and inactive memberships have no access", () => {
    assert.equal(hasStudioPermission(membership("owner"), PERMISSIONS.AUDIT_READ), true);
    assert.equal(hasStudioPermission(membership("admin"), PERMISSIONS.AUDIT_READ), true);
    assert.equal(hasStudioPermission(membership("trainer"), PERMISSIONS.STUDIO_READ), true);
    assert.equal(hasStudioPermission(membership("trainer"), PERMISSIONS.MEMBERSHIP_LIST), true);
    assert.equal(hasStudioPermission(membership("member"), PERMISSIONS.MEMBERSHIP_READ_SELF), true);
    assert.equal(hasStudioPermission(membership("trainer"), PERMISSIONS.INVITATION_CREATE), false);
    assert.equal(hasStudioPermission(membership("member"), "unknown.permission"), false);
    assert.equal(hasStudioPermission(membership("owner", { status: "suspended" }), PERMISSIONS.STUDIO_READ), false);
    assert.equal(hasStudioPermission(membership("owner", { status: "left" }), PERMISSIONS.STUDIO_READ), false);
});

test("owner and admin invitation roles follow the bounded matrix", () => {
    assert.equal(invitationRoleDecision("owner", "admin").allowed, true);
    assert.equal(invitationRoleDecision("owner", "owner").allowed, false);
    assert.equal(invitationRoleDecision("admin", "trainer").allowed, true);
    assert.equal(invitationRoleDecision("admin", "member").allowed, true);
    assert.equal(invitationRoleDecision("admin", "admin").allowed, false);
    assert.equal(invitationRoleDecision("trainer", "member").allowed, false);
});

test("membership changes protect owners, admins, and self-promotion", () => {
    const owner = membership("owner", { userId: 1 });
    const otherOwner = membership("owner", { userId: 2 });
    const trainer = membership("trainer", { userId: 3 });

    assert.deepEqual(membershipChangeDecision({
        actor: owner,
        target: owner,
        changes: { role: "admin" },
        activeOwnerCount: 1
    }), { allowed: false, reason: "LAST_ACTIVE_OWNER" });

    assert.equal(membershipChangeDecision({
        actor: owner,
        target: otherOwner,
        changes: { status: "suspended" },
        activeOwnerCount: 2
    }).allowed, true);

    assert.equal(membershipChangeDecision({
        actor: owner,
        target: trainer,
        changes: { role: "owner" },
        activeOwnerCount: 1
    }).allowed, true);

    assert.equal(membershipChangeDecision({
        actor: membership("admin", { userId: 4 }),
        target: trainer,
        changes: { role: "member" },
        activeOwnerCount: 1
    }).allowed, true);

    assert.equal(membershipChangeDecision({
        actor: membership("admin", { userId: 4 }),
        target: otherOwner,
        changes: { status: "suspended" },
        activeOwnerCount: 2
    }).reason, "ADMIN_TARGET_FORBIDDEN");

    assert.equal(membershipChangeDecision({
        actor: membership("member", { userId: 5 }),
        target: membership("member", { userId: 5 }),
        changes: { role: "trainer" },
        activeOwnerCount: 1
    }).reason, "SELF_PROMOTION_FORBIDDEN");

    for (const status of ["invited", "left"]) {
        assert.equal(membershipChangeDecision({
            actor: owner,
            target: membership("member", { userId: 6, status }),
            changes: { status: "active" },
            activeOwnerCount: 1
        }).reason, "REJOIN_REQUIRES_INVITATION");
    }
});

test("slug changes are owner settings while ordinary defaults are basic settings", () => {
    assert.equal(studioPatchPermission(["slug"]), PERMISSIONS.STUDIO_SETTINGS_OWNER);
    assert.equal(
        studioPatchPermission(["name", "default_locale"]),
        PERMISSIONS.STUDIO_SETTINGS_BASIC
    );
});
