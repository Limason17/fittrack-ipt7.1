const { ConflictError } = require("../errors/AppError");
const {
    CoachingRelationshipExistsError,
    CoachingRelationshipIneligibleError,
    CoachingRelationshipNotFoundError
} = require("../errors/TrainingProgramErrors");
const { createPublicId } = require("../domain/studioDomain");
const { PERMISSIONS, coachingRelationshipEligibility } = require("../domain/studioPolicy");
const {
    createTrainingServiceHelpers,
    paginationResult,
    promiseDatabase
} = require("./trainingServiceHelpers");

function relationshipFromRow(row) {
    return {
        internalId: Number(row.id),
        id: row.public_id,
        studioInternalId: Number(row.studio_id),
        coachMembershipInternalId: Number(row.coach_membership_id),
        memberMembershipInternalId: Number(row.member_membership_id),
        status: row.status,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        coachPublicId: row.coach_public_id,
        coachDisplayName: row.coach_display_name,
        memberPublicId: row.member_public_id,
        memberDisplayName: row.member_display_name
    };
}

function publicRelationship(relationship) {
    return {
        id: relationship.id,
        status: relationship.status,
        coach: {
            membershipId: relationship.coachPublicId,
            displayName: relationship.coachDisplayName
        },
        member: {
            membershipId: relationship.memberPublicId,
            displayName: relationship.memberDisplayName
        },
        startedAt: relationship.startedAt,
        endedAt: relationship.endedAt
    };
}

const RELATIONSHIP_SELECT = `
    SELECT
        cr.id, cr.public_id, cr.studio_id, cr.coach_membership_id, cr.member_membership_id,
        cr.status, cr.started_at, cr.ended_at,
        coach.public_id AS coach_public_id, coach_user.username AS coach_display_name,
        member.public_id AS member_public_id, member_user.username AS member_display_name
    FROM studio_coaching_relationships cr
    INNER JOIN studio_memberships coach ON coach.id = cr.coach_membership_id
    INNER JOIN users coach_user ON coach_user.id = coach.user_id
    INNER JOIN studio_memberships member ON member.id = cr.member_membership_id
    INNER JOIN users member_user ON member_user.id = member.user_id
`;

function createCoachingService({ database, generatePublicId = createPublicId } = {}) {
    if (!database) {
        throw new TypeError("Coaching service requires a database.");
    }
    const sql = promiseDatabase(database);
    const helpers = createTrainingServiceHelpers(sql);

    async function createRelationship(actorUserId, context, input) {
        return helpers.withLockedStudioAccess(
            context,
            PERMISSIONS.COACHING_MANAGE,
            async (connection, studio, actor) => {
                const coachMembership = await helpers.findMembershipByPublicId(
                    connection, studio.internalId, input.coachMembershipId
                );
                const memberMembership = await helpers.findMembershipByPublicId(
                    connection, studio.internalId, input.memberMembershipId
                );
                const decision = coachingRelationshipEligibility({ coachMembership, memberMembership });
                if (!decision.allowed) {
                    throw new CoachingRelationshipIneligibleError(decision.reason);
                }

                const [existing] = await connection.query(
                    `SELECT id FROM studio_coaching_relationships
                     WHERE coach_membership_id = ? AND member_membership_id = ? AND status = 'active'
                     FOR UPDATE`,
                    [coachMembership.internalId, memberMembership.internalId]
                );
                if (existing.length > 0) {
                    throw new CoachingRelationshipExistsError();
                }

                const relationshipPublicId = generatePublicId();
                try {
                    await connection.query(
                        `INSERT INTO studio_coaching_relationships (
                            public_id, studio_id, coach_membership_id, member_membership_id,
                            status, created_by_user_id, started_at
                         ) VALUES (?, ?, ?, ?, 'active', ?, CURRENT_TIMESTAMP(6))`,
                        [
                            relationshipPublicId,
                            studio.internalId,
                            coachMembership.internalId,
                            memberMembership.internalId,
                            actorUserId
                        ]
                    );
                } catch (error) {
                    if (error.code === "ER_DUP_ENTRY") {
                        throw new CoachingRelationshipExistsError();
                    }
                    throw error;
                }

                await helpers.insertAudit(connection, {
                    studioId: studio.internalId,
                    actorUserId,
                    eventType: "coaching_relationship.created",
                    targetType: "coaching_relationship",
                    targetPublicId: relationshipPublicId,
                    details: {
                        coachMembershipId: coachMembership.id,
                        memberMembershipId: memberMembership.id
                    }
                });

                const [rows] = await connection.query(
                    `${RELATIONSHIP_SELECT} WHERE cr.public_id = ?`,
                    [relationshipPublicId]
                );
                return publicRelationship(relationshipFromRow(rows[0]));
            }
        );
    }

    async function endRelationship(actorUserId, context, relationshipPublicId) {
        return helpers.withLockedStudioAccess(
            context,
            PERMISSIONS.COACHING_MANAGE,
            async (connection, studio, actor) => {
                const [rows] = await connection.query(
                    `SELECT id, status, coach_membership_id, member_membership_id
                     FROM studio_coaching_relationships
                     WHERE studio_id = ? AND public_id = ?
                     FOR UPDATE`,
                    [studio.internalId, relationshipPublicId]
                );
                if (rows.length === 0) throw new CoachingRelationshipNotFoundError();
                const relationship = rows[0];
                if (relationship.status !== "active") {
                    throw new ConflictError(
                        "The coaching relationship has already ended.",
                        "COACHING_RELATIONSHIP_ALREADY_ENDED"
                    );
                }

                await connection.query(
                    `UPDATE studio_coaching_relationships
                     SET status = 'ended', ended_at = CURRENT_TIMESTAMP(6)
                     WHERE id = ?`,
                    [relationship.id]
                );

                const [coachRows] = await connection.query(
                    "SELECT public_id FROM studio_memberships WHERE id = ?",
                    [relationship.coach_membership_id]
                );
                const [memberRows] = await connection.query(
                    "SELECT public_id FROM studio_memberships WHERE id = ?",
                    [relationship.member_membership_id]
                );

                await helpers.insertAudit(connection, {
                    studioId: studio.internalId,
                    actorUserId,
                    eventType: "coaching_relationship.ended",
                    targetType: "coaching_relationship",
                    targetPublicId: relationshipPublicId,
                    details: {
                        coachMembershipId: coachRows[0].public_id,
                        memberMembershipId: memberRows[0].public_id
                    }
                });

                const [freshRows] = await connection.query(
                    `${RELATIONSHIP_SELECT} WHERE cr.id = ?`,
                    [relationship.id]
                );
                return publicRelationship(relationshipFromRow(freshRows[0]));
            }
        );
    }

    async function listRelationships(context, pagination) {
        return helpers.withLockedStudioAccess(
            context,
            PERMISSIONS.COACHING_LIST,
            async (connection, studio, actor) => {
                const scopedToCoach = actor.role === "trainer";
                const whereClause = scopedToCoach
                    ? "WHERE cr.studio_id = ? AND cr.coach_membership_id = ?"
                    : "WHERE cr.studio_id = ?";
                const params = scopedToCoach
                    ? [studio.internalId, actor.internalId]
                    : [studio.internalId];

                const [[countRow]] = await connection.query(
                    `SELECT COUNT(*) AS total FROM studio_coaching_relationships cr ${whereClause}`,
                    params
                );
                const [rows] = await connection.query(
                    `${RELATIONSHIP_SELECT} ${whereClause}
                     ORDER BY cr.created_at DESC, cr.id DESC
                     LIMIT ? OFFSET ?`,
                    [...params, pagination.limit, pagination.offset]
                );
                const total = Number(countRow.total);
                return {
                    coachingRelationships: rows.map((row) => publicRelationship(relationshipFromRow(row))),
                    pagination: paginationResult(total, pagination)
                };
            }
        );
    }

    async function loadActiveRelationshipForMember(connection, studioInternalId, coachMembershipInternalId, memberMembershipInternalId) {
        const [rows] = await connection.query(
            `SELECT id, public_id, status
             FROM studio_coaching_relationships
             WHERE studio_id = ? AND coach_membership_id = ? AND member_membership_id = ? AND status = 'active'
             FOR UPDATE`,
            [studioInternalId, coachMembershipInternalId, memberMembershipInternalId]
        );
        return rows[0] || null;
    }

    return {
        createRelationship,
        endRelationship,
        listRelationships,
        loadActiveRelationshipForMember
    };
}

module.exports = {
    createCoachingService,
    publicRelationship,
    relationshipFromRow
};
