const express = require("express");

const db = require("../config/db");
const authenticateToken = require("../middleware/authMiddleware");
const {
    createStudioContextMiddleware,
    requireStudioPermission
} = require("../middleware/studioContext");
const { PERMISSIONS } = require("../domain/studioPolicy");
const { createStudioService } = require("../services/studioService");
const { createCoachingService } = require("../services/coachingService");
const { createTrainingProgramService } = require("../services/trainingProgramService");
const { createProgramAssignmentService } = require("../services/programAssignmentService");
const {
    validateAssignmentPatchPayload,
    validateCoachingRelationshipPatchPayload,
    validateCoachingRelationshipPayload,
    validateCreateAssignmentPayload,
    validateCreateDayPayload,
    validateCreateExercisePayload,
    validateCreateProgramPayload,
    validateCreateVersionPayload,
    validateDayPatchPayload,
    validateExercisePatchPayload,
    validatePagination,
    validateProgramPatchPayload,
    validatePublicId,
    validateVersionPatchPayload
} = require("../validation/trainingProgramValidation");

function createTrainingProgramV1Router({
    studioService = createStudioService({ database: db.promise() }),
    coachingService = createCoachingService({ database: db.promise() }),
    trainingProgramService = createTrainingProgramService({ database: db.promise() }),
    programAssignmentService = createProgramAssignmentService({ database: db.promise() }),
    authenticate = authenticateToken
} = {}) {
    if (!studioService || !coachingService || !trainingProgramService || !programAssignmentService) {
        throw new TypeError(
            "Training program v1 router requires studio, coaching, program, and assignment services."
        );
    }
    if (typeof authenticate !== "function") {
        throw new TypeError("Training program v1 router requires authentication middleware.");
    }

    const router = express.Router();
    const context = createStudioContextMiddleware({ service: studioService });
    const permission = requireStudioPermission;

    // ---- Coaching relationships ----

    router.get(
        "/studios/:studioId/coaching-relationships",
        authenticate, context, permission(PERMISSIONS.COACHING_LIST),
        async (req, res) => {
            const result = await coachingService.listRelationships(req.studioContext, validatePagination(req.query));
            res.json(result);
        }
    );

    router.post(
        "/studios/:studioId/coaching-relationships",
        authenticate, context, permission(PERMISSIONS.COACHING_MANAGE),
        async (req, res) => {
            const input = validateCoachingRelationshipPayload(req.body);
            const relationship = await coachingService.createRelationship(req.user.id, req.studioContext, input);
            res.status(201).json({ coachingRelationship: relationship });
        }
    );

    router.patch(
        "/studios/:studioId/coaching-relationships/:relationshipId",
        authenticate, context, permission(PERMISSIONS.COACHING_MANAGE),
        async (req, res) => {
            const relationshipId = validatePublicId(req.params.relationshipId, "relationshipId");
            validateCoachingRelationshipPatchPayload(req.body);
            const relationship = await coachingService.endRelationship(req.user.id, req.studioContext, relationshipId);
            res.json({ coachingRelationship: relationship });
        }
    );

    // ---- Training programs ----

    router.get(
        "/studios/:studioId/training-programs",
        authenticate, context, permission(PERMISSIONS.PROGRAM_READ),
        async (req, res) => {
            const result = await trainingProgramService.listPrograms(req.studioContext, validatePagination(req.query));
            res.json(result);
        }
    );

    router.post(
        "/studios/:studioId/training-programs",
        authenticate, context, permission(PERMISSIONS.PROGRAM_MANAGE),
        async (req, res) => {
            const input = validateCreateProgramPayload(req.body);
            const program = await trainingProgramService.createProgram(req.user.id, req.studioContext, input);
            res.status(201).json({ trainingProgram: program });
        }
    );

    router.get(
        "/studios/:studioId/training-programs/:programId",
        authenticate, context, permission(PERMISSIONS.PROGRAM_READ),
        async (req, res) => {
            const programId = validatePublicId(req.params.programId, "programId");
            const program = await trainingProgramService.getProgram(req.studioContext, programId);
            res.json({ trainingProgram: program });
        }
    );

    router.patch(
        "/studios/:studioId/training-programs/:programId",
        authenticate, context, permission(PERMISSIONS.PROGRAM_MANAGE),
        async (req, res) => {
            const programId = validatePublicId(req.params.programId, "programId");
            const input = validateProgramPatchPayload(req.body);
            const program = await trainingProgramService.updateProgram(req.user.id, req.studioContext, programId, input);
            res.json({ trainingProgram: program });
        }
    );

    // ---- Program versions ----

    router.post(
        "/studios/:studioId/training-programs/:programId/versions",
        authenticate, context, permission(PERMISSIONS.PROGRAM_MANAGE),
        async (req, res) => {
            const programId = validatePublicId(req.params.programId, "programId");
            const input = validateCreateVersionPayload(req.body);
            const version = await trainingProgramService.createVersion(req.user.id, req.studioContext, programId, input);
            res.status(201).json({ programVersion: version });
        }
    );

    router.get(
        "/studios/:studioId/training-programs/:programId/versions",
        authenticate, context, permission(PERMISSIONS.PROGRAM_READ),
        async (req, res) => {
            const programId = validatePublicId(req.params.programId, "programId");
            const result = await trainingProgramService.listVersions(
                req.studioContext, programId, validatePagination(req.query)
            );
            res.json(result);
        }
    );

    router.get(
        "/studios/:studioId/training-programs/:programId/versions/:versionId",
        authenticate, context, permission(PERMISSIONS.PROGRAM_READ),
        async (req, res) => {
            const programId = validatePublicId(req.params.programId, "programId");
            const versionId = validatePublicId(req.params.versionId, "versionId");
            const version = await trainingProgramService.getVersion(req.studioContext, programId, versionId);
            res.json({ programVersion: version });
        }
    );

    router.patch(
        "/studios/:studioId/training-programs/:programId/versions/:versionId",
        authenticate, context, permission(PERMISSIONS.PROGRAM_MANAGE),
        async (req, res) => {
            const programId = validatePublicId(req.params.programId, "programId");
            const versionId = validatePublicId(req.params.versionId, "versionId");
            const input = validateVersionPatchPayload(req.body);
            const version = await trainingProgramService.updateVersion(
                req.user.id, req.studioContext, programId, versionId, input
            );
            res.json({ programVersion: version });
        }
    );

    router.post(
        "/studios/:studioId/training-programs/:programId/versions/:versionId/publish",
        authenticate, context, permission(PERMISSIONS.PROGRAM_PUBLISH),
        async (req, res) => {
            const programId = validatePublicId(req.params.programId, "programId");
            const versionId = validatePublicId(req.params.versionId, "versionId");
            const version = await trainingProgramService.publishVersion(
                req.user.id, req.studioContext, programId, versionId
            );
            res.json({ programVersion: version });
        }
    );

    // ---- Program days ----

    router.post(
        "/studios/:studioId/training-programs/:programId/versions/:versionId/days",
        authenticate, context, permission(PERMISSIONS.PROGRAM_MANAGE),
        async (req, res) => {
            const programId = validatePublicId(req.params.programId, "programId");
            const versionId = validatePublicId(req.params.versionId, "versionId");
            const input = validateCreateDayPayload(req.body);
            const day = await trainingProgramService.createDay(
                req.user.id, req.studioContext, programId, versionId, input
            );
            res.status(201).json({ programDay: day });
        }
    );

    router.patch(
        "/studios/:studioId/training-programs/:programId/versions/:versionId/days/:dayId",
        authenticate, context, permission(PERMISSIONS.PROGRAM_MANAGE),
        async (req, res) => {
            const programId = validatePublicId(req.params.programId, "programId");
            const versionId = validatePublicId(req.params.versionId, "versionId");
            const dayId = validatePublicId(req.params.dayId, "dayId");
            const input = validateDayPatchPayload(req.body);
            const day = await trainingProgramService.updateDay(
                req.user.id, req.studioContext, programId, versionId, dayId, input
            );
            res.json({ programDay: day });
        }
    );

    router.delete(
        "/studios/:studioId/training-programs/:programId/versions/:versionId/days/:dayId",
        authenticate, context, permission(PERMISSIONS.PROGRAM_MANAGE),
        async (req, res) => {
            const programId = validatePublicId(req.params.programId, "programId");
            const versionId = validatePublicId(req.params.versionId, "versionId");
            const dayId = validatePublicId(req.params.dayId, "dayId");
            const result = await trainingProgramService.deleteDay(
                req.user.id, req.studioContext, programId, versionId, dayId
            );
            res.json(result);
        }
    );

    // ---- Program exercises ----

    router.post(
        "/studios/:studioId/training-programs/:programId/versions/:versionId/days/:dayId/exercises",
        authenticate, context, permission(PERMISSIONS.PROGRAM_MANAGE),
        async (req, res) => {
            const programId = validatePublicId(req.params.programId, "programId");
            const versionId = validatePublicId(req.params.versionId, "versionId");
            const dayId = validatePublicId(req.params.dayId, "dayId");
            const input = validateCreateExercisePayload(req.body);
            const exercise = await trainingProgramService.createExercise(
                req.user.id, req.studioContext, programId, versionId, dayId, input
            );
            res.status(201).json({ programExercise: exercise });
        }
    );

    router.patch(
        "/studios/:studioId/training-programs/:programId/versions/:versionId/days/:dayId/exercises/:exerciseId",
        authenticate, context, permission(PERMISSIONS.PROGRAM_MANAGE),
        async (req, res) => {
            const programId = validatePublicId(req.params.programId, "programId");
            const versionId = validatePublicId(req.params.versionId, "versionId");
            const dayId = validatePublicId(req.params.dayId, "dayId");
            const exerciseId = validatePublicId(req.params.exerciseId, "exerciseId");
            const input = validateExercisePatchPayload(req.body);
            const exercise = await trainingProgramService.updateExercise(
                req.user.id, req.studioContext, programId, versionId, dayId, exerciseId, input
            );
            res.json({ programExercise: exercise });
        }
    );

    router.delete(
        "/studios/:studioId/training-programs/:programId/versions/:versionId/days/:dayId/exercises/:exerciseId",
        authenticate, context, permission(PERMISSIONS.PROGRAM_MANAGE),
        async (req, res) => {
            const programId = validatePublicId(req.params.programId, "programId");
            const versionId = validatePublicId(req.params.versionId, "versionId");
            const dayId = validatePublicId(req.params.dayId, "dayId");
            const exerciseId = validatePublicId(req.params.exerciseId, "exerciseId");
            const result = await trainingProgramService.deleteExercise(
                req.user.id, req.studioContext, programId, versionId, dayId, exerciseId
            );
            res.json(result);
        }
    );

    // ---- Program assignments ----

    router.get(
        "/studios/:studioId/program-assignments/me",
        authenticate, context, permission(PERMISSIONS.ASSIGNMENT_READ_SELF),
        async (req, res) => {
            const result = await programAssignmentService.listOwnAssignments(
                req.user.id, req.studioContext, validatePagination(req.query)
            );
            res.json(result);
        }
    );

    router.get(
        "/studios/:studioId/program-assignments",
        authenticate, context, permission(PERMISSIONS.ASSIGNMENT_LIST),
        async (req, res) => {
            const result = await programAssignmentService.listAssignments(
                req.studioContext, validatePagination(req.query)
            );
            res.json(result);
        }
    );

    router.post(
        "/studios/:studioId/program-assignments",
        authenticate, context, permission(PERMISSIONS.ASSIGNMENT_MANAGE),
        async (req, res) => {
            const input = validateCreateAssignmentPayload(req.body);
            const assignment = await programAssignmentService.createAssignment(req.user.id, req.studioContext, input);
            res.status(201).json({ programAssignment: assignment });
        }
    );

    router.get(
        "/studios/:studioId/program-assignments/:assignmentId",
        authenticate, context, permission(PERMISSIONS.ASSIGNMENT_LIST),
        async (req, res) => {
            const assignmentId = validatePublicId(req.params.assignmentId, "assignmentId");
            const assignment = await programAssignmentService.getAssignment(req.studioContext, assignmentId);
            res.json({ programAssignment: assignment });
        }
    );

    router.patch(
        "/studios/:studioId/program-assignments/:assignmentId",
        authenticate, context, permission(PERMISSIONS.ASSIGNMENT_MANAGE),
        async (req, res) => {
            const assignmentId = validatePublicId(req.params.assignmentId, "assignmentId");
            const input = validateAssignmentPatchPayload(req.body);
            const assignment = await programAssignmentService.updateAssignment(
                req.user.id, req.studioContext, assignmentId, input
            );
            res.json({ programAssignment: assignment });
        }
    );

    return router;
}

const defaultRouter = createTrainingProgramV1Router();

module.exports = defaultRouter;
module.exports.createTrainingProgramV1Router = createTrainingProgramV1Router;
