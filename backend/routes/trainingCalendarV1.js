const express = require("express");

const db = require("../config/db");
const authenticateToken = require("../middleware/authMiddleware");
const { createTrainingCalendarService } = require("../services/trainingCalendarService");
const { isPublicId } = require("../domain/studioDomain");
const { CalendarEntryNotFoundError } = require("../errors/TrainingCalendarErrors");
const {
    validateCalendarRangeQuery,
    validateCreatePersonalEntryPayload,
    validateEntryActionPayload,
    validateReschedulePayload,
    validateUpdatePersonalEntryPayload
} = require("../validation/trainingCalendarValidation");

function validateEntryId(value) {
    if (!isPublicId(value)) {
        throw new CalendarEntryNotFoundError();
    }
    return value;
}

// Deliberately NOT studio-scoped: a personal calendar is keyed by user_id
// alone (see docs/STAGE_5A1_UNIFIED_CALENDAR_BACKEND.md, "RBAC") - every
// route here uses only the shared authenticateToken middleware, matching
// routes/workouts.js and routes/progress.js rather than
// createStudioContextMiddleware.
function createTrainingCalendarV1Router({
    service = createTrainingCalendarService({ database: db.promise() }),
    authenticate = authenticateToken
} = {}) {
    if (!service || typeof service !== "object") {
        throw new TypeError("Training calendar v1 router requires a training calendar service.");
    }
    if (typeof authenticate !== "function") {
        throw new TypeError("Training calendar v1 router requires authentication middleware.");
    }

    const router = express.Router();

    router.get("/training-calendar", authenticate, async (req, res) => {
        const range = validateCalendarRangeQuery(req.query);
        const result = await service.getCalendar(req.user.id, range);
        res.json(result);
    });

    router.post("/training-calendar", authenticate, async (req, res) => {
        const input = validateCreatePersonalEntryPayload(req.body);
        const entry = await service.createPersonalEntry(req.user.id, input);
        res.status(201).json({ calendarEntry: entry });
    });

    router.patch("/training-calendar/:entryId", authenticate, async (req, res) => {
        const entryId = validateEntryId(req.params.entryId);
        const changes = validateUpdatePersonalEntryPayload(req.body);
        const entry = await service.updatePersonalEntry(req.user.id, entryId, changes);
        res.json({ calendarEntry: entry });
    });

    router.post("/training-calendar/:entryId/reschedule", authenticate, async (req, res) => {
        const entryId = validateEntryId(req.params.entryId);
        const input = validateReschedulePayload(req.body);
        const entry = await service.reschedulePersonalEntry(req.user.id, entryId, input);
        res.json({ calendarEntry: entry });
    });

    router.post("/training-calendar/:entryId/complete", authenticate, async (req, res) => {
        const entryId = validateEntryId(req.params.entryId);
        const input = validateEntryActionPayload(req.body);
        const entry = await service.completePersonalEntry(req.user.id, entryId, input);
        res.json({ calendarEntry: entry });
    });

    router.post("/training-calendar/:entryId/skip", authenticate, async (req, res) => {
        const entryId = validateEntryId(req.params.entryId);
        const input = validateEntryActionPayload(req.body);
        const entry = await service.skipEntry(req.user.id, entryId, input);
        res.json({ calendarEntry: entry });
    });

    router.post("/training-calendar/:entryId/cancel", authenticate, async (req, res) => {
        const entryId = validateEntryId(req.params.entryId);
        const input = validateEntryActionPayload(req.body);
        const entry = await service.cancelEntry(req.user.id, entryId, input);
        res.json({ calendarEntry: entry });
    });

    return router;
}

// No eager default-instance export here - see the matching comment in
// routes/studioV1.js. The application's single, explicit composition root
// (startup/app.js#defaultRouters) supplies the shared calendar service.
module.exports = { createTrainingCalendarV1Router };
