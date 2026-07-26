const express = require("express");

const db = require("../config/db");
const authenticateToken = require("../middleware/authMiddleware");
const {
    createStudioContextMiddleware,
    requireStudioPermission
} = require("../middleware/studioContext");
const { PERMISSIONS } = require("../domain/studioPolicy");
const { createStudioService } = require("../services/studioService");
const { createScheduleRuleService } = require("../services/scheduleRuleService");
const { validatePublicId } = require("../validation/trainingProgramValidation");
const {
    validateCreateScheduleRulePayload,
    validateScheduleRulePatchPayload
} = require("../validation/trainingCalendarValidation");

function createAssignmentScheduleRuleV1Router({
    studioService = createStudioService({ database: db.promise() }),
    scheduleRuleService = createScheduleRuleService({ database: db.promise() }),
    authenticate = authenticateToken
} = {}) {
    if (!studioService || !scheduleRuleService) {
        throw new TypeError("Assignment schedule rule v1 router requires studio and schedule rule services.");
    }
    if (typeof authenticate !== "function") {
        throw new TypeError("Assignment schedule rule v1 router requires authentication middleware.");
    }

    const router = express.Router();
    const context = createStudioContextMiddleware({ service: studioService });
    const permission = requireStudioPermission;

    router.post(
        "/studios/:studioId/program-assignments/:assignmentId/schedule-rules",
        authenticate, context, permission(PERMISSIONS.SCHEDULE_RULE_MANAGE),
        async (req, res) => {
            const assignmentId = validatePublicId(req.params.assignmentId, "assignmentId");
            const input = validateCreateScheduleRulePayload(req.body);
            const rule = await scheduleRuleService.createScheduleRule(req.user.id, req.studioContext, assignmentId, input);
            res.status(201).json({ scheduleRule: rule });
        }
    );

    router.get(
        "/studios/:studioId/program-assignments/:assignmentId/schedule-rules",
        authenticate, context, permission(PERMISSIONS.SCHEDULE_RULE_READ),
        async (req, res) => {
            const assignmentId = validatePublicId(req.params.assignmentId, "assignmentId");
            const result = await scheduleRuleService.listScheduleRules(req.studioContext, assignmentId);
            res.json(result);
        }
    );

    router.patch(
        "/studios/:studioId/program-assignments/:assignmentId/schedule-rules/:ruleId",
        authenticate, context, permission(PERMISSIONS.SCHEDULE_RULE_MANAGE),
        async (req, res) => {
            const assignmentId = validatePublicId(req.params.assignmentId, "assignmentId");
            const ruleId = validatePublicId(req.params.ruleId, "ruleId");
            const changes = validateScheduleRulePatchPayload(req.body);
            const rule = await scheduleRuleService.updateScheduleRule(
                req.user.id, req.studioContext, assignmentId, ruleId, changes
            );
            res.json({ scheduleRule: rule });
        }
    );

    return router;
}

// No eager default-instance export here - see the matching comment in
// routes/studioV1.js. The application's single, explicit composition root
// (startup/app.js#defaultRouters) supplies the shared services.
module.exports = { createAssignmentScheduleRuleV1Router };
