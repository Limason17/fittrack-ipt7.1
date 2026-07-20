const express = require("express");

const db = require("../config/db");
const authenticateToken = require("../middleware/authMiddleware");
const {
    createStudioContextMiddleware,
    requireStudioPermission
} = require("../middleware/studioContext");
const { PERMISSIONS } = require("../domain/studioPolicy");
const { createStudioService } = require("../services/studioService");
const { createWorkoutSessionService } = require("../services/workoutSessionService");
const { createWorkoutFeedbackService } = require("../services/workoutFeedbackService");
const { validatePagination, validatePublicId } = require("../validation/trainingProgramValidation");
const {
    validateCreateSetPayload,
    validateListCoachedSessionsQuery,
    validateListOwnSessionsQuery,
    validateSessionExercisePatchPayload,
    validateSessionPatchPayload,
    validateSessionSetPatchPayload,
    validateStartSessionPayload
} = require("../validation/workoutSessionValidation");
const { validateCreateFeedbackPayload } = require("../validation/workoutFeedbackValidation");

function createWorkoutSessionV1Router({
    studioService = createStudioService({ database: db.promise() }),
    workoutSessionService = createWorkoutSessionService({ database: db.promise() }),
    workoutFeedbackService = createWorkoutFeedbackService({ database: db.promise() }),
    authenticate = authenticateToken
} = {}) {
    if (!studioService || !workoutSessionService || !workoutFeedbackService) {
        throw new TypeError("Workout session v1 router requires studio, workout session, and workout feedback services.");
    }
    if (typeof authenticate !== "function") {
        throw new TypeError("Workout session v1 router requires authentication middleware.");
    }

    const router = express.Router();
    const context = createStudioContextMiddleware({ service: studioService });
    const permission = requireStudioPermission;

    // ---- Start a session from an assignment ----

    router.post(
        "/studios/:studioId/program-assignments/:assignmentId/workout-sessions",
        authenticate, context, permission(PERMISSIONS.WORKOUT_SESSION_MANAGE_SELF),
        async (req, res) => {
            const assignmentId = validatePublicId(req.params.assignmentId, "assignmentId");
            const input = validateStartSessionPayload(req.body);
            const session = await workoutSessionService.startSession(req.user.id, req.studioContext, assignmentId, input);
            res.status(201).json({ workoutSession: session });
        }
    );

    // ---- Member self-access ----

    router.get(
        "/studios/:studioId/workout-sessions/me",
        authenticate, context, permission(PERMISSIONS.WORKOUT_SESSION_MANAGE_SELF),
        async (req, res) => {
            const result = await workoutSessionService.listOwnSessions(
                req.user.id, req.studioContext, validateListOwnSessionsQuery(req.query)
            );
            res.json(result);
        }
    );

    router.get(
        "/studios/:studioId/workout-sessions/:sessionId",
        authenticate, context, permission(PERMISSIONS.WORKOUT_SESSION_MANAGE_SELF),
        async (req, res) => {
            const sessionId = validatePublicId(req.params.sessionId, "sessionId");
            const session = await workoutSessionService.getOwnSession(req.user.id, req.studioContext, sessionId);
            res.json({ workoutSession: session });
        }
    );

    router.patch(
        "/studios/:studioId/workout-sessions/:sessionId",
        authenticate, context, permission(PERMISSIONS.WORKOUT_SESSION_MANAGE_SELF),
        async (req, res) => {
            const sessionId = validatePublicId(req.params.sessionId, "sessionId");
            const input = validateSessionPatchPayload(req.body);
            const session = await workoutSessionService.updateOwnSession(req.user.id, req.studioContext, sessionId, input);
            res.json({ workoutSession: session });
        }
    );

    router.post(
        "/studios/:studioId/workout-sessions/:sessionId/complete",
        authenticate, context, permission(PERMISSIONS.WORKOUT_SESSION_MANAGE_SELF),
        async (req, res) => {
            const sessionId = validatePublicId(req.params.sessionId, "sessionId");
            const session = await workoutSessionService.completeSession(req.user.id, req.studioContext, sessionId);
            res.json({ workoutSession: session });
        }
    );

    router.post(
        "/studios/:studioId/workout-sessions/:sessionId/abort",
        authenticate, context, permission(PERMISSIONS.WORKOUT_SESSION_MANAGE_SELF),
        async (req, res) => {
            const sessionId = validatePublicId(req.params.sessionId, "sessionId");
            const session = await workoutSessionService.abortSession(req.user.id, req.studioContext, sessionId);
            res.json({ workoutSession: session });
        }
    );

    // ---- Session exercises and sets ----

    router.post(
        "/studios/:studioId/workout-sessions/:sessionId/exercises/:exerciseId/sets",
        authenticate, context, permission(PERMISSIONS.WORKOUT_SESSION_MANAGE_SELF),
        async (req, res) => {
            const sessionId = validatePublicId(req.params.sessionId, "sessionId");
            const exerciseId = validatePublicId(req.params.exerciseId, "exerciseId");
            validateCreateSetPayload(req.body);
            const set = await workoutSessionService.createSet(req.user.id, req.studioContext, sessionId, exerciseId);
            res.status(201).json({ workoutSet: set });
        }
    );

    router.patch(
        "/studios/:studioId/workout-sessions/:sessionId/exercises/:exerciseId",
        authenticate, context, permission(PERMISSIONS.WORKOUT_SESSION_MANAGE_SELF),
        async (req, res) => {
            const sessionId = validatePublicId(req.params.sessionId, "sessionId");
            const exerciseId = validatePublicId(req.params.exerciseId, "exerciseId");
            const input = validateSessionExercisePatchPayload(req.body);
            const exercise = await workoutSessionService.updateExercise(
                req.user.id, req.studioContext, sessionId, exerciseId, input
            );
            res.json({ workoutExercise: exercise });
        }
    );

    router.patch(
        "/studios/:studioId/workout-sessions/:sessionId/exercises/:exerciseId/sets/:setId",
        authenticate, context, permission(PERMISSIONS.WORKOUT_SESSION_MANAGE_SELF),
        async (req, res) => {
            const sessionId = validatePublicId(req.params.sessionId, "sessionId");
            const exerciseId = validatePublicId(req.params.exerciseId, "exerciseId");
            const setId = validatePublicId(req.params.setId, "setId");
            const input = validateSessionSetPatchPayload(req.body);
            const set = await workoutSessionService.updateSet(
                req.user.id, req.studioContext, sessionId, exerciseId, setId, input
            );
            res.json({ workoutSet: set });
        }
    );

    // ---- Coach read access ----

    router.get(
        "/studios/:studioId/coached-members/:memberMembershipId/workout-sessions",
        authenticate, context, permission(PERMISSIONS.WORKOUT_RESULT_READ_COACHED),
        async (req, res) => {
            const memberMembershipId = validatePublicId(req.params.memberMembershipId, "memberMembershipId");
            const result = await workoutSessionService.listCoachedMemberSessions(
                req.studioContext, memberMembershipId, validateListCoachedSessionsQuery(req.query)
            );
            res.json(result);
        }
    );

    router.get(
        "/studios/:studioId/coached-members/:memberMembershipId/workout-sessions/:sessionId",
        authenticate, context, permission(PERMISSIONS.WORKOUT_RESULT_READ_COACHED),
        async (req, res) => {
            const memberMembershipId = validatePublicId(req.params.memberMembershipId, "memberMembershipId");
            const sessionId = validatePublicId(req.params.sessionId, "sessionId");
            const session = await workoutSessionService.getCoachedMemberSession(
                req.studioContext, memberMembershipId, sessionId
            );
            res.json({ workoutSession: session });
        }
    );

    // ---- Session feedback (member-own read, coach read/create) ----

    router.get(
        "/studios/:studioId/workout-sessions/:sessionId/feedback",
        authenticate, context, permission(PERMISSIONS.WORKOUT_SESSION_MANAGE_SELF),
        async (req, res) => {
            const sessionId = validatePublicId(req.params.sessionId, "sessionId");
            const result = await workoutFeedbackService.listFeedback(
                req.user.id, req.studioContext, sessionId, validatePagination(req.query)
            );
            res.json(result);
        }
    );

    router.post(
        "/studios/:studioId/workout-sessions/:sessionId/feedback",
        authenticate, context, permission(PERMISSIONS.WORKOUT_RESULT_READ_COACHED),
        async (req, res) => {
            const sessionId = validatePublicId(req.params.sessionId, "sessionId");
            const input = validateCreateFeedbackPayload(req.body);
            const feedback = await workoutFeedbackService.createFeedback(
                req.user.id, req.studioContext, sessionId, input
            );
            res.status(201).json({ workoutSessionFeedback: feedback });
        }
    );

    return router;
}

const defaultRouter = createWorkoutSessionV1Router();

module.exports = defaultRouter;
module.exports.createWorkoutSessionV1Router = createWorkoutSessionV1Router;
