const express = require("express");
const db = require("../config/db");
const authenticateToken = require("../middleware/authMiddleware");
const { createTrainingService } = require("../services/trainingService");
const {
    validatePathId,
    validateProgressPayload
} = require("../validation/trainingValidation");

const router = express.Router();
const trainingService = createTrainingService(db.promise());

router.get("/", authenticateToken, async (req, res) => {
    const progress = await trainingService.listProgress(req.user.id);
    res.json(progress);
});

router.get("/summary", authenticateToken, async (req, res) => {
    const summary = await trainingService.getProgressSummary(req.user.id);
    res.json(summary);
});

router.post("/", authenticateToken, async (req, res) => {
    const input = validateProgressPayload(req.body);
    const progressId = await trainingService.createManualProgress(req.user.id, input);
    res.status(201).json({
        message: "Progress entry created successfully",
        progressId
    });
});

router.delete("/:id", authenticateToken, async (req, res) => {
    const progressId = validatePathId(req.params.id, "progressId");
    await trainingService.deleteProgress(req.user.id, progressId);
    res.json({ message: "Progress entry deleted successfully" });
});

module.exports = router;
