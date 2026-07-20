const {
    WorkoutFeedbackKeyConflictError,
    WorkoutFeedbackSessionNotTerminalError,
    WorkoutSessionNotFoundError
} = require("../errors/WorkoutSessionErrors");
const { createPublicId } = require("../domain/studioDomain");
const { PERMISSIONS, workoutFeedbackCreateEligibility } = require("../domain/studioPolicy");
const {
    createTrainingServiceHelpers,
    paginationResult,
    promiseDatabase
} = require("./trainingServiceHelpers");

// ---- Row mapping ----

function feedbackFromRow(row) {
    return {
        internalId: Number(row.id),
        id: row.public_id,
        studioInternalId: Number(row.studio_id),
        sessionInternalId: Number(row.workout_session_id),
        coachingRelationshipInternalId: Number(row.coaching_relationship_id),
        coachMembershipInternalId: Number(row.coach_membership_id),
        authorUserId: Number(row.author_user_id),
        clientFeedbackKey: row.client_feedback_key,
        body: row.body,
        createdAt: row.created_at,
        coachPublicId: row.coach_public_id,
        coachDisplayName: row.coach_display_name
    };
}

function publicFeedback(feedback) {
    return {
        id: feedback.id,
        coach: {
            membershipId: feedback.coachPublicId,
            displayName: feedback.coachDisplayName
        },
        body: feedback.body,
        createdAt: feedback.createdAt
    };
}

const FEEDBACK_SELECT = `
    SELECT
        f.id, f.public_id, f.studio_id, f.workout_session_id, f.coaching_relationship_id,
        f.coach_membership_id, f.author_user_id, f.client_feedback_key, f.body, f.created_at,
        coach.public_id AS coach_public_id, coach_user.username AS coach_display_name
    FROM studio_workout_session_feedback f
    INNER JOIN studio_memberships coach ON coach.id = f.coach_membership_id
    INNER JOIN users coach_user ON coach_user.id = coach.user_id
`;

function createWorkoutFeedbackService({ database, generatePublicId = createPublicId } = {}) {
    if (!database) {
        throw new TypeError("Workout feedback service requires a database.");
    }
    const sql = promiseDatabase(database);
    const helpers = createTrainingServiceHelpers(sql);

    async function loadSessionForFeedback(connection, studioInternalId, sessionPublicId, { lock = false } = {}) {
        const [rows] = await connection.query(
            `SELECT id, status, member_membership_id, coaching_relationship_id
             FROM studio_workout_sessions
             WHERE studio_id = ? AND public_id = ?
             ${lock ? "FOR UPDATE" : ""}`,
            [studioInternalId, sessionPublicId]
        );
        return rows[0] || null;
    }

    async function loadActiveCoachRelationship(connection, studioInternalId, coachMembershipInternalId, memberMembershipInternalId) {
        const [rows] = await connection.query(
            `SELECT id, status
             FROM studio_coaching_relationships
             WHERE studio_id = ? AND coach_membership_id = ? AND member_membership_id = ? AND status = 'active'`,
            [studioInternalId, coachMembershipInternalId, memberMembershipInternalId]
        );
        return rows[0] ? { internalId: Number(rows[0].id), status: rows[0].status } : null;
    }

    // ---- Read (member-own or currently authorized coach) ----

    async function listFeedback(actorUserId, context, sessionPublicId, pagination) {
        return helpers.withLockedStudioAccess(
            context,
            PERMISSIONS.WORKOUT_SESSION_MANAGE_SELF,
            async (connection, studio, actor) => {
                const session = await loadSessionForFeedback(connection, studio.internalId, sessionPublicId);
                if (!session) throw new WorkoutSessionNotFoundError();

                const isOwnSession = Number(session.member_membership_id) === actor.internalId;
                let allowed = isOwnSession;
                if (!allowed) {
                    // Pinned to the session's own coaching_relationship_id, exactly like the
                    // coach session read endpoints: a later, different active relationship
                    // with the same member never grants access to an earlier relationship's
                    // sessions or feedback.
                    const relationship = await loadActiveCoachRelationship(
                        connection, studio.internalId, actor.internalId, session.member_membership_id
                    );
                    allowed = Boolean(relationship) && relationship.internalId === Number(session.coaching_relationship_id);
                }
                if (!allowed) throw new WorkoutSessionNotFoundError();

                const [[countRow]] = await connection.query(
                    `SELECT COUNT(*) AS total FROM studio_workout_session_feedback WHERE workout_session_id = ?`,
                    [session.id]
                );
                const [rows] = await connection.query(
                    `${FEEDBACK_SELECT} WHERE f.workout_session_id = ?
                     ORDER BY f.created_at ASC, f.id ASC
                     LIMIT ? OFFSET ?`,
                    [session.id, pagination.limit, pagination.offset]
                );
                return {
                    workoutSessionFeedback: rows.map((row) => publicFeedback(feedbackFromRow(row))),
                    pagination: paginationResult(Number(countRow.total), pagination)
                };
            }
        );
    }

    // ---- Create (currently authorized coach only, terminal session only) ----

    async function createFeedback(actorUserId, context, sessionPublicId, input) {
        return helpers.withLockedStudioAccess(
            context,
            PERMISSIONS.WORKOUT_RESULT_READ_COACHED,
            async (connection, studio, actor) => {
                const session = await loadSessionForFeedback(connection, studio.internalId, sessionPublicId, { lock: true });
                if (!session) throw new WorkoutSessionNotFoundError();

                // Pinned to the session's own coaching_relationship_id: a currently active
                // relationship with this member only grants feedback rights on sessions it
                // actually covers, never on a different, earlier relationship's sessions.
                const rawRelationship = await loadActiveCoachRelationship(
                    connection, studio.internalId, actor.internalId, session.member_membership_id
                );
                const relationship = rawRelationship && rawRelationship.internalId === Number(session.coaching_relationship_id)
                    ? rawRelationship
                    : null;
                const decision = workoutFeedbackCreateEligibility({
                    actorRole: actor.role,
                    coachingRelationship: relationship,
                    sessionStatus: session.status
                });
                if (!decision.allowed) {
                    // Every denial reason (wrong role, no active relationship, relationship
                    // ended) collapses to the same not-found response as the existing
                    // coach-result-read endpoints (ADR 003): access denial must never be
                    // distinguishable from "this session does not exist", except for the
                    // terminal-status precondition, which is a genuine, non-disclosing
                    // state conflict once access is otherwise established.
                    if (decision.reason === "WORKOUT_FEEDBACK_SESSION_NOT_TERMINAL") {
                        throw new WorkoutFeedbackSessionNotTerminalError();
                    }
                    throw new WorkoutSessionNotFoundError();
                }

                const [existingRows] = await connection.query(
                    `SELECT id, body FROM studio_workout_session_feedback
                     WHERE workout_session_id = ? AND coach_membership_id = ? AND client_feedback_key = ?
                     FOR UPDATE`,
                    [session.id, actor.internalId, input.clientFeedbackKey]
                );
                if (existingRows.length > 0) {
                    if (existingRows[0].body !== input.body) {
                        throw new WorkoutFeedbackKeyConflictError();
                    }
                    const [rows] = await connection.query(`${FEEDBACK_SELECT} WHERE f.id = ?`, [existingRows[0].id]);
                    return publicFeedback(feedbackFromRow(rows[0]));
                }

                const publicId = generatePublicId();
                try {
                    await connection.query(
                        `INSERT INTO studio_workout_session_feedback (
                            public_id, studio_id, workout_session_id, coaching_relationship_id,
                            coach_membership_id, author_user_id, client_feedback_key, body
                         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            publicId, studio.internalId, session.id, relationship.internalId,
                            actor.internalId, actorUserId, input.clientFeedbackKey, input.body
                        ]
                    );
                } catch (error) {
                    if (error.code === "ER_DUP_ENTRY") {
                        const [raceRows] = await connection.query(
                            `SELECT id, body FROM studio_workout_session_feedback
                             WHERE workout_session_id = ? AND coach_membership_id = ? AND client_feedback_key = ?`,
                            [session.id, actor.internalId, input.clientFeedbackKey]
                        );
                        if (raceRows.length > 0 && raceRows[0].body === input.body) {
                            const [rows] = await connection.query(`${FEEDBACK_SELECT} WHERE f.id = ?`, [raceRows[0].id]);
                            return publicFeedback(feedbackFromRow(rows[0]));
                        }
                        throw new WorkoutFeedbackKeyConflictError();
                    }
                    throw error;
                }

                await helpers.insertAudit(connection, {
                    studioId: studio.internalId,
                    actorUserId,
                    eventType: "workout_feedback.created",
                    targetType: "workout_session_feedback",
                    targetPublicId: publicId,
                    details: { feedbackId: publicId, sessionId: sessionPublicId }
                });

                const [rows] = await connection.query(`${FEEDBACK_SELECT} WHERE f.public_id = ?`, [publicId]);
                return publicFeedback(feedbackFromRow(rows[0]));
            }
        );
    }

    return {
        createFeedback,
        listFeedback
    };
}

module.exports = {
    createWorkoutFeedbackService,
    feedbackFromRow,
    publicFeedback
};
