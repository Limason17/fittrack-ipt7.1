const { STUDIO_ROLES } = require("./studioDomain");

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
    AUDIT_READ: "audit.read"
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
        PERMISSIONS.AUDIT_READ
    ]),
    trainer: new Set([
        PERMISSIONS.STUDIO_READ,
        PERMISSIONS.MEMBERSHIP_READ_SELF,
        PERMISSIONS.MEMBERSHIP_LIST
    ]),
    member: new Set([
        PERMISSIONS.STUDIO_READ,
        PERMISSIONS.MEMBERSHIP_READ_SELF
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

module.exports = {
    PERMISSIONS,
    ROLE_PERMISSIONS,
    ROLE_RANK,
    hasStudioPermission,
    invitationRoleDecision,
    leavesActiveOwnerSet,
    membershipChangeDecision,
    studioPatchPermission
};
