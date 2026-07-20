const {
    CoachingRelationshipNotFoundError,
    CoachingRelationshipRequiredError,
    ProgramAssignmentNotFoundError,
    ProgramAssignmentStateError,
    ProgramVersionNotFoundError,
    ProgramVersionNotPublishedError
} = require("../errors/TrainingProgramErrors");
const { createPublicId } = require("../domain/studioDomain");
const { PERMISSIONS, canAssignProgramVersion } = require("../domain/studioPolicy");
const { COACH_ELIGIBLE_ROLES } = require("../domain/trainingProgramDomain");
const {
    createTrainingServiceHelpers,
    paginationResult,
    promiseDatabase
} = require("./trainingServiceHelpers");
const { dayFromRow, exerciseFromRow, publicDay } = require("./trainingProgramService");

function assignmentFromRow(row) {
    return {
        internalId: Number(row.id),
        id: row.public_id,
        studioInternalId: Number(row.studio_id),
        programVersionInternalId: Number(row.program_version_id),
        memberMembershipInternalId: Number(row.member_membership_id),
        coachingRelationshipInternalId: Number(row.coaching_relationship_id),
        status: row.status,
        startsOn: row.starts_on,
        endsOn: row.ends_on,
        assignedAt: row.assigned_at,
        completedAt: row.completed_at,
        cancelledAt: row.cancelled_at,
        versionNumber: row.version_number === undefined ? undefined : Number(row.version_number),
        versionStatus: row.version_status,
        programId: row.program_public_id,
        programName: row.program_name,
        programDescription: row.program_description,
        memberPublicId: row.member_public_id,
        memberDisplayName: row.member_display_name
    };
}

function publicAssignment(assignment, { includeMember = true } = {}) {
    return {
        id: assignment.id,
        status: assignment.status,
        program: {
            id: assignment.programId,
            name: assignment.programName,
            description: assignment.programDescription
        },
        programVersion: {
            versionNumber: assignment.versionNumber,
            status: assignment.versionStatus
        },
        ...(includeMember ? {
            member: {
                membershipId: assignment.memberPublicId,
                displayName: assignment.memberDisplayName
            }
        } : {}),
        startsOn: assignment.startsOn,
        endsOn: assignment.endsOn,
        assignedAt: assignment.assignedAt,
        completedAt: assignment.completedAt,
        cancelledAt: assignment.cancelledAt
    };
}

const ASSIGNMENT_SELECT = `
    SELECT
        pa.id, pa.public_id, pa.studio_id, pa.program_version_id, pa.member_membership_id,
        pa.coaching_relationship_id, pa.status,
        DATE_FORMAT(pa.starts_on, '%Y-%m-%d') AS starts_on,
        DATE_FORMAT(pa.ends_on, '%Y-%m-%d') AS ends_on,
        pa.assigned_at, pa.completed_at, pa.cancelled_at,
        pv.version_number, pv.status AS version_status,
        tp.public_id AS program_public_id, tp.name AS program_name, tp.description AS program_description,
        member.public_id AS member_public_id, member_user.username AS member_display_name
    FROM studio_program_assignments pa
    INNER JOIN studio_training_program_versions pv ON pv.id = pa.program_version_id
    INNER JOIN studio_training_programs tp ON tp.id = pv.program_id
    INNER JOIN studio_memberships member ON member.id = pa.member_membership_id
    INNER JOIN users member_user ON member_user.id = member.user_id
`;

function createProgramAssignmentService({ database, generatePublicId = createPublicId } = {}) {
    if (!database) {
        throw new TypeError("Program assignment service requires a database.");
    }
    const sql = promiseDatabase(database);
    const helpers = createTrainingServiceHelpers(sql);

    async function loadCoachingRelationshipForAssignment(
        connection, studioInternalId, actor, memberMembershipInternalId, relationshipPublicId
    ) {
        const [rows] = await connection.query(
            `SELECT cr.id, cr.public_id, cr.coach_membership_id, cr.member_membership_id, cr.status,
                    coach.status AS coach_status, coach.role AS coach_role
             FROM studio_coaching_relationships cr
             INNER JOIN studio_memberships coach ON coach.id = cr.coach_membership_id
             WHERE cr.studio_id = ? AND cr.public_id = ?
             FOR UPDATE`,
            [studioInternalId, relationshipPublicId]
        );
        if (rows.length === 0) throw new CoachingRelationshipNotFoundError();
        const relationship = rows[0];

        const usable =
            relationship.status === "active" &&
            Number(relationship.member_membership_id) === memberMembershipInternalId &&
            relationship.coach_status === "active" &&
            COACH_ELIGIBLE_ROLES.includes(relationship.coach_role) &&
            (actor.role !== "trainer" || Number(relationship.coach_membership_id) === actor.internalId);

        if (!usable) {
            // Deliberately identical to the "not found" branch above: a relationship
            // that exists but belongs to another member, another trainer, a foreign
            // studio, or is no longer active/eligible must not be distinguishable
            // from one that never existed.
            throw new CoachingRelationshipNotFoundError();
        }
        return relationship;
    }

    async function createAssignment(actorUserId, context, input) {
        return helpers.withLockedStudioAccess(
            context,
            PERMISSIONS.ASSIGNMENT_MANAGE,
            async (connection, studio, actor) => {
                const memberMembership = await helpers.findMembershipByPublicId(
                    connection, studio.internalId, input.memberMembershipId
                );
                if (!memberMembership || memberMembership.status !== "active" || memberMembership.role !== "member") {
                    throw new CoachingRelationshipRequiredError();
                }

                const relationship = await loadCoachingRelationshipForAssignment(
                    connection, studio.internalId, actor, memberMembership.internalId,
                    input.coachingRelationshipId
                );

                const [versionRows] = await connection.query(
                    `SELECT pv.id, pv.version_number, pv.status AS version_status,
                            tp.status AS program_status, tp.id AS program_id
                     FROM studio_training_program_versions pv
                     INNER JOIN studio_training_programs tp ON tp.id = pv.program_id
                     WHERE pv.public_id = ? AND tp.studio_id = ?
                     FOR UPDATE`,
                    [input.programVersionId, studio.internalId]
                );
                if (versionRows.length === 0) throw new ProgramVersionNotFoundError();
                const versionRow = versionRows[0];
                const decision = canAssignProgramVersion({
                    program: { status: versionRow.program_status },
                    version: { status: versionRow.version_status }
                });
                if (!decision.allowed) {
                    throw new ProgramVersionNotPublishedError();
                }

                const publicId = generatePublicId();
                await connection.query(
                    `INSERT INTO studio_program_assignments (
                        public_id, studio_id, program_version_id, member_membership_id,
                        assigned_by_user_id, coaching_relationship_id, status, starts_on, ends_on
                     ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
                    [
                        publicId, studio.internalId, versionRow.id, memberMembership.internalId,
                        actorUserId, relationship.id, input.starts_on, input.ends_on
                    ]
                );

                await helpers.insertAudit(connection, {
                    studioId: studio.internalId,
                    actorUserId,
                    eventType: "training_program_assignment.created",
                    targetType: "program_assignment",
                    targetPublicId: publicId,
                    details: {
                        memberMembershipId: memberMembership.id,
                        versionNumber: Number(versionRow.version_number)
                    }
                });

                const [rows] = await connection.query(`${ASSIGNMENT_SELECT} WHERE pa.public_id = ?`, [publicId]);
                return publicAssignment(assignmentFromRow(rows[0]));
            }
        );
    }

    async function listAssignments(context, pagination) {
        return helpers.withLockedStudioAccess(
            context,
            PERMISSIONS.ASSIGNMENT_LIST,
            async (connection, studio, actor) => {
                const scopedToCoach = actor.role === "trainer";
                const whereClause = scopedToCoach
                    ? `WHERE pa.studio_id = ? AND EXISTS (
                        SELECT 1 FROM studio_coaching_relationships cr
                        WHERE cr.studio_id = pa.studio_id
                          AND cr.member_membership_id = pa.member_membership_id
                          AND cr.coach_membership_id = ?
                          AND cr.status = 'active'
                       )`
                    : "WHERE pa.studio_id = ?";
                const params = scopedToCoach
                    ? [studio.internalId, actor.internalId]
                    : [studio.internalId];

                const [[countRow]] = await connection.query(
                    `SELECT COUNT(*) AS total FROM studio_program_assignments pa ${whereClause}`,
                    params
                );
                const [rows] = await connection.query(
                    `${ASSIGNMENT_SELECT} ${whereClause}
                     ORDER BY pa.assigned_at DESC, pa.id DESC
                     LIMIT ? OFFSET ?`,
                    [...params, pagination.limit, pagination.offset]
                );
                return {
                    programAssignments: rows.map((row) => publicAssignment(assignmentFromRow(row))),
                    pagination: paginationResult(Number(countRow.total), pagination)
                };
            }
        );
    }

    async function getAssignment(context, assignmentPublicId) {
        return helpers.withLockedStudioAccess(
            context,
            PERMISSIONS.ASSIGNMENT_LIST,
            async (connection, studio, actor) => {
                const [rows] = await connection.query(
                    `${ASSIGNMENT_SELECT} WHERE pa.studio_id = ? AND pa.public_id = ?`,
                    [studio.internalId, assignmentPublicId]
                );
                if (rows.length === 0) throw new ProgramAssignmentNotFoundError();
                const assignment = assignmentFromRow(rows[0]);

                if (actor.role === "trainer") {
                    const [relationshipRows] = await connection.query(
                        `SELECT id FROM studio_coaching_relationships
                         WHERE studio_id = ? AND coach_membership_id = ? AND member_membership_id = ? AND status = 'active'`,
                        [studio.internalId, actor.internalId, assignment.memberMembershipInternalId]
                    );
                    if (relationshipRows.length === 0) throw new ProgramAssignmentNotFoundError();
                }

                return publicAssignment(assignment);
            }
        );
    }

    async function updateAssignment(actorUserId, context, assignmentPublicId, changes) {
        return helpers.withLockedStudioAccess(
            context,
            PERMISSIONS.ASSIGNMENT_MANAGE,
            async (connection, studio, actor) => {
                const [rows] = await connection.query(
                    `SELECT id, public_id, member_membership_id, coaching_relationship_id, status
                     FROM studio_program_assignments
                     WHERE studio_id = ? AND public_id = ?
                     FOR UPDATE`,
                    [studio.internalId, assignmentPublicId]
                );
                if (rows.length === 0) throw new ProgramAssignmentNotFoundError();
                const assignment = rows[0];

                if (assignment.status !== "active") {
                    throw new ProgramAssignmentStateError();
                }

                if (actor.role === "trainer") {
                    const [relationshipRows] = await connection.query(
                        `SELECT id, status FROM studio_coaching_relationships
                         WHERE studio_id = ? AND coach_membership_id = ? AND member_membership_id = ? AND status = 'active'
                         FOR UPDATE`,
                        [studio.internalId, actor.internalId, assignment.member_membership_id]
                    );
                    if (relationshipRows.length === 0) throw new ProgramAssignmentNotFoundError();
                }

                const isCompleting = changes.status === "completed";
                const timestampColumn = isCompleting ? "completed_at" : "cancelled_at";
                await connection.query(
                    `UPDATE studio_program_assignments
                     SET status = ?, ${timestampColumn} = CURRENT_TIMESTAMP(6)
                     WHERE id = ?`,
                    [changes.status, assignment.id]
                );

                const [memberRows] = await connection.query(
                    "SELECT public_id FROM studio_memberships WHERE id = ?",
                    [assignment.member_membership_id]
                );
                await helpers.insertAudit(connection, {
                    studioId: studio.internalId,
                    actorUserId,
                    eventType: isCompleting
                        ? "training_program_assignment.completed"
                        : "training_program_assignment.cancelled",
                    targetType: "program_assignment",
                    targetPublicId: assignmentPublicId,
                    details: { memberMembershipId: memberRows[0].public_id }
                });

                const [freshRows] = await connection.query(`${ASSIGNMENT_SELECT} WHERE pa.id = ?`, [assignment.id]);
                return publicAssignment(assignmentFromRow(freshRows[0]));
            }
        );
    }

    async function listOwnAssignments(actorUserId, context, pagination) {
        return helpers.withLockedStudioAccess(
            context,
            PERMISSIONS.ASSIGNMENT_READ_SELF,
            async (connection, studio, actor) => {
                const [[countRow]] = await connection.query(
                    `SELECT COUNT(*) AS total FROM studio_program_assignments pa
                     WHERE pa.studio_id = ? AND pa.member_membership_id = ?`,
                    [studio.internalId, actor.internalId]
                );
                const [rows] = await connection.query(
                    `${ASSIGNMENT_SELECT} WHERE pa.studio_id = ? AND pa.member_membership_id = ?
                     ORDER BY pa.assigned_at DESC, pa.id DESC
                     LIMIT ? OFFSET ?`,
                    [studio.internalId, actor.internalId, pagination.limit, pagination.offset]
                );
                return {
                    programAssignments: rows.map((row) => publicAssignment(
                        assignmentFromRow(row), { includeMember: false }
                    )),
                    pagination: paginationResult(Number(countRow.total), pagination)
                };
            }
        );
    }

    async function getOwnAssignmentDetail(actorUserId, context, assignmentPublicId) {
        return helpers.withLockedStudioAccess(
            context,
            PERMISSIONS.ASSIGNMENT_READ_SELF,
            async (connection, studio, actor) => {
                const [rows] = await connection.query(
                    `${ASSIGNMENT_SELECT}
                     WHERE pa.studio_id = ? AND pa.public_id = ? AND pa.member_membership_id = ?`,
                    [studio.internalId, assignmentPublicId, actor.internalId]
                );
                if (rows.length === 0) throw new ProgramAssignmentNotFoundError();
                const assignment = assignmentFromRow(rows[0]);

                const [dayRows] = await connection.query(
                    `SELECT id, public_id, program_version_id, position, name, instructions, created_at, updated_at
                     FROM studio_training_program_days
                     WHERE program_version_id = ?
                     ORDER BY position ASC`,
                    [assignment.programVersionInternalId]
                );
                let exercisesByDay = new Map();
                if (dayRows.length > 0) {
                    const [exerciseRows] = await connection.query(
                        `SELECT id, public_id, program_day_id, position, exercise_name_snapshot, instructions,
                                target_sets, target_reps_min, target_reps_max, target_weight,
                                target_duration_minutes, target_distance_km, target_rpe, rest_seconds
                         FROM studio_training_program_exercises
                         WHERE program_day_id IN (?)
                         ORDER BY position ASC`,
                        [dayRows.map((row) => row.id)]
                    );
                    exercisesByDay = exerciseRows.reduce((map, row) => {
                        const exercise = exerciseFromRow(row);
                        const list = map.get(exercise.dayInternalId) || [];
                        list.push(exercise);
                        map.set(exercise.dayInternalId, list);
                        return map;
                    }, new Map());
                }

                return {
                    ...publicAssignment(assignment, { includeMember: false }),
                    days: dayRows.map((row) => {
                        const day = dayFromRow(row);
                        return publicDay(day, exercisesByDay.get(day.internalId) || []);
                    })
                };
            }
        );
    }

    return {
        createAssignment,
        getAssignment,
        getOwnAssignmentDetail,
        listAssignments,
        listOwnAssignments,
        updateAssignment
    };
}

module.exports = {
    assignmentFromRow,
    createProgramAssignmentService,
    publicAssignment
};
