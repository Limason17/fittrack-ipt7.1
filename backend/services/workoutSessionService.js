const {
    WorkoutAssignmentNotAvailableError,
    WorkoutDayNotAvailableError,
    WorkoutExerciseConflictError,
    WorkoutExerciseNotFoundError,
    WorkoutResultInvalidError,
    WorkoutSessionAlreadyTerminalError,
    WorkoutSessionConflictError,
    WorkoutSessionIncompleteError,
    WorkoutSessionNotFoundError,
    WorkoutSessionNotMutableError,
    WorkoutSetConflictError,
    WorkoutSetNotFoundError,
    WorkoutStartKeyConflictError
} = require("../errors/WorkoutSessionErrors");
const { createPublicId } = require("../domain/studioDomain");
const { hasAnyResultMetric } = require("../domain/workoutSessionDomain");
const {
    PERMISSIONS,
    canStartWorkoutSession,
    sessionCompletionEligibility,
    workoutResultReadEligibility
} = require("../domain/studioPolicy");
const {
    createTrainingServiceHelpers,
    paginationResult,
    promiseDatabase
} = require("./trainingServiceHelpers");

// ---- Row mapping ----

function sessionFromRow(row) {
    return {
        internalId: Number(row.id),
        id: row.public_id,
        studioInternalId: Number(row.studio_id),
        assignmentInternalId: Number(row.assignment_id),
        memberMembershipInternalId: Number(row.member_membership_id),
        programVersionInternalId: Number(row.program_version_id),
        programDayInternalId: Number(row.program_day_id),
        coachingRelationshipInternalId: Number(row.coaching_relationship_id),
        status: row.status,
        clientStartKey: row.client_start_key,
        revision: Number(row.revision),
        startedAt: row.started_at,
        completedAt: row.completed_at,
        abortedAt: row.aborted_at,
        memberNote: row.member_note,
        assignmentPublicId: row.assignment_public_id,
        programDayPublicId: row.program_day_public_id,
        programDayName: row.program_day_name,
        versionNumber: Number(row.version_number),
        programId: row.program_public_id,
        programName: row.program_name,
        memberPublicId: row.member_public_id,
        memberDisplayName: row.member_display_name
    };
}

function publicSession(session, { includeMember = true } = {}) {
    return {
        id: session.id,
        status: session.status,
        revision: session.revision,
        program: { id: session.programId, name: session.programName },
        programVersion: { versionNumber: session.versionNumber },
        programDay: { id: session.programDayPublicId, name: session.programDayName },
        ...(includeMember ? {
            member: { membershipId: session.memberPublicId, displayName: session.memberDisplayName }
        } : {}),
        startedAt: session.startedAt,
        completedAt: session.completedAt,
        abortedAt: session.abortedAt,
        memberNote: session.memberNote
    };
}

function sessionExerciseFromRow(row) {
    return {
        internalId: Number(row.id),
        id: row.public_id,
        sessionInternalId: Number(row.workout_session_id),
        position: Number(row.position),
        exerciseNameSnapshot: row.exercise_name_snapshot,
        instructionsSnapshot: row.instructions_snapshot,
        targetSets: row.target_sets,
        targetRepsMin: row.target_reps_min,
        targetRepsMax: row.target_reps_max,
        targetWeight: row.target_weight === null ? null : Number(row.target_weight),
        targetDurationMinutes: row.target_duration_minutes,
        targetDistanceKm: row.target_distance_km === null ? null : Number(row.target_distance_km),
        targetRpe: row.target_rpe === null ? null : Number(row.target_rpe),
        restSeconds: row.rest_seconds,
        status: row.status,
        memberNote: row.member_note,
        revision: Number(row.revision)
    };
}

function publicSessionExercise(exercise, sets) {
    return {
        id: exercise.id,
        position: exercise.position,
        exerciseNameSnapshot: exercise.exerciseNameSnapshot,
        instructionsSnapshot: exercise.instructionsSnapshot,
        targetSets: exercise.targetSets,
        targetRepsMin: exercise.targetRepsMin,
        targetRepsMax: exercise.targetRepsMax,
        targetWeight: exercise.targetWeight,
        targetDurationMinutes: exercise.targetDurationMinutes,
        targetDistanceKm: exercise.targetDistanceKm,
        targetRpe: exercise.targetRpe,
        restSeconds: exercise.restSeconds,
        status: exercise.status,
        memberNote: exercise.memberNote,
        revision: exercise.revision,
        ...(sets ? { sets: sets.map(publicSessionSet) } : {})
    };
}

function sessionSetFromRow(row) {
    return {
        internalId: Number(row.id),
        id: row.public_id,
        sessionExerciseInternalId: Number(row.session_exercise_id),
        position: Number(row.position),
        status: row.status,
        actualReps: row.actual_reps,
        actualWeight: row.actual_weight === null ? null : Number(row.actual_weight),
        actualDurationMinutes: row.actual_duration_minutes,
        actualDistanceKm: row.actual_distance_km === null ? null : Number(row.actual_distance_km),
        actualRpe: row.actual_rpe === null ? null : Number(row.actual_rpe),
        memberNote: row.member_note,
        revision: Number(row.revision),
        completedAt: row.completed_at
    };
}

function publicSessionSet(set) {
    return {
        id: set.id,
        position: set.position,
        status: set.status,
        actualReps: set.actualReps,
        actualWeight: set.actualWeight,
        actualDurationMinutes: set.actualDurationMinutes,
        actualDistanceKm: set.actualDistanceKm,
        actualRpe: set.actualRpe,
        memberNote: set.memberNote,
        revision: set.revision,
        completedAt: set.completedAt
    };
}

const SESSION_SELECT = `
    SELECT
        ws.id, ws.public_id, ws.studio_id, ws.assignment_id, ws.member_membership_id,
        ws.program_version_id, ws.program_day_id, ws.coaching_relationship_id,
        ws.status, ws.client_start_key, ws.revision, ws.started_at, ws.completed_at, ws.aborted_at,
        ws.member_note,
        pa.public_id AS assignment_public_id,
        pd.public_id AS program_day_public_id, pd.name AS program_day_name,
        pv.version_number,
        tp.public_id AS program_public_id, tp.name AS program_name,
        member.public_id AS member_public_id, member_user.username AS member_display_name
    FROM studio_workout_sessions ws
    INNER JOIN studio_program_assignments pa ON pa.id = ws.assignment_id
    INNER JOIN studio_training_program_days pd ON pd.id = ws.program_day_id
    INNER JOIN studio_training_program_versions pv ON pv.id = ws.program_version_id
    INNER JOIN studio_training_programs tp ON tp.id = pv.program_id
    INNER JOIN studio_memberships member ON member.id = ws.member_membership_id
    INNER JOIN users member_user ON member_user.id = member.user_id
`;

function createWorkoutSessionService({ database, generatePublicId = createPublicId } = {}) {
    if (!database) {
        throw new TypeError("Workout session service requires a database.");
    }
    const sql = promiseDatabase(database);
    const helpers = createTrainingServiceHelpers(sql);

    async function loadSessionExercisesWithSets(connection, sessionInternalId) {
        const [exerciseRows] = await connection.query(
            `SELECT id, public_id, workout_session_id, position, exercise_name_snapshot, instructions_snapshot,
                    target_sets, target_reps_min, target_reps_max, target_weight, target_duration_minutes,
                    target_distance_km, target_rpe, rest_seconds, status, member_note, revision
             FROM studio_workout_session_exercises
             WHERE workout_session_id = ?
             ORDER BY position ASC`,
            [sessionInternalId]
        );
        let setsByExercise = new Map();
        if (exerciseRows.length > 0) {
            const [setRows] = await connection.query(
                `SELECT id, public_id, session_exercise_id, position, status, actual_reps, actual_weight,
                        actual_duration_minutes, actual_distance_km, actual_rpe, member_note, revision, completed_at
                 FROM studio_workout_session_sets
                 WHERE session_exercise_id IN (?)
                 ORDER BY position ASC`,
                [exerciseRows.map((row) => row.id)]
            );
            setsByExercise = setRows.reduce((map, row) => {
                const set = sessionSetFromRow(row);
                const list = map.get(row.session_exercise_id) || [];
                list.push(set);
                map.set(row.session_exercise_id, list);
                return map;
            }, new Map());
        }
        return exerciseRows.map((row) => {
            const exercise = sessionExerciseFromRow(row);
            return { exercise, sets: setsByExercise.get(exercise.internalId) || [] };
        });
    }

    async function loadSessionDetail(connection, sessionInternalId, { includeMember = false } = {}) {
        const [rows] = await connection.query(`${SESSION_SELECT} WHERE ws.id = ?`, [sessionInternalId]);
        const session = sessionFromRow(rows[0]);
        const exerciseGroups = await loadSessionExercisesWithSets(connection, session.internalId);
        return {
            ...publicSession(session, { includeMember }),
            exercises: exerciseGroups.map(({ exercise, sets }) => publicSessionExercise(exercise, sets))
        };
    }

    async function lockOwnSession(connection, studioInternalId, memberInternalId, sessionPublicId) {
        const [rows] = await connection.query(
            `SELECT id, status, revision
             FROM studio_workout_sessions
             WHERE studio_id = ? AND public_id = ? AND member_membership_id = ?
             FOR UPDATE`,
            [studioInternalId, sessionPublicId, memberInternalId]
        );
        if (rows.length === 0) throw new WorkoutSessionNotFoundError();
        return { internalId: Number(rows[0].id), status: rows[0].status, revision: Number(rows[0].revision) };
    }

    async function lockSessionExercise(connection, sessionInternalId, exercisePublicId) {
        const [rows] = await connection.query(
            `SELECT id, public_id, status, revision
             FROM studio_workout_session_exercises
             WHERE workout_session_id = ? AND public_id = ?
             FOR UPDATE`,
            [sessionInternalId, exercisePublicId]
        );
        if (rows.length === 0) throw new WorkoutExerciseNotFoundError();
        return {
            internalId: Number(rows[0].id),
            id: rows[0].public_id,
            status: rows[0].status,
            revision: Number(rows[0].revision)
        };
    }

    async function loadCoachRelationshipForRead(connection, studioInternalId, actor, memberMembershipInternalId) {
        const [rows] = await connection.query(
            `SELECT id, status
             FROM studio_coaching_relationships
             WHERE studio_id = ? AND coach_membership_id = ? AND member_membership_id = ? AND status = 'active'`,
            [studioInternalId, actor.internalId, memberMembershipInternalId]
        );
        return rows[0] ? { status: rows[0].status } : null;
    }

    // ---- Start ----

    async function startSession(actorUserId, context, assignmentPublicId, input) {
        return helpers.withLockedStudioAccess(
            context,
            PERMISSIONS.WORKOUT_SESSION_MANAGE_SELF,
            async (connection, studio, actor) => {
                const [assignmentRows] = await connection.query(
                    `SELECT pa.id, pa.public_id, pa.status, pa.program_version_id, pa.member_membership_id,
                            pa.coaching_relationship_id,
                            DATE_FORMAT(pa.starts_on, '%Y-%m-%d') AS starts_on,
                            DATE_FORMAT(pa.ends_on, '%Y-%m-%d') AS ends_on
                     FROM studio_program_assignments pa
                     WHERE pa.studio_id = ? AND pa.public_id = ? AND pa.member_membership_id = ?
                     FOR UPDATE`,
                    [studio.internalId, assignmentPublicId, actor.internalId]
                );
                if (assignmentRows.length === 0) throw new WorkoutAssignmentNotAvailableError();
                const assignment = assignmentRows[0];

                const [relRows] = await connection.query(
                    `SELECT id, status FROM studio_coaching_relationships WHERE id = ? AND studio_id = ? FOR UPDATE`,
                    [assignment.coaching_relationship_id, studio.internalId]
                );
                const relationship = relRows[0] ? { status: relRows[0].status } : null;

                const [dayRows] = await connection.query(
                    `SELECT id, public_id, program_version_id
                     FROM studio_training_program_days
                     WHERE public_id = ?`,
                    [input.programDayId]
                );
                const programDay = dayRows[0] || null;

                const [[todayRow]] = await connection.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS today");

                const decision = canStartWorkoutSession({
                    assignment: {
                        status: assignment.status,
                        startsOn: assignment.starts_on,
                        endsOn: assignment.ends_on,
                        programVersionId: assignment.program_version_id
                    },
                    coachingRelationship: relationship,
                    programDay: programDay ? { programVersionId: programDay.program_version_id } : null,
                    today: todayRow.today
                });
                if (!decision.allowed) {
                    if (decision.reason === "WORKOUT_DAY_NOT_AVAILABLE") throw new WorkoutDayNotAvailableError();
                    throw new WorkoutAssignmentNotAvailableError();
                }

                const [existingRows] = await connection.query(
                    `SELECT id, assignment_id, program_day_id
                     FROM studio_workout_sessions
                     WHERE member_membership_id = ? AND client_start_key = ?
                     FOR UPDATE`,
                    [actor.internalId, input.clientStartKey]
                );
                if (existingRows.length > 0) {
                    const existing = existingRows[0];
                    if (
                        Number(existing.assignment_id) !== assignment.id ||
                        Number(existing.program_day_id) !== programDay.id
                    ) {
                        throw new WorkoutStartKeyConflictError();
                    }
                    return await loadSessionDetail(connection, existing.id, { includeMember: false });
                }

                const publicId = generatePublicId();
                let sessionInternalId;
                try {
                    const [insertResult] = await connection.query(
                        `INSERT INTO studio_workout_sessions (
                            public_id, studio_id, assignment_id, member_membership_id, program_version_id,
                            program_day_id, coaching_relationship_id, status, client_start_key
                         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'in_progress', ?)`,
                        [
                            publicId, studio.internalId, assignment.id, actor.internalId,
                            assignment.program_version_id, programDay.id, assignment.coaching_relationship_id,
                            input.clientStartKey
                        ]
                    );
                    sessionInternalId = insertResult.insertId;
                } catch (error) {
                    if (error.code === "ER_DUP_ENTRY") {
                        const [raceRows] = await connection.query(
                            `SELECT id, assignment_id, program_day_id
                             FROM studio_workout_sessions
                             WHERE member_membership_id = ? AND assignment_id = ? AND client_start_key = ?`,
                            [actor.internalId, assignment.id, input.clientStartKey]
                        );
                        if (raceRows.length > 0) {
                            return await loadSessionDetail(connection, raceRows[0].id, { includeMember: false });
                        }
                        throw new WorkoutStartKeyConflictError();
                    }
                    throw error;
                }

                const [exerciseRows] = await connection.query(
                    `SELECT id, position, exercise_name_snapshot, instructions, target_sets, target_reps_min,
                            target_reps_max, target_weight, target_duration_minutes, target_distance_km,
                            target_rpe, rest_seconds
                     FROM studio_training_program_exercises
                     WHERE program_day_id = ?
                     ORDER BY position ASC`,
                    [programDay.id]
                );
                for (const exercise of exerciseRows) {
                    const exercisePublicId = generatePublicId();
                    const [exerciseResult] = await connection.query(
                        `INSERT INTO studio_workout_session_exercises (
                            public_id, workout_session_id, source_program_exercise_id, position,
                            exercise_name_snapshot, instructions_snapshot, target_sets, target_reps_min,
                            target_reps_max, target_weight, target_duration_minutes, target_distance_km,
                            target_rpe, rest_seconds
                         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            exercisePublicId, sessionInternalId, exercise.id, exercise.position,
                            exercise.exercise_name_snapshot, exercise.instructions, exercise.target_sets,
                            exercise.target_reps_min, exercise.target_reps_max, exercise.target_weight,
                            exercise.target_duration_minutes, exercise.target_distance_km, exercise.target_rpe,
                            exercise.rest_seconds
                        ]
                    );
                    const targetSets = Number(exercise.target_sets) || 0;
                    for (let position = 1; position <= targetSets; position += 1) {
                        await connection.query(
                            `INSERT INTO studio_workout_session_sets (public_id, session_exercise_id, position)
                             VALUES (?, ?, ?)`,
                            [generatePublicId(), exerciseResult.insertId, position]
                        );
                    }
                }

                await helpers.insertAudit(connection, {
                    studioId: studio.internalId,
                    actorUserId,
                    eventType: "workout_session.started",
                    targetType: "workout_session",
                    targetPublicId: publicId,
                    details: {
                        assignmentId: assignment.public_id,
                        programDayId: programDay.public_id
                    }
                });

                return await loadSessionDetail(connection, sessionInternalId, { includeMember: false });
            }
        );
    }

    // ---- Member self-access ----

    async function listOwnSessions(actorUserId, context, pagination) {
        return helpers.withLockedStudioAccess(
            context,
            PERMISSIONS.WORKOUT_SESSION_MANAGE_SELF,
            async (connection, studio, actor) => {
                const [[countRow]] = await connection.query(
                    `SELECT COUNT(*) AS total FROM studio_workout_sessions
                     WHERE studio_id = ? AND member_membership_id = ?`,
                    [studio.internalId, actor.internalId]
                );
                const [rows] = await connection.query(
                    `${SESSION_SELECT} WHERE ws.studio_id = ? AND ws.member_membership_id = ?
                     ORDER BY ws.started_at DESC, ws.id DESC
                     LIMIT ? OFFSET ?`,
                    [studio.internalId, actor.internalId, pagination.limit, pagination.offset]
                );
                return {
                    workoutSessions: rows.map((row) => publicSession(sessionFromRow(row), { includeMember: false })),
                    pagination: paginationResult(Number(countRow.total), pagination)
                };
            }
        );
    }

    async function getOwnSession(actorUserId, context, sessionPublicId) {
        return helpers.withLockedStudioAccess(
            context,
            PERMISSIONS.WORKOUT_SESSION_MANAGE_SELF,
            async (connection, studio, actor) => {
                const [rows] = await connection.query(
                    `${SESSION_SELECT} WHERE ws.studio_id = ? AND ws.public_id = ? AND ws.member_membership_id = ?`,
                    [studio.internalId, sessionPublicId, actor.internalId]
                );
                if (rows.length === 0) throw new WorkoutSessionNotFoundError();
                const session = sessionFromRow(rows[0]);
                const exerciseGroups = await loadSessionExercisesWithSets(connection, session.internalId);
                return {
                    ...publicSession(session, { includeMember: false }),
                    exercises: exerciseGroups.map(({ exercise, sets }) => publicSessionExercise(exercise, sets))
                };
            }
        );
    }

    async function updateOwnSession(actorUserId, context, sessionPublicId, changes) {
        return helpers.withLockedStudioAccess(
            context,
            PERMISSIONS.WORKOUT_SESSION_MANAGE_SELF,
            async (connection, studio, actor) => {
                const session = await lockOwnSession(connection, studio.internalId, actor.internalId, sessionPublicId);
                if (session.status !== "in_progress") throw new WorkoutSessionNotMutableError();

                const [result] = await connection.query(
                    `UPDATE studio_workout_sessions
                     SET member_note = ?, revision = revision + 1
                     WHERE id = ? AND revision = ?`,
                    [changes.member_note, session.internalId, changes.expectedRevision]
                );
                if (result.affectedRows === 0) throw new WorkoutSessionConflictError();

                return await loadSessionDetail(connection, session.internalId, { includeMember: false });
            }
        );
    }

    async function completeSession(actorUserId, context, sessionPublicId) {
        return helpers.withLockedStudioAccess(
            context,
            PERMISSIONS.WORKOUT_SESSION_MANAGE_SELF,
            async (connection, studio, actor) => {
                const session = await lockOwnSession(connection, studio.internalId, actor.internalId, sessionPublicId);
                if (session.status !== "in_progress") throw new WorkoutSessionAlreadyTerminalError();

                const exerciseGroups = await loadSessionExercisesWithSets(connection, session.internalId);
                const decision = sessionCompletionEligibility({
                    exercises: exerciseGroups.map(({ exercise, sets }) => ({
                        status: exercise.status,
                        sets: sets.map((set) => ({ status: set.status }))
                    }))
                });
                if (!decision.allowed) throw new WorkoutSessionIncompleteError();

                const [result] = await connection.query(
                    `UPDATE studio_workout_sessions
                     SET status = 'completed', completed_at = CURRENT_TIMESTAMP(6), revision = revision + 1
                     WHERE id = ? AND status = 'in_progress'`,
                    [session.internalId]
                );
                if (result.affectedRows === 0) throw new WorkoutSessionConflictError();

                await helpers.insertAudit(connection, {
                    studioId: studio.internalId,
                    actorUserId,
                    eventType: "workout_session.completed",
                    targetType: "workout_session",
                    targetPublicId: sessionPublicId,
                    details: {}
                });

                return await loadSessionDetail(connection, session.internalId, { includeMember: false });
            }
        );
    }

    async function abortSession(actorUserId, context, sessionPublicId) {
        return helpers.withLockedStudioAccess(
            context,
            PERMISSIONS.WORKOUT_SESSION_MANAGE_SELF,
            async (connection, studio, actor) => {
                const session = await lockOwnSession(connection, studio.internalId, actor.internalId, sessionPublicId);
                if (session.status !== "in_progress") throw new WorkoutSessionAlreadyTerminalError();

                const [result] = await connection.query(
                    `UPDATE studio_workout_sessions
                     SET status = 'aborted', aborted_at = CURRENT_TIMESTAMP(6), revision = revision + 1
                     WHERE id = ? AND status = 'in_progress'`,
                    [session.internalId]
                );
                if (result.affectedRows === 0) throw new WorkoutSessionConflictError();

                await helpers.insertAudit(connection, {
                    studioId: studio.internalId,
                    actorUserId,
                    eventType: "workout_session.aborted",
                    targetType: "workout_session",
                    targetPublicId: sessionPublicId,
                    details: {}
                });

                return await loadSessionDetail(connection, session.internalId, { includeMember: false });
            }
        );
    }

    async function createSet(actorUserId, context, sessionPublicId, exercisePublicId) {
        return helpers.withLockedStudioAccess(
            context,
            PERMISSIONS.WORKOUT_SESSION_MANAGE_SELF,
            async (connection, studio, actor) => {
                const session = await lockOwnSession(connection, studio.internalId, actor.internalId, sessionPublicId);
                if (session.status !== "in_progress") throw new WorkoutSessionNotMutableError();
                const exercise = await lockSessionExercise(connection, session.internalId, exercisePublicId);

                const [[maxRow]] = await connection.query(
                    `SELECT COALESCE(MAX(position), 0) AS max_position
                     FROM studio_workout_session_sets WHERE session_exercise_id = ?`,
                    [exercise.internalId]
                );
                const position = Number(maxRow.max_position) + 1;
                const publicId = generatePublicId();
                await connection.query(
                    `INSERT INTO studio_workout_session_sets (public_id, session_exercise_id, position)
                     VALUES (?, ?, ?)`,
                    [publicId, exercise.internalId, position]
                );

                const [rows] = await connection.query(
                    `SELECT id, public_id, session_exercise_id, position, status, actual_reps, actual_weight,
                            actual_duration_minutes, actual_distance_km, actual_rpe, member_note, revision, completed_at
                     FROM studio_workout_session_sets WHERE public_id = ?`,
                    [publicId]
                );
                return publicSessionSet(sessionSetFromRow(rows[0]));
            }
        );
    }

    async function updateExercise(actorUserId, context, sessionPublicId, exercisePublicId, changes) {
        return helpers.withLockedStudioAccess(
            context,
            PERMISSIONS.WORKOUT_SESSION_MANAGE_SELF,
            async (connection, studio, actor) => {
                const session = await lockOwnSession(connection, studio.internalId, actor.internalId, sessionPublicId);
                if (session.status !== "in_progress") throw new WorkoutSessionNotMutableError();
                const exercise = await lockSessionExercise(connection, session.internalId, exercisePublicId);

                const setClauses = ["revision = revision + 1"];
                const values = [];
                if (changes.status !== undefined) {
                    setClauses.push("status = ?");
                    values.push(changes.status);
                }
                if (changes.member_note !== undefined) {
                    setClauses.push("member_note = ?");
                    values.push(changes.member_note);
                }

                const [result] = await connection.query(
                    `UPDATE studio_workout_session_exercises SET ${setClauses.join(", ")}
                     WHERE id = ? AND revision = ?`,
                    [...values, exercise.internalId, changes.expectedRevision]
                );
                if (result.affectedRows === 0) throw new WorkoutExerciseConflictError();

                const [rows] = await connection.query(
                    `SELECT id, public_id, workout_session_id, position, exercise_name_snapshot, instructions_snapshot,
                            target_sets, target_reps_min, target_reps_max, target_weight, target_duration_minutes,
                            target_distance_km, target_rpe, rest_seconds, status, member_note, revision
                     FROM studio_workout_session_exercises WHERE id = ?`,
                    [exercise.internalId]
                );
                return publicSessionExercise(sessionExerciseFromRow(rows[0]));
            }
        );
    }

    async function updateSet(actorUserId, context, sessionPublicId, exercisePublicId, setPublicId, changes) {
        return helpers.withLockedStudioAccess(
            context,
            PERMISSIONS.WORKOUT_SESSION_MANAGE_SELF,
            async (connection, studio, actor) => {
                const session = await lockOwnSession(connection, studio.internalId, actor.internalId, sessionPublicId);
                if (session.status !== "in_progress") throw new WorkoutSessionNotMutableError();
                const exercise = await lockSessionExercise(connection, session.internalId, exercisePublicId);

                const [setRows] = await connection.query(
                    `SELECT id, public_id, status, actual_reps, actual_weight, actual_duration_minutes,
                            actual_distance_km, actual_rpe, member_note, revision
                     FROM studio_workout_session_sets
                     WHERE session_exercise_id = ? AND public_id = ?
                     FOR UPDATE`,
                    [exercise.internalId, setPublicId]
                );
                if (setRows.length === 0) throw new WorkoutSetNotFoundError();
                const set = setRows[0];

                const nextStatus = changes.status !== undefined ? changes.status : set.status;
                const merged = {
                    actualReps: changes.actual_reps !== undefined ? changes.actual_reps : set.actual_reps,
                    actualWeight: changes.actual_weight !== undefined ? changes.actual_weight : set.actual_weight,
                    actualDurationMinutes: changes.actual_duration_minutes !== undefined
                        ? changes.actual_duration_minutes : set.actual_duration_minutes,
                    actualDistanceKm: changes.actual_distance_km !== undefined
                        ? changes.actual_distance_km : set.actual_distance_km,
                    actualRpe: changes.actual_rpe !== undefined ? changes.actual_rpe : set.actual_rpe
                };
                if (nextStatus === "completed" && !hasAnyResultMetric(merged)) {
                    throw new WorkoutResultInvalidError({
                        result: "A completed set requires at least one result metric."
                    });
                }

                const setClauses = ["revision = revision + 1"];
                const values = [];
                if (changes.status !== undefined) {
                    setClauses.push("status = ?");
                    values.push(changes.status);
                    setClauses.push("completed_at = ?");
                    values.push(changes.status === "completed" ? new Date() : null);
                }
                for (const field of [
                    "actual_reps", "actual_weight", "actual_duration_minutes",
                    "actual_distance_km", "actual_rpe", "member_note"
                ]) {
                    if (changes[field] !== undefined) {
                        setClauses.push(`${field} = ?`);
                        values.push(changes[field]);
                    }
                }

                const [result] = await connection.query(
                    `UPDATE studio_workout_session_sets SET ${setClauses.join(", ")}
                     WHERE id = ? AND revision = ?`,
                    [...values, set.id, changes.expectedRevision]
                );
                if (result.affectedRows === 0) throw new WorkoutSetConflictError();

                const [rows] = await connection.query(
                    `SELECT id, public_id, session_exercise_id, position, status, actual_reps, actual_weight,
                            actual_duration_minutes, actual_distance_km, actual_rpe, member_note, revision, completed_at
                     FROM studio_workout_session_sets WHERE id = ?`,
                    [set.id]
                );
                return publicSessionSet(sessionSetFromRow(rows[0]));
            }
        );
    }

    // ---- Coach read access ----

    async function listCoachedMemberSessions(context, memberMembershipPublicId, pagination) {
        return helpers.withLockedStudioAccess(
            context,
            PERMISSIONS.WORKOUT_RESULT_READ_COACHED,
            async (connection, studio, actor) => {
                const memberMembership = await helpers.findMembershipByPublicId(
                    connection, studio.internalId, memberMembershipPublicId, { lock: false }
                );
                if (!memberMembership || memberMembership.status !== "active" || memberMembership.role !== "member") {
                    throw new WorkoutSessionNotFoundError();
                }
                const relationship = await loadCoachRelationshipForRead(
                    connection, studio.internalId, actor, memberMembership.internalId
                );
                const decision = workoutResultReadEligibility({
                    actorRole: actor.role,
                    coachingRelationship: relationship
                });
                if (!decision.allowed) throw new WorkoutSessionNotFoundError();

                const [[countRow]] = await connection.query(
                    `SELECT COUNT(*) AS total FROM studio_workout_sessions
                     WHERE studio_id = ? AND member_membership_id = ?`,
                    [studio.internalId, memberMembership.internalId]
                );
                const [rows] = await connection.query(
                    `${SESSION_SELECT} WHERE ws.studio_id = ? AND ws.member_membership_id = ?
                     ORDER BY ws.started_at DESC, ws.id DESC
                     LIMIT ? OFFSET ?`,
                    [studio.internalId, memberMembership.internalId, pagination.limit, pagination.offset]
                );
                return {
                    workoutSessions: rows.map((row) => publicSession(sessionFromRow(row), { includeMember: true })),
                    pagination: paginationResult(Number(countRow.total), pagination)
                };
            }
        );
    }

    async function getCoachedMemberSession(context, memberMembershipPublicId, sessionPublicId) {
        return helpers.withLockedStudioAccess(
            context,
            PERMISSIONS.WORKOUT_RESULT_READ_COACHED,
            async (connection, studio, actor) => {
                const memberMembership = await helpers.findMembershipByPublicId(
                    connection, studio.internalId, memberMembershipPublicId, { lock: false }
                );
                if (!memberMembership || memberMembership.status !== "active" || memberMembership.role !== "member") {
                    throw new WorkoutSessionNotFoundError();
                }
                const relationship = await loadCoachRelationshipForRead(
                    connection, studio.internalId, actor, memberMembership.internalId
                );
                const decision = workoutResultReadEligibility({
                    actorRole: actor.role,
                    coachingRelationship: relationship
                });
                if (!decision.allowed) throw new WorkoutSessionNotFoundError();

                const [rows] = await connection.query(
                    `${SESSION_SELECT} WHERE ws.studio_id = ? AND ws.public_id = ? AND ws.member_membership_id = ?`,
                    [studio.internalId, sessionPublicId, memberMembership.internalId]
                );
                if (rows.length === 0) throw new WorkoutSessionNotFoundError();
                const session = sessionFromRow(rows[0]);
                const exerciseGroups = await loadSessionExercisesWithSets(connection, session.internalId);
                return {
                    ...publicSession(session, { includeMember: true }),
                    exercises: exerciseGroups.map(({ exercise, sets }) => publicSessionExercise(exercise, sets))
                };
            }
        );
    }

    return {
        abortSession,
        completeSession,
        createSet,
        getCoachedMemberSession,
        getOwnSession,
        listCoachedMemberSessions,
        listOwnSessions,
        startSession,
        updateExercise,
        updateOwnSession,
        updateSet
    };
}

module.exports = {
    createWorkoutSessionService,
    publicSession,
    publicSessionExercise,
    publicSessionSet,
    sessionExerciseFromRow,
    sessionFromRow,
    sessionSetFromRow
};
