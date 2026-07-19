const { STUDIO_ROLES } = require("./studioDomain");
const { COACH_ELIGIBLE_ROLES } = require("./trainingProgramDomain");

const PERMISSIONS = Object.freeze({
    STUDIO_READ: "studio.read",
    STUDIO_SETTINGS_BASIC: "studio.settings.basic",
    STUDIO_SETTINGS_OWNER: "studio.settings.owner",
    MEMBERSHIP_READ_SELF: "membership.read.self",
    MEMBERSHIP_LIST: "membership.list",
    MEMBERSHIP_MANAGE: "membership.manage",
    INVITATION_LIST: "invitation.list",
    INVITATION_CREATE: "invitation.create",
    INVITATION_REVOKE: "invitation.revoke",
    AUDIT_READ: "audit.read",
    COACHING_LIST: "coaching.list",
    COACHING_MANAGE: "coaching.manage",
    PROGRAM_READ: "training_program.read",
    PROGRAM_MANAGE: "training_program.manage",
    PROGRAM_PUBLISH: "training_program.publish",
    ASSIGNMENT_LIST: "program_assignment.list",
    ASSIGNMENT_MANAGE: "program_assignment.manage",
    ASSIGNMENT_READ_SELF: "program_assignment.read.self"
});

const ROLE_PERMISSIONS = Object.freeze({
    owner: new Set(Object.values(PERMISSIONS)),
    admin: new Set([
        PERMISSIONS.STUDIO_READ,
        PERMISSIONS.STUDIO_SETTINGS_BASIC,
        PERMISSIONS.MEMBERSHIP_READ_SELF,
        PERMISSIONS.MEMBERSHIP_LIST,
        PERMISSIONS.MEMBERSHIP_MANAGE,
        PERMISSIONS.INVITATION_LIST,
        PERMISSIONS.INVITATION_CREATE,
        PERMISSIONS.INVITATION_REVOKE,
        PERMISSIONS.AUDIT_READ,
        PERMISSIONS.COACHING_LIST,
        PERMISSIONS.COACHING_MANAGE,
        PERMISSIONS.PROGRAM_READ,
        PERMISSIONS.PROGRAM_MANAGE,
        PERMISSIONS.PROGRAM_PUBLISH,
        PERMISSIONS.ASSIGNMENT_LIST,
        PERMISSIONS.ASSIGNMENT_MANAGE,
        PERMISSIONS.ASSIGNMENT_READ_SELF
    ]),
    trainer: new Set([
        PERMISSIONS.STUDIO_READ,
        PERMISSIONS.MEMBERSHIP_READ_SELF,
        PERMISSIONS.MEMBERSHIP_LIST,
        PERMISSIONS.COACHING_LIST,
        PERMISSIONS.PROGRAM_READ,
        PERMISSIONS.PROGRAM_MANAGE,
        PERMISSIONS.PROGRAM_PUBLISH,
        PERMISSIONS.ASSIGNMENT_LIST,
        PERMISSIONS.ASSIGNMENT_MANAGE,
        PERMISSIONS.ASSIGNMENT_READ_SELF
    ]),
    member: new Set([
        PERMISSIONS.STUDIO_READ,
        PERMISSIONS.MEMBERSHIP_READ_SELF,
        PERMISSIONS.ASSIGNMENT_READ_SELF
    ])
});

const ROLE_RANK = Object.freeze({ member: 1, trainer: 2, admin: 3, owner: 4 });

function hasStudioPermission(membership, permission) {
    if (!membership || membership.status !== "active") {
        return false;
    }
    const permissions = ROLE_PERMISSIONS[membership.role];
    return Boolean(permissions && permissions.has(permission));
}

function invitationRoleDecision(actorRole, invitationRole) {
    if (actorRole === "owner" && ["admin", "trainer", "member"].includes(invitationRole)) {
        return { allowed: true };
    }
    if (actorRole === "admin" && ["trainer", "member"].includes(invitationRole)) {
        return { allowed: true };
    }
    return { allowed: false, reason: "INVITATION_ROLE_FORBIDDEN" };
}

function leavesActiveOwnerSet(target, changes) {
    if (target.role !== "owner" || target.status !== "active") {
        return false;
    }
    const nextRole = changes.role ?? target.role;
    const nextStatus = changes.status ?? target.status;
    return nextRole !== "owner" || nextStatus !== "active";
}

function membershipChangeDecision({ actor, target, changes, activeOwnerCount }) {
    if (!actor || actor.status !== "active" || !STUDIO_ROLES.includes(actor.role)) {
        return { allowed: false, reason: "MEMBERSHIP_MANAGEMENT_FORBIDDEN" };
    }
    if (!target || !changes || Object.keys(changes).length === 0) {
        return { allowed: false, reason: "MEMBERSHIP_CHANGE_INVALID" };
    }
    if (["invited", "left"].includes(target.status)) {
        return { allowed: false, reason: "REJOIN_REQUIRES_INVITATION" };
    }

    const sameUser = Number(actor.userId) === Number(target.userId);
    const nextRole = changes.role ?? target.role;
    if (
        sameUser &&
        changes.role &&
        ROLE_RANK[nextRole] > ROLE_RANK[target.role]
    ) {
        return { allowed: false, reason: "SELF_PROMOTION_FORBIDDEN" };
    }

    if (actor.role === "admin") {
        if (
            !["trainer", "member"].includes(target.role) ||
            !["trainer", "member"].includes(nextRole)
        ) {
            return { allowed: false, reason: "ADMIN_TARGET_FORBIDDEN" };
        }
    } else if (actor.role !== "owner") {
        return { allowed: false, reason: "MEMBERSHIP_MANAGEMENT_FORBIDDEN" };
    }

    if (leavesActiveOwnerSet(target, changes) && activeOwnerCount <= 1) {
        return { allowed: false, reason: "LAST_ACTIVE_OWNER" };
    }

    return { allowed: true };
}

function studioPatchPermission(fields) {
    const ownerOnlyFields = new Set(["slug"]);
    return fields.some((field) => ownerOnlyFields.has(field))
        ? PERMISSIONS.STUDIO_SETTINGS_OWNER
        : PERMISSIONS.STUDIO_SETTINGS_BASIC;
}

function coachingRelationshipEligibility({ coachMembership, memberMembership }) {
    if (
        !coachMembership ||
        coachMembership.status !== "active" ||
        !COACH_ELIGIBLE_ROLES.includes(coachMembership.role)
    ) {
        return { allowed: false, reason: "COACH_MEMBERSHIP_INELIGIBLE" };
    }
    if (
        !memberMembership ||
        memberMembership.status !== "active" ||
        memberMembership.role !== "member"
    ) {
        return { allowed: false, reason: "MEMBER_MEMBERSHIP_INELIGIBLE" };
    }
    if (Number(coachMembership.internalId) === Number(memberMembership.internalId)) {
        return { allowed: false, reason: "COACH_MEMBER_SAME_MEMBERSHIP" };
    }
    return { allowed: true };
}

function canMutateProgramVersion(version) {
    return Boolean(version) && version.status === "draft";
}

function canPublishProgramVersion(version) {
    return Boolean(version) && version.status === "draft";
}

function canAssignProgramVersion({ program, version }) {
    if (!program || program.status === "archived") {
        return { allowed: false, reason: "PROGRAM_ARCHIVED" };
    }
    if (!version || version.status !== "published") {
        return { allowed: false, reason: "VERSION_NOT_PUBLISHED" };
    }
    return { allowed: true };
}

function coachActionEligibility({ actorRole, coachingRelationship }) {
    if (["owner", "admin"].includes(actorRole)) {
        return { allowed: true };
    }
    if (actorRole !== "trainer") {
        return { allowed: false, reason: "ASSIGNMENT_MANAGEMENT_FORBIDDEN" };
    }
    if (!coachingRelationship || coachingRelationship.status !== "active") {
        return { allowed: false, reason: "COACHING_RELATIONSHIP_REQUIRED" };
    }
    return { allowed: true };
}

module.exports = {
    PERMISSIONS,
    ROLE_PERMISSIONS,
    ROLE_RANK,
    canAssignProgramVersion,
    canMutateProgramVersion,
    canPublishProgramVersion,
    coachActionEligibility,
    coachingRelationshipEligibility,
    hasStudioPermission,
    invitationRoleDecision,
    leavesActiveOwnerSet,
    membershipChangeDecision,
    studioPatchPermission
};
