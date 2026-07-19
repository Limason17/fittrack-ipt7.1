const { buildAuditEvent } = require("../audit/studioAudit");
const { hasStudioPermission } = require("../domain/studioPolicy");
const { InsufficientStudioRoleError, StudioNotFoundError } = require("../errors/StudioErrors");

function promiseDatabase(database) {
    return typeof database.promise === "function" ? database.promise() : database;
}

function studioNotFound() {
    return new StudioNotFoundError();
}

function createTrainingServiceHelpers(sql) {
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
            `SELECT id AS studio_internal_id, public_id AS studio_public_id, status AS studio_status
             FROM studios
             WHERE id = ?
             FOR UPDATE`,
            [studioInternalId]
        );
        if (rows.length === 0 || rows[0].studio_status !== "active") {
            throw studioNotFound();
        }
        return {
            internalId: Number(rows[0].studio_internal_id),
            id: rows[0].studio_public_id,
            status: rows[0].studio_status
        };
    }

    function membershipFromRow(row) {
        return {
            internalId: Number(row.membership_internal_id),
            id: row.membership_public_id,
            userId: Number(row.user_id),
            role: row.membership_role,
            status: row.membership_status
        };
    }

    async function lockActorMembership(connection, studioInternalId, actorUserId) {
        const [rows] = await connection.query(
            `SELECT id AS membership_internal_id, public_id AS membership_public_id, user_id,
                    role AS membership_role, status AS membership_status
             FROM studio_memberships
             WHERE studio_id = ? AND user_id = ?
             FOR UPDATE`,
            [studioInternalId, actorUserId]
        );
        if (rows.length === 0 || rows[0].membership_status !== "active") {
            throw studioNotFound();
        }
        return membershipFromRow(rows[0]);
    }

    async function findMembershipByPublicId(connection, studioInternalId, publicId, { lock = true } = {}) {
        const [rows] = await connection.query(
            `SELECT id AS membership_internal_id, public_id AS membership_public_id, user_id,
                    role AS membership_role, status AS membership_status
             FROM studio_memberships
             WHERE studio_id = ? AND public_id = ?
             ${lock ? "FOR UPDATE" : ""}`,
            [studioInternalId, publicId]
        );
        if (rows.length === 0) return null;
        return membershipFromRow(rows[0]);
    }

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

    async function withLockedStudioAccess(context, permission, operation) {
        const connection = await begin();
        let result;
        try {
            const studio = await lockStudio(connection, context.studio.internalId);
            const actor = await lockActorMembership(connection, studio.internalId, context.membership.userId);
            if (!hasStudioPermission(actor, permission)) {
                throw new InsufficientStudioRoleError();
            }
            result = await operation(connection, studio, actor);
            await connection.commit();
        } catch (error) {
            await rollbackAndRelease(connection);
            throw error;
        }
        connection.release();
        return result;
    }

    return {
        begin,
        findMembershipByPublicId,
        insertAudit,
        lockActorMembership,
        lockStudio,
        membershipFromRow,
        rollbackAndRelease,
        withLockedStudioAccess
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

module.exports = {
    createTrainingServiceHelpers,
    paginationResult,
    promiseDatabase,
    studioNotFound
};
