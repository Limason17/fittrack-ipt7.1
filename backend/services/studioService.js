const {
    AppError,
    ConflictError,
    NotFoundError
} = require("../errors/AppError");
const {
    InsufficientStudioRoleError,
    InvitationInvalidError,
    LastOwnerRequiredError,
    MembershipNotFoundError,
    StudioNotFoundError
} = require("../errors/StudioErrors");
const {
    allowlistedAuditDetails,
    buildAuditEvent
} = require("../audit/studioAudit");
const { createPublicId } = require("../domain/studioDomain");
const {
    PERMISSIONS,
    hasStudioPermission,
    invitationRoleDecision,
    membershipChangeDecision,
    studioPatchPermission
} = require("../domain/studioPolicy");
const { createInvitationOutbox } = require("../outbox/invitationOutbox");
const {
    createInvitationToken,
    hashInvitationToken
} = require("../security/invitationTokens");

const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const STUDIO_UPDATE_COLUMNS = Object.freeze({
    name: "name",
    slug: "slug",
    default_locale: "default_locale",
    default_timezone: "default_timezone",
    default_weight_unit: "default_weight_unit"
});
const MEMBERSHIP_UPDATE_COLUMNS = Object.freeze({
    role: "role",
    status: "status"
});
const MEMBERSHIP_STATUS_EVENT_TYPES = Object.freeze({
    suspended: "membership.suspended",
    left: "membership.left",
    active: "membership.reactivated"
});
const PUBLIC_STUDIO_FIELDS = Object.freeze({
    name: "name",
    slug: "slug",
    default_locale: "defaultLocale",
    default_timezone: "defaultTimezone",
    default_weight_unit: "defaultWeightUnit"
});

function applicationError(status, code, message) {
    return new AppError({ status, code, message });
}

function studioNotFound() {
    return new StudioNotFoundError();
}

function membershipNotFound() {
    return new MembershipNotFoundError();
}

function invitationNotFound() {
    return new InvitationInvalidError();
}

function invitationStateError(status) {
    const states = {
        accepted: [409, "INVITATION_ALREADY_USED", "Invitation has already been used."],
        revoked: [409, "INVITATION_REVOKED", "Invitation has been revoked."],
        expired: [410, "INVITATION_EXPIRED", "Invitation has expired."]
    };
    const [httpStatus, code, message] = states[status] || [409, "INVITATION_NOT_PENDING", "Invitation is not pending."];
    return applicationError(httpStatus, code, message);
}

function assertPermission(membership, permission) {
    if (!hasStudioPermission(membership, permission)) {
        throw new InsufficientStudioRoleError();
    }
}

function promiseDatabase(database) {
    return typeof database.promise === "function" ? database.promise() : database;
}

function studioFromRow(row) {
    return {
        internalId: Number(row.studio_internal_id ?? row.id),
        id: row.studio_public_id ?? row.public_id,
        name: row.name,
        slug: row.slug,
        status: row.studio_status ?? row.status,
        default_locale: row.default_locale,
        default_timezone: row.default_timezone,
        default_weight_unit: row.default_weight_unit,
        created_at: row.studio_created_at ?? row.created_at,
        updated_at: row.studio_updated_at ?? row.updated_at
    };
}

function membershipFromRow(row) {
    return {
        internalId: Number(row.membership_internal_id ?? row.id),
        id: row.membership_public_id ?? row.public_id,
        userId: Number(row.user_id),
        role: row.membership_role ?? row.role,
        status: row.membership_status ?? row.status,
        joined_at: row.joined_at,
        created_at: row.membership_created_at ?? row.created_at,
        updated_at: row.membership_updated_at ?? row.updated_at,
        user: row.display_name !== undefined
            ? { displayName: row.display_name }
            : row.username === undefined
                ? undefined
                : { username: row.username, email: row.email }
    };
}

function publicStudio(studio) {
    return {
        id: studio.id,
        name: studio.name,
        slug: studio.slug,
        status: studio.status,
        defaultLocale: studio.default_locale,
        defaultTimezone: studio.default_timezone,
        defaultWeightUnit: studio.default_weight_unit,
        createdAt: studio.created_at,
        updatedAt: studio.updated_at
    };
}

function publicMembership(membership) {
    const publicUser = membership.status === "left"
        ? (membership.user ? { displayName: "Former member" } : undefined)
        : membership.user;
    return {
        id: membership.id,
        role: membership.role,
        status: membership.status,
        joinedAt: membership.joined_at,
        createdAt: membership.created_at,
        updatedAt: membership.updated_at,
        ...(publicUser ? { user: publicUser } : {})
    };
}

function publicStudioContext(context) {
    return {
        ...publicStudio(context.studio),
        membership: publicMembership(context.membership)
    };
}

function publicInvitation(row, now = new Date()) {
    const expired = row.status === "pending" && new Date(row.expires_at).getTime() <= now.getTime();
    const status = expired ? "expired" : row.status;
    return {
        id: row.public_id,
        role: row.role,
        status,
        expiresAt: row.expires_at,
        acceptedAt: row.accepted_at,
        createdAt: row.created_at,
        revokedAt: row.revoked_at,
        invitedBy: row.invited_by_username ? { username: row.invited_by_username } : null,
        // Still shown for 'expired', not just 'pending': an expired invitation
        // remains resend-actionable (see resendInvitation), so the admin
        // needs to see who it is for. Only truly terminal states (accepted,
        // revoked) redact the e-mail from here on.
        ...(status === "pending" || status === "expired" ? { email: row.email_normalized } : {})
    };
}

function paginationResult(total, { page, limit }) {
    return {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit)
    };
}

function parseDetails(value, eventType) {
    if (value === null || value === undefined || value === "") return {};
    try {
        const parsed = typeof value === "object" ? value : JSON.parse(value);
        return allowlistedAuditDetails(eventType, parsed);
    } catch (error) {
        return {};
    }
}

function membershipChangeAuditEvents(target, changes) {
    const before = { role: target.role, status: target.status };
    const after = {
        role: changes.role ?? target.role,
        status: changes.status ?? target.status
    };
    const events = [];
    if (Object.hasOwn(changes, "role")) {
        events.push({ eventType: "membership.role_changed", details: { before, after } });
    }
    if (Object.hasOwn(changes, "status")) {
        events.push({
            eventType: MEMBERSHIP_STATUS_EVENT_TYPES[changes.status],
            details: { before, after }
        });
    }
    return events;
}

function updateStatement(changes, columns) {
    if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
        throw applicationError(400, "INVALID_SERVICE_INPUT", "Update fields are invalid.");
    }
    const fields = Object.keys(changes);
    if (fields.length === 0 || fields.some((field) => !Object.hasOwn(columns, field))) {
        throw applicationError(400, "INVALID_SERVICE_INPUT", "Update fields are invalid.");
    }
    return {
        fields,
        assignments: fields.map((field) => `${columns[field]} = ?`).join(", "),
        values: fields.map((field) => changes[field])
    };
}

function createStudioService({
    database,
    outbox = createInvitationOutbox(),
    now = () => new Date(),
    generatePublicId = createPublicId,
    generateInvitationToken = createInvitationToken,
    hashToken = hashInvitationToken
} = {}) {
    if (!database) {
        throw new TypeError("Studio service requires a database.");
    }
    const sql = promiseDatabase(database);

    async function insertAudit(connection, values) {
        const event = buildAuditEvent(values);
        await connection.query(
            `INSERT INTO studio_audit_events (
                public_id, studio_id, actor_user_id, event_type,
                target_type, target_public_id, details_json
             ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                event.publicId,
                event.studioId,
                event.actorUserId,
                event.eventType,
                event.targetType,
                event.targetPublicId,
                event.detailsJson
            ]
        );
        return event;
    }

    async function begin() {
        const connection = await sql.getConnection();
        try {
            await connection.beginTransaction();
            return connection;
        } catch (error) {
            connection.release();
            throw error;
        }
    }

    async function rollbackAndRelease(connection) {
        try {
            await connection.rollback();
        } finally {
            connection.release();
        }
    }

    async function lockStudio(connection, studioInternalId) {
        const [rows] = await connection.query(
            `SELECT id AS studio_internal_id, public_id AS studio_public_id,
                    name, slug, status AS studio_status,
                    default_locale, default_timezone, default_weight_unit,
                    created_at AS studio_created_at, updated_at AS studio_updated_at
             FROM studios
             WHERE id = ?
             FOR UPDATE`,
            [studioInternalId]
        );
        if (rows.length === 0 || rows[0].studio_status !== "active") {
            throw studioNotFound();
        }
        return studioFromRow(rows[0]);
    }

    async function lockActorMembership(connection, studio, actorUserId) {
        const [rows] = await connection.query(
            `SELECT id AS membership_internal_id, public_id AS membership_public_id,
                    user_id, role AS membership_role, status AS membership_status,
                    joined_at, created_at AS membership_created_at,
                    updated_at AS membership_updated_at
             FROM studio_memberships
             WHERE studio_id = ? AND user_id = ?
             FOR UPDATE`,
            [studio.internalId, actorUserId]
        );
        if (rows.length === 0 || rows[0].membership_status !== "active") {
            throw studioNotFound();
        }
        return membershipFromRow(rows[0]);
    }

    async function readStudioContextInTransaction(connection, studioInternalId, actorUserId) {
        const [rows] = await connection.query(
            `SELECT s.id AS studio_internal_id, s.public_id AS studio_public_id,
                    s.name, s.slug, s.status AS studio_status,
                    s.default_locale, s.default_timezone, s.default_weight_unit,
                    s.created_at AS studio_created_at, s.updated_at AS studio_updated_at,
                    sm.id AS membership_internal_id,
                    sm.public_id AS membership_public_id, sm.user_id,
                    sm.role AS membership_role, sm.status AS membership_status,
                    sm.joined_at, sm.created_at AS membership_created_at,
                    sm.updated_at AS membership_updated_at
             FROM studios s
             INNER JOIN studio_memberships sm ON sm.studio_id = s.id
             WHERE s.id = ? AND sm.user_id = ?
             LIMIT 1`,
            [studioInternalId, actorUserId]
        );
        if (rows.length === 0) throw studioNotFound();
        return {
            studio: studioFromRow(rows[0]),
            membership: membershipFromRow(rows[0])
        };
    }

    async function readMembershipInTransaction(connection, studioInternalId, membershipInternalId) {
        const [rows] = await connection.query(
            `SELECT sm.id AS membership_internal_id,
                    sm.public_id AS membership_public_id, sm.user_id,
                    sm.role AS membership_role, sm.status AS membership_status,
                    sm.joined_at, sm.created_at AS membership_created_at,
                    sm.updated_at AS membership_updated_at,
                    CASE WHEN sm.status = 'left' THEN NULL ELSE u.username END AS username,
                    CASE WHEN sm.status = 'left' THEN NULL ELSE u.email END AS email
             FROM studio_memberships sm
             INNER JOIN users u ON u.id = sm.user_id
             WHERE sm.studio_id = ? AND sm.id = ?
             LIMIT 1`,
            [studioInternalId, membershipInternalId]
        );
        if (rows.length === 0) throw membershipNotFound();
        return membershipFromRow(rows[0]);
    }

    async function withLockedStudioAccess(context, permission, operation) {
        const connection = await begin();
        let result;
        try {
            const studio = await lockStudio(connection, context.studio.internalId);
            const actor = await lockActorMembership(
                connection,
                studio,
                context.membership.userId
            );
            assertPermission(actor, permission);
            result = await operation(connection, studio, actor);
            await connection.commit();
        } catch (error) {
            await rollbackAndRelease(connection);
            throw error;
        }
        connection.release();
        return result;
    }

    async function compensateInvitationDeliveryFailure({
        studioInternalId,
        actorUserId,
        invitationPublicId,
        role
    }) {
        const connection = await begin();
        let recovered = false;
        try {
            const [rows] = await connection.query(
                `SELECT id, status
                 FROM studio_invitations
                 WHERE studio_id = ? AND public_id = ?
                 FOR UPDATE`,
                [studioInternalId, invitationPublicId]
            );
            if (rows[0]?.status === "pending") {
                const [updated] = await connection.query(
                    `UPDATE studio_invitations
                     SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP(6)
                     WHERE id = ? AND status = 'pending'`,
                    [rows[0].id]
                );
                if (updated.affectedRows === 1) {
                    await insertAudit(connection, {
                        studioId: studioInternalId,
                        actorUserId,
                        eventType: "invitation.delivery_failed",
                        targetType: "invitation",
                        targetPublicId: invitationPublicId,
                        details: { role }
                    });
                    recovered = true;
                }
            }
            await connection.commit();
        } catch (error) {
            await rollbackAndRelease(connection);
            throw error;
        }
        connection.release();
        return recovered;
    }

    // Resend's own delivery-failure compensation, deliberately NOT the same
    // as createInvitation's: a temporary mail-provider outage must not turn
    // an existing, previously-working invitation into a dead end. Setting
    // status='expired' (with expires_at pushed into the past) rather than
    // 'revoked' keeps the invitation on the exact same "renew in place" path
    // resendInvitation already takes for a lazily-expired row - the next
    // resend attempt (by the same or a different admin) finds status
    // 'expired', rotates the token again, and succeeds normally. 'revoked'
    // is reserved for an explicit, deliberate admin action and must stay
    // permanent - this path never sets it. Guarded on token_hash matching
    // the specific token this failed attempt itself just wrote: if another
    // resend has already rotated the token again in the meantime (a later,
    // independent call - not a race on this same attempt), this compensation
    // must not clobber that newer, unrelated state.
    // A losing concurrent resend's own CAS UPDATE still has to locate the
    // invitation row (even though its stale token_hash then makes it match
    // zero rows) and briefly locks it while doing so - if that overlaps with
    // this compensation's own UPDATE against the same row from a separate
    // connection, InnoDB can legitimately report ER_LOCK_DEADLOCK and abort
    // one side. That aborted side is always safe to simply retry: the other
    // transaction has already been rolled back or committed by the time the
    // deadlock is reported, so a fresh attempt starts from a clean, current
    // row state. This is the standard, recommended handling for occasional
    // InnoDB deadlocks, not a sign the CAS logic itself is wrong (see the
    // concurrency test just below this function, which proves the CAS is
    // otherwise exactly one-winner correct).
    async function compensateResendDeliveryFailure({
        studioInternalId,
        actorUserId,
        invitationPublicId,
        tokenHash,
        role
    }) {
        const maxAttempts = 3;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            const connection = await begin();
            let recovered = false;
            try {
                const expiredAt = new Date(now().getTime() - 1000);
                const [updated] = await connection.query(
                    `UPDATE studio_invitations
                     SET status = 'expired', expires_at = ?
                     WHERE studio_id = ? AND public_id = ? AND token_hash = ? AND status = 'pending'`,
                    [expiredAt, studioInternalId, invitationPublicId, tokenHash]
                );
                if (updated.affectedRows === 1) {
                    await insertAudit(connection, {
                        studioId: studioInternalId,
                        actorUserId,
                        eventType: "invitation.delivery_failed",
                        targetType: "invitation",
                        targetPublicId: invitationPublicId,
                        details: { role }
                    });
                    recovered = true;
                }
                await connection.commit();
                connection.release();
                return recovered;
            } catch (error) {
                await rollbackAndRelease(connection);
                if (error.code === "ER_LOCK_DEADLOCK" && attempt < maxAttempts) continue;
                throw error;
            }
        }
        return false;
    }

    async function createStudio(actorUserId, input) {
        const studioPublicId = generatePublicId();
        const membershipPublicId = generatePublicId();
        const connection = await begin();
        let created;
        try {
            const [studioResult] = await connection.query(
                `INSERT INTO studios (
                    public_id, name, slug, status, default_locale,
                    default_timezone, default_weight_unit, created_by_user_id
                 ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?)`,
                [
                    studioPublicId,
                    input.name,
                    input.slug,
                    input.default_locale,
                    input.default_timezone,
                    input.default_weight_unit,
                    actorUserId
                ]
            );
            await connection.query(
                `INSERT INTO studio_memberships (
                    public_id, studio_id, user_id, role, status,
                    invited_by_user_id, joined_at
                 ) VALUES (?, ?, ?, 'owner', 'active', NULL, CURRENT_TIMESTAMP(6))`,
                [membershipPublicId, studioResult.insertId, actorUserId]
            );
            await insertAudit(connection, {
                studioId: studioResult.insertId,
                actorUserId,
                eventType: "studio.created",
                targetType: "studio",
                targetPublicId: studioPublicId,
                details: { role: "owner" }
            });
            created = await readStudioContextInTransaction(
                connection,
                studioResult.insertId,
                actorUserId
            );
            await connection.commit();
        } catch (error) {
            await rollbackAndRelease(connection);
            if (error.code === "ER_DUP_ENTRY") {
                throw new ConflictError("Studio slug is already in use.", "STUDIO_SLUG_TAKEN");
            }
            throw error;
        }
        connection.release();
        return publicStudioContext(created);
    }

    async function listStudios(actorUserId) {
        const [rows] = await sql.query(
            `SELECT s.id AS studio_internal_id, s.public_id AS studio_public_id,
                    s.name, s.slug, s.status AS studio_status,
                    s.default_locale, s.default_timezone, s.default_weight_unit,
                    s.created_at AS studio_created_at, s.updated_at AS studio_updated_at,
                    sm.public_id AS membership_public_id,
                    sm.role AS membership_role, sm.status AS membership_status,
                    sm.joined_at, sm.created_at AS membership_created_at,
                    sm.updated_at AS membership_updated_at, sm.user_id
             FROM studio_memberships sm
             INNER JOIN studios s ON s.id = sm.studio_id
             WHERE sm.user_id = ? AND sm.status = 'active' AND s.status = 'active'
             ORDER BY s.name, s.public_id`,
            [actorUserId]
        );
        return rows.map((row) => ({
            ...publicStudio(studioFromRow(row)),
            membership: publicMembership(membershipFromRow(row))
        }));
    }

    async function loadStudioContext(actorUserId, studioPublicId) {
        const [rows] = await sql.query(
            `SELECT s.id AS studio_internal_id, s.public_id AS studio_public_id,
                    s.name, s.slug, s.status AS studio_status,
                    s.default_locale, s.default_timezone, s.default_weight_unit,
                    s.created_at AS studio_created_at, s.updated_at AS studio_updated_at,
                    sm.id AS membership_internal_id,
                    sm.public_id AS membership_public_id, sm.user_id,
                    sm.role AS membership_role, sm.status AS membership_status,
                    sm.joined_at, sm.created_at AS membership_created_at,
                    sm.updated_at AS membership_updated_at
             FROM studios s
             INNER JOIN studio_memberships sm ON sm.studio_id = s.id
             WHERE s.public_id = ? AND sm.user_id = ?
               AND s.status = 'active' AND sm.status = 'active'
             LIMIT 1`,
            [studioPublicId, actorUserId]
        );
        if (rows.length === 0) throw studioNotFound();
        return {
            studio: studioFromRow(rows[0]),
            membership: membershipFromRow(rows[0])
        };
    }

    function getStudio(context) {
        assertPermission(context?.membership, PERMISSIONS.STUDIO_READ);
        return publicStudioContext(context);
    }

    async function updateStudio(actorUserId, context, changes) {
        const connection = await begin();
        let refreshed;
        try {
            const studio = await lockStudio(connection, context.studio.internalId);
            const actor = await lockActorMembership(connection, studio, actorUserId);
            assertPermission(actor, studioPatchPermission(Object.keys(changes)));

            const update = updateStatement(changes, STUDIO_UPDATE_COLUMNS);
            await connection.query(
                `UPDATE studios SET ${update.assignments} WHERE id = ?`,
                [...update.values, studio.internalId]
            );
            await insertAudit(connection, {
                studioId: studio.internalId,
                actorUserId,
                eventType: "studio.updated",
                targetType: "studio",
                targetPublicId: studio.id,
                details: {
                    fields: update.fields.map((field) => PUBLIC_STUDIO_FIELDS[field])
                }
            });
            refreshed = await readStudioContextInTransaction(
                connection,
                studio.internalId,
                actorUserId
            );
            await connection.commit();
        } catch (error) {
            await rollbackAndRelease(connection);
            if (error.code === "ER_DUP_ENTRY") {
                throw new ConflictError("Studio slug is already in use.", "STUDIO_SLUG_TAKEN");
            }
            throw error;
        }
        connection.release();
        return publicStudioContext(refreshed);
    }

    async function listMemberships(context, pagination) {
        return withLockedStudioAccess(
            context,
            PERMISSIONS.MEMBERSHIP_LIST,
            async (connection, studio, actor) => {
                if (actor.role === "trainer") {
                    const [[countRow]] = await connection.query(
                        `SELECT COUNT(*) AS total
                         FROM studio_memberships
                         WHERE studio_id = ? AND status = 'active'`,
                        [studio.internalId]
                    );
                    const [rows] = await connection.query(
                        `SELECT sm.id AS membership_internal_id,
                                sm.public_id AS membership_public_id, sm.user_id,
                                sm.role AS membership_role, sm.status AS membership_status,
                                sm.joined_at, sm.created_at AS membership_created_at,
                                sm.updated_at AS membership_updated_at,
                                u.username AS display_name
                         FROM studio_memberships sm
                         INNER JOIN users u ON u.id = sm.user_id
                         WHERE sm.studio_id = ? AND sm.status = 'active'
                         ORDER BY sm.created_at, sm.id
                         LIMIT ? OFFSET ?`,
                        [studio.internalId, pagination.limit, pagination.offset]
                    );
                    const total = Number(countRow.total);
                    return {
                        memberships: rows.map((row) => publicMembership(membershipFromRow(row))),
                        pagination: paginationResult(total, pagination)
                    };
                }
                const [[countRow]] = await connection.query(
                    "SELECT COUNT(*) AS total FROM studio_memberships WHERE studio_id = ?",
                    [studio.internalId]
                );
                const [rows] = await connection.query(
                    `SELECT sm.id AS membership_internal_id,
                            sm.public_id AS membership_public_id, sm.user_id,
                            sm.role AS membership_role, sm.status AS membership_status,
                            sm.joined_at, sm.created_at AS membership_created_at,
                            sm.updated_at AS membership_updated_at,
                            CASE WHEN sm.status = 'left' THEN NULL ELSE u.username END AS username,
                            CASE WHEN sm.status = 'left' THEN NULL ELSE u.email END AS email
                     FROM studio_memberships sm
                     INNER JOIN users u ON u.id = sm.user_id
                     WHERE sm.studio_id = ?
                     ORDER BY sm.created_at, sm.id
                     LIMIT ? OFFSET ?`,
                    [studio.internalId, pagination.limit, pagination.offset]
                );
                const total = Number(countRow.total);
                return {
                    memberships: rows.map((row) => publicMembership(membershipFromRow(row))),
                    pagination: paginationResult(total, pagination)
                };
            }
        );
    }

    async function getOwnMembership(actorUserId, context) {
        const [rows] = await sql.query(
            `SELECT sm.id AS membership_internal_id,
                    sm.public_id AS membership_public_id, sm.user_id,
                    sm.role AS membership_role, sm.status AS membership_status,
                    sm.joined_at, sm.created_at AS membership_created_at,
                    sm.updated_at AS membership_updated_at,
                    u.username, u.email
             FROM studio_memberships sm
             INNER JOIN studios s ON s.id = sm.studio_id
             INNER JOIN users u ON u.id = sm.user_id
             WHERE sm.studio_id = ? AND sm.user_id = ?
               AND sm.status = 'active' AND s.status = 'active'
             LIMIT 1`,
            [context.studio.internalId, actorUserId]
        );
        if (rows.length === 0) throw studioNotFound();
        const membership = membershipFromRow(rows[0]);
        assertPermission(membership, PERMISSIONS.MEMBERSHIP_READ_SELF);
        return publicMembership(membership);
    }

    async function updateMembership(actorUserId, context, membershipPublicId, changes) {
        const connection = await begin();
        let updated;
        try {
            const studio = await lockStudio(connection, context.studio.internalId);
            const actor = await lockActorMembership(connection, studio, actorUserId);
            assertPermission(actor, PERMISSIONS.MEMBERSHIP_MANAGE);
            const [targets] = await connection.query(
                `SELECT sm.id AS membership_internal_id,
                        sm.public_id AS membership_public_id, sm.user_id,
                        sm.role AS membership_role, sm.status AS membership_status,
                        sm.joined_at, sm.created_at AS membership_created_at,
                        sm.updated_at AS membership_updated_at,
                        u.username, u.email
                 FROM studio_memberships sm
                 INNER JOIN users u ON u.id = sm.user_id
                 WHERE sm.studio_id = ? AND sm.public_id = ?
                 FOR UPDATE`,
                [studio.internalId, membershipPublicId]
            );
            if (targets.length === 0) throw membershipNotFound();
            const target = membershipFromRow(targets[0]);

            const [owners] = await connection.query(
                `SELECT id FROM studio_memberships
                 WHERE studio_id = ? AND role = 'owner' AND status = 'active'
                 FOR UPDATE`,
                [studio.internalId]
            );
            const decision = membershipChangeDecision({
                actor,
                target,
                changes,
                activeOwnerCount: owners.length
            });
            if (!decision.allowed) {
                if (decision.reason === "LAST_ACTIVE_OWNER") {
                    throw new LastOwnerRequiredError();
                }
                throw new InsufficientStudioRoleError();
            }

            const update = updateStatement(changes, MEMBERSHIP_UPDATE_COLUMNS);
            await connection.query(
                `UPDATE studio_memberships SET ${update.assignments} WHERE id = ? AND studio_id = ?`,
                [...update.values, target.internalId, studio.internalId]
            );
            for (const event of membershipChangeAuditEvents(target, changes)) {
                await insertAudit(connection, {
                    studioId: studio.internalId,
                    actorUserId,
                    targetType: "membership",
                    targetPublicId: target.id,
                    ...event
                });
            }
            updated = await readMembershipInTransaction(
                connection,
                studio.internalId,
                target.internalId
            );
            await connection.commit();
        } catch (error) {
            await rollbackAndRelease(connection);
            throw error;
        }
        connection.release();
        return publicMembership(updated);
    }

    async function createInvitation(actorUserId, context, input, { requestId } = {}) {
        outbox.assertAvailable();
        const { token, tokenHash } = generateInvitationToken();
        const invitationPublicId = generatePublicId();
        const expiresAt = new Date(now().getTime() + INVITATION_LIFETIME_MS);
        const connection = await begin();
        let studio;
        try {
            studio = await lockStudio(connection, context.studio.internalId);
            const actor = await lockActorMembership(connection, studio, actorUserId);
            assertPermission(actor, PERMISSIONS.INVITATION_CREATE);
            if (!invitationRoleDecision(actor.role, input.role).allowed) {
                throw new InsufficientStudioRoleError();
            }

            const [existingMemberships] = await connection.query(
                `SELECT sm.status
                 FROM users u
                 INNER JOIN studio_memberships sm ON sm.user_id = u.id
                 WHERE sm.studio_id = ? AND LOWER(u.email) = ?
                 LIMIT 1
                 FOR UPDATE`,
                [studio.internalId, input.email]
            );
            if (existingMemberships[0]?.status === "active") {
                throw new ConflictError(
                    "The user is already an active studio member.",
                    "MEMBERSHIP_ALREADY_ACTIVE"
                );
            }
            if (existingMemberships[0]?.status === "suspended") {
                throw new ConflictError(
                    "The existing studio membership is suspended.",
                    "MEMBERSHIP_SUSPENDED"
                );
            }

            const currentTime = now();
            const [expiredInvitations] = await connection.query(
                `SELECT id, public_id, role
                 FROM studio_invitations
                 WHERE studio_id = ? AND email_normalized = ?
                   AND status = 'pending' AND expires_at <= ?
                 FOR UPDATE`,
                [studio.internalId, input.email, currentTime]
            );
            for (const expiredInvitation of expiredInvitations) {
                const [expired] = await connection.query(
                    `UPDATE studio_invitations SET status = 'expired'
                     WHERE id = ? AND studio_id = ? AND status = 'pending'`,
                    [expiredInvitation.id, studio.internalId]
                );
                if (expired.affectedRows === 1) {
                    await insertAudit(connection, {
                        studioId: studio.internalId,
                        actorUserId,
                        eventType: "invitation.expired",
                        targetType: "invitation",
                        targetPublicId: expiredInvitation.public_id,
                        details: { role: expiredInvitation.role }
                    });
                }
            }
            const [pending] = await connection.query(
                `SELECT id FROM studio_invitations
                 WHERE studio_id = ? AND email_normalized = ? AND status = 'pending'
                 LIMIT 1 FOR UPDATE`,
                [studio.internalId, input.email]
            );
            if (pending.length > 0) {
                throw new ConflictError(
                    "A pending invitation already exists for this e-mail address.",
                    "INVITATION_ALREADY_PENDING"
                );
            }

            await connection.query(
                `INSERT INTO studio_invitations (
                    public_id, studio_id, email_normalized, role,
                    token_hash, status, expires_at, invited_by_user_id
                 ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
                [
                    invitationPublicId,
                    studio.internalId,
                    input.email,
                    input.role,
                    tokenHash,
                    expiresAt,
                    actorUserId
                ]
            );
            await insertAudit(connection, {
                studioId: studio.internalId,
                actorUserId,
                eventType: "invitation.created",
                targetType: "invitation",
                targetPublicId: invitationPublicId,
                details: { role: input.role, expiresAt }
            });
            await connection.commit();
        } catch (error) {
            await rollbackAndRelease(connection);
            throw error;
        }
        connection.release();

        let delivery;
        try {
            delivery = await outbox.publish({
                token,
                email: input.email,
                studioName: studio.name,
                role: input.role,
                expiresAt,
                locale: studio.default_locale,
                requestId
            });
        } catch {
            try {
                const recovered = await compensateInvitationDeliveryFailure({
                    studioInternalId: studio.internalId,
                    actorUserId,
                    invitationPublicId,
                    role: input.role
                });
                if (!recovered) {
                    throw new Error("Invitation was no longer pending during delivery recovery.");
                }
            } catch (compensationError) {
                throw new AppError({
                    status: 503,
                    code: "INVITATION_DELIVERY_RECOVERY_FAILED",
                    message: "Invitation delivery failed and requires operator review.",
                    cause: compensationError
                });
            }
            throw new AppError({
                status: 502,
                code: "INVITATION_DELIVERY_FAILED",
                message: "Invitation delivery failed; the invitation was revoked safely."
            });
        }
        return {
            invitation: {
                id: invitationPublicId,
                email: input.email,
                role: input.role,
                status: "pending",
                expiresAt
            },
            delivery
        };
    }

    async function listInvitations(context, pagination) {
        return withLockedStudioAccess(
            context,
            PERMISSIONS.INVITATION_LIST,
            async (connection, studio) => {
                const [[countRow]] = await connection.query(
                    "SELECT COUNT(*) AS total FROM studio_invitations WHERE studio_id = ?",
                    [studio.internalId]
                );
                const [rows] = await connection.query(
                    `SELECT si.public_id,
                            CASE
                                WHEN si.status IN ('pending', 'expired')
                                THEN si.email_normalized ELSE NULL
                            END AS email_normalized,
                            si.role, si.status, si.expires_at,
                            si.accepted_at, si.created_at, si.revoked_at,
                            inviter.username AS invited_by_username
                     FROM studio_invitations si
                     LEFT JOIN users inviter ON inviter.id = si.invited_by_user_id
                     WHERE si.studio_id = ?
                     ORDER BY si.created_at DESC, si.id DESC
                     LIMIT ? OFFSET ?`,
                    [studio.internalId, pagination.limit, pagination.offset]
                );
                const current = now();
                const total = Number(countRow.total);
                return {
                    invitations: rows.map((row) => publicInvitation(row, current)),
                    pagination: paginationResult(total, pagination)
                };
            }
        );
    }

    async function revokeInvitation(actorUserId, context, invitationPublicId) {
        const connection = await begin();
        let revoked;
        let postCommitError;
        try {
            const studio = await lockStudio(connection, context.studio.internalId);
            const actor = await lockActorMembership(connection, studio, actorUserId);
            assertPermission(actor, PERMISSIONS.INVITATION_REVOKE);
            const [rows] = await connection.query(
                `SELECT public_id, email_normalized, role, status, expires_at,
                        accepted_at, created_at, revoked_at
                 FROM studio_invitations
                 WHERE studio_id = ? AND public_id = ?
                 FOR UPDATE`,
                [studio.internalId, invitationPublicId]
            );
            if (rows.length === 0) throw invitationNotFound();
            const invitation = rows[0];
            if (!invitationRoleDecision(actor.role, invitation.role).allowed) {
                throw new InsufficientStudioRoleError();
            }
            if (invitation.status !== "pending") throw invitationStateError(invitation.status);
            if (new Date(invitation.expires_at).getTime() <= now().getTime()) {
                await connection.query(
                    "UPDATE studio_invitations SET status = 'expired' WHERE studio_id = ? AND public_id = ?",
                    [studio.internalId, invitationPublicId]
                );
                await insertAudit(connection, {
                    studioId: studio.internalId,
                    actorUserId,
                    eventType: "invitation.expired",
                    targetType: "invitation",
                    targetPublicId: invitationPublicId,
                    details: { role: invitation.role }
                });
                await connection.commit();
                postCommitError = invitationStateError("expired");
            } else {
                await connection.query(
                    `UPDATE studio_invitations
                     SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP(6)
                     WHERE studio_id = ? AND public_id = ? AND status = 'pending'`,
                    [studio.internalId, invitationPublicId]
                );
                await insertAudit(connection, {
                    studioId: studio.internalId,
                    actorUserId,
                    eventType: "invitation.revoked",
                    targetType: "invitation",
                    targetPublicId: invitationPublicId,
                    details: { role: invitation.role }
                });
                revoked = { ...invitation, status: "revoked", revoked_at: now() };
                await connection.commit();
            }
        } catch (error) {
            await rollbackAndRelease(connection);
            throw error;
        }
        connection.release();
        if (postCommitError) throw postCommitError;
        return publicInvitation(revoked, now());
    }

    // Resend always rotates the token and grants a fresh expiry window, for
    // both a still-valid pending invitation and one that has lazily lapsed
    // (status still 'pending' with a past expires_at, or already flipped to
    // 'expired' by an earlier read/write elsewhere) - both cases are treated
    // as "renew this same request in place" rather than minting a second,
    // competing invitation row.
    //
    // Concurrency: expectedTokenHash is read from the pool *before* this
    // request acquires any lock, so a burst of concurrently-started resend
    // calls all capture the same pre-race baseline - even same-actor calls,
    // which are otherwise fully serialized by lockActorMembership's row
    // lock and would each see a legitimately "current" state in turn if the
    // baseline were captured any later. The rotation itself is a
    // compare-and-swap UPDATE guarded on that baseline: only the request
    // whose expected old token is still the row's current token may rotate
    // it (affectedRows must be exactly 1); every other concurrently-started
    // request's CAS reports affectedRows 0 and gets a stable 409 conflict
    // instead of also rotating and also sending its own mail. Because the
    // status/role/membership checks just above run against the row's
    // *current* FOR UPDATE state (not the pre-race baseline), a genuine
    // status change (revoked, accepted) is still reported with its own more
    // specific code - the generic conflict code is reserved for the pure
    // "someone else already resent this" case.
    //
    // Delivery failure: the old token is invalidated unconditionally the
    // moment this transaction commits, regardless of whether the new
    // token's e-mail delivery afterwards succeeds - so there is never an
    // "old token still works" state to fall back to. But unlike
    // createInvitation (which has no prior valid state at all),
    // compensateResendDeliveryFailure does not revoke - it marks the
    // invitation 'expired' (guarded on this call's own new token hash, so
    // it can never clobber a different, later resend), which keeps it on
    // the same "renew in place" path a lazily-expired invitation already
    // takes. A resend that fails to deliver is safely retryable, not
    // permanently dead.
    async function resendInvitation(actorUserId, context, invitationPublicId, { requestId } = {}) {
        outbox.assertAvailable();
        const [baselineRows] = await sql.query(
            `SELECT token_hash FROM studio_invitations WHERE studio_id = ? AND public_id = ?`,
            [context.studio.internalId, invitationPublicId]
        );
        if (baselineRows.length === 0) throw invitationNotFound();
        const expectedTokenHash = baselineRows[0].token_hash;

        const { token, tokenHash } = generateInvitationToken();
        const expiresAt = new Date(now().getTime() + INVITATION_LIFETIME_MS);
        const connection = await begin();
        let studio;
        let invitation;
        try {
            studio = await lockStudio(connection, context.studio.internalId);
            const actor = await lockActorMembership(connection, studio, actorUserId);
            assertPermission(actor, PERMISSIONS.INVITATION_RESEND);

            const [rows] = await connection.query(
                `SELECT public_id, email_normalized, role, status, expires_at,
                        accepted_at, created_at, revoked_at
                 FROM studio_invitations
                 WHERE studio_id = ? AND public_id = ?
                 FOR UPDATE`,
                [studio.internalId, invitationPublicId]
            );
            if (rows.length === 0) throw invitationNotFound();
            invitation = rows[0];
            if (!invitationRoleDecision(actor.role, invitation.role).allowed) {
                throw new InsufficientStudioRoleError();
            }

            if (invitation.status === "accepted") {
                throw applicationError(
                    409,
                    "INVITATION_ALREADY_ACCEPTED",
                    "Invitation has already been accepted."
                );
            }
            if (invitation.status === "revoked") {
                throw applicationError(409, "INVITATION_REVOKED", "Invitation has been revoked.");
            }
            if (invitation.status !== "pending" && invitation.status !== "expired") {
                throw applicationError(409, "INVITATION_NOT_RESENDABLE", "Invitation cannot be resent.");
            }

            const [existingMemberships] = await connection.query(
                `SELECT sm.status
                 FROM users u
                 INNER JOIN studio_memberships sm ON sm.user_id = u.id
                 WHERE sm.studio_id = ? AND LOWER(u.email) = ?
                 LIMIT 1
                 FOR UPDATE`,
                [studio.internalId, invitation.email_normalized]
            );
            if (existingMemberships[0]?.status === "active") {
                throw new ConflictError(
                    "The invited e-mail address already has an active studio membership.",
                    "INVITATION_EMAIL_ALREADY_MEMBER"
                );
            }

            const [updated] = await connection.query(
                `UPDATE studio_invitations
                 SET token_hash = ?, status = 'pending', expires_at = ?
                 WHERE studio_id = ? AND public_id = ? AND token_hash = ?`,
                [tokenHash, expiresAt, studio.internalId, invitationPublicId, expectedTokenHash]
            );
            if (updated.affectedRows !== 1) {
                throw new ConflictError(
                    "Another resend for this invitation was already in progress.",
                    "INVITATION_RESEND_CONFLICT"
                );
            }
            // invitation.resent is deliberately NOT written here: writing it
            // as part of the rotation itself would record a "resent" event
            // even for an attempt whose delivery then fails, which is
            // exactly the misleading-success audit trail this hardening
            // pass removes. It is written once, below, only after outbox.
            // publish has actually succeeded.
            await connection.commit();
        } catch (error) {
            await rollbackAndRelease(connection);
            throw error;
        }
        connection.release();

        let delivery;
        try {
            delivery = await outbox.publish({
                token,
                email: invitation.email_normalized,
                studioName: studio.name,
                role: invitation.role,
                expiresAt,
                locale: studio.default_locale,
                requestId
            });
        } catch {
            try {
                const recovered = await compensateResendDeliveryFailure({
                    studioInternalId: studio.internalId,
                    actorUserId,
                    invitationPublicId,
                    tokenHash,
                    role: invitation.role
                });
                if (!recovered) {
                    throw new Error("Invitation was no longer in the expected state during delivery recovery.");
                }
            } catch (compensationError) {
                throw new AppError({
                    status: 503,
                    code: "INVITATION_DELIVERY_RECOVERY_FAILED",
                    message: "Invitation delivery failed and requires operator review.",
                    cause: compensationError
                });
            }
            throw new AppError({
                status: 502,
                code: "INVITATION_DELIVERY_FAILED",
                message: "Invitation delivery failed; the invitation is marked expired and can be resent."
            });
        }

        await insertAudit(sql, {
            studioId: studio.internalId,
            actorUserId,
            eventType: "invitation.resent",
            targetType: "invitation",
            targetPublicId: invitationPublicId,
            details: { role: invitation.role, expiresAt }
        });

        return {
            invitation: {
                id: invitationPublicId,
                email: invitation.email_normalized,
                role: invitation.role,
                status: "pending",
                expiresAt
            },
            delivery
        };
    }

    async function acceptInvitation(actorUserId, token) {
        let tokenHash;
        try {
            tokenHash = hashToken(token);
        } catch (error) {
            throw invitationNotFound();
        }
        const connection = await begin();
        let result;
        let postCommitError;
        try {
            const [references] = await connection.query(
                `SELECT studio_id
                 FROM studio_invitations
                 WHERE token_hash = ?
                 LIMIT 1`,
                [tokenHash]
            );
            if (references.length === 0) throw invitationNotFound();
            const [studioRows] = await connection.query(
                `SELECT id AS studio_internal_id, public_id AS studio_public_id,
                        name, slug, status AS studio_status,
                        default_locale, default_timezone, default_weight_unit,
                        created_at AS studio_created_at, updated_at AS studio_updated_at
                 FROM studios
                 WHERE id = ?
                 FOR UPDATE`,
                [references[0].studio_id]
            );
            if (studioRows.length === 0) throw invitationNotFound();
            const studio = studioFromRow(studioRows[0]);
            const [rows] = await connection.query(
                `SELECT si.id AS invitation_internal_id,
                        si.public_id AS invitation_public_id,
                        si.studio_id, si.email_normalized, si.role,
                        si.status AS invitation_status, si.expires_at,
                        si.invited_by_user_id
                 FROM studio_invitations si
                 WHERE si.studio_id = ? AND si.token_hash = ?
                 LIMIT 1 FOR UPDATE`,
                [studio.internalId, tokenHash]
            );
            if (rows.length === 0) throw invitationNotFound();
            const invitation = rows[0];
            if (invitation.invitation_status !== "pending") {
                throw invitationStateError(invitation.invitation_status);
            }
            if (new Date(invitation.expires_at).getTime() <= now().getTime()) {
                await connection.query(
                    "UPDATE studio_invitations SET status = 'expired' WHERE id = ?",
                    [invitation.invitation_internal_id]
                );
                await insertAudit(connection, {
                    studioId: Number(invitation.studio_id),
                    actorUserId,
                    eventType: "invitation.expired",
                    targetType: "invitation",
                    targetPublicId: invitation.invitation_public_id,
                    details: { role: invitation.role }
                });
                await connection.commit();
                postCommitError = invitationStateError("expired");
            } else {
                if (studio.status !== "active") {
                    throw applicationError(409, "STUDIO_UNAVAILABLE", "Studio is not active.");
                }

                const [users] = await connection.query(
                    "SELECT id, LOWER(email) AS email_normalized FROM users WHERE id = ? FOR UPDATE",
                    [actorUserId]
                );
                if (users.length === 0) throw new NotFoundError("User not found.");
                if (users[0].email_normalized !== invitation.email_normalized) {
                    throw invitationNotFound();
                }

                const [memberships] = await connection.query(
                `SELECT id AS membership_internal_id,
                        public_id AS membership_public_id, user_id,
                        role AS membership_role, status AS membership_status,
                        joined_at, created_at AS membership_created_at,
                        updated_at AS membership_updated_at
                 FROM studio_memberships
                 WHERE studio_id = ? AND user_id = ?
                 FOR UPDATE`,
                [invitation.studio_id, actorUserId]
            );
                let membership;
                if (memberships.length > 0) {
                    membership = membershipFromRow(memberships[0]);
                    if (membership.status === "active") {
                        throw new ConflictError(
                            "The account already has an active studio membership.",
                            "MEMBERSHIP_ALREADY_ACTIVE"
                        );
                    }
                    if (membership.status === "suspended") {
                        throw new ConflictError(
                            "The studio membership is suspended.",
                            "MEMBERSHIP_SUSPENDED"
                        );
                    }
                    await connection.query(
                    `UPDATE studio_memberships
                     SET role = ?, status = 'active', invited_by_user_id = ?,
                         joined_at = CURRENT_TIMESTAMP(6)
                     WHERE id = ? AND studio_id = ?`,
                    [
                        invitation.role,
                        invitation.invited_by_user_id,
                        membership.internalId,
                        invitation.studio_id
                    ]
                );
                    membership.role = invitation.role;
                    membership.status = "active";
                    membership.joined_at = now();
                } else {
                    const membershipPublicId = generatePublicId();
                    const [inserted] = await connection.query(
                    `INSERT INTO studio_memberships (
                        public_id, studio_id, user_id, role, status,
                        invited_by_user_id, joined_at
                     )
                     SELECT ?, si.studio_id, ?, si.role, 'active',
                            si.invited_by_user_id, CURRENT_TIMESTAMP(6)
                     FROM studio_invitations si
                     WHERE si.id = ?`,
                    [membershipPublicId, actorUserId, invitation.invitation_internal_id]
                );
                    membership = {
                        internalId: inserted.insertId,
                        id: membershipPublicId,
                        userId: actorUserId,
                        role: invitation.role,
                        status: "active",
                        joined_at: now(),
                        created_at: now(),
                        updated_at: now()
                    };
                }

                const [freshMembershipRows] = await connection.query(
                    `SELECT id AS membership_internal_id,
                            public_id AS membership_public_id, user_id,
                            role AS membership_role, status AS membership_status,
                            joined_at, created_at AS membership_created_at,
                            updated_at AS membership_updated_at
                     FROM studio_memberships
                     WHERE studio_id = ? AND id = ?
                     LIMIT 1`,
                    [invitation.studio_id, membership.internalId]
                );
                if (freshMembershipRows.length === 0) throw membershipNotFound();
                membership = membershipFromRow(freshMembershipRows[0]);

                const [accepted] = await connection.query(
                `UPDATE studio_invitations
                 SET status = 'accepted', accepted_by_user_id = ?,
                     accepted_at = CURRENT_TIMESTAMP(6)
                 WHERE id = ? AND status = 'pending'`,
                [actorUserId, invitation.invitation_internal_id]
            );
                if (accepted.affectedRows !== 1) throw invitationStateError("accepted");
                await insertAudit(connection, {
                    studioId: Number(invitation.studio_id),
                    actorUserId,
                    eventType: "invitation.accepted",
                    targetType: "invitation",
                    targetPublicId: invitation.invitation_public_id,
                    details: { membershipId: membership.id, role: membership.role }
                });
                result = {
                    studio: publicStudio(studio),
                    membership: publicMembership(membership)
                };
                await connection.commit();
            }
        } catch (error) {
            await rollbackAndRelease(connection);
            throw error;
        }
        connection.release();
        if (postCommitError) throw postCommitError;
        return result;
    }

    async function listAuditEvents(context, pagination) {
        return withLockedStudioAccess(
            context,
            PERMISSIONS.AUDIT_READ,
            async (connection, studio) => {
                const [[countRow]] = await connection.query(
                    "SELECT COUNT(*) AS total FROM studio_audit_events WHERE studio_id = ?",
                    [studio.internalId]
                );
                const [rows] = await connection.query(
                    `SELECT sae.public_id, sae.event_type, sae.target_type,
                            sae.target_public_id, sae.details_json, sae.created_at,
                            u.username AS actor_username
                     FROM studio_audit_events sae
                     LEFT JOIN users u ON u.id = sae.actor_user_id
                     WHERE sae.studio_id = ?
                     ORDER BY sae.id DESC
                     LIMIT ? OFFSET ?`,
                    [studio.internalId, pagination.limit, pagination.offset]
                );
                const total = Number(countRow.total);
                return {
                    auditEvents: rows.map((row) => ({
                        id: row.public_id,
                        eventType: row.event_type,
                        targetType: row.target_type,
                        targetId: row.target_public_id,
                        details: parseDetails(row.details_json, row.event_type),
                        actor: row.actor_username ? { username: row.actor_username } : null,
                        createdAt: row.created_at
                    })),
                    pagination: paginationResult(total, pagination)
                };
            }
        );
    }

    return {
        acceptInvitation,
        createInvitation,
        createStudio,
        getOwnMembership,
        getStudio,
        listAuditEvents,
        listInvitations,
        listMemberships,
        listStudios,
        loadStudioContext,
        resendInvitation,
        revokeInvitation,
        updateMembership,
        updateStudio
    };
}

module.exports = {
    INVITATION_LIFETIME_MS,
    createStudioService,
    invitationStateError,
    membershipChangeAuditEvents,
    paginationResult,
    publicInvitation,
    publicMembership,
    publicStudio,
    publicStudioContext,
    studioFromRow,
    updateStatement
};
