const express = require("express");
const db = require("../config/db");
const authenticateToken = require("../middleware/authMiddleware");
const { createTrainingService } = require("../services/trainingService");
const {
    validatePathId,
    validateWorkoutPayload
} = require("../validation/trainingValidation");

const router = express.Router();
const trainingService = createTrainingService(db.promise());

router.get("/", authenticateToken, async (req, res) => {
    const workouts = await trainingService.listWorkouts(req.user.id);
    res.json(workouts);
});

router.post("/", authenticateToken, async (req, res) => {
    const input = validateWorkoutPayload(req.body);
    const workoutId = await trainingService.createWorkout(req.user.id, input);
    res.status(201).json({
        message: "Workout created successfully",
        workoutId
    });
});

router.put("/:id", authenticateToken, async (req, res) => {
    const workoutId = validatePathId(req.params.id, "workoutId");
    const input = validateWorkoutPayload(req.body);
    await trainingService.updateWorkout(req.user.id, workoutId, input);
    res.json({ message: "Workout updated successfully" });
});

router.delete("/:id", authenticateToken, async (req, res) => {
    const workoutId = validatePathId(req.params.id, "workoutId");
    await trainingService.deleteWorkout(req.user.id, workoutId);
    res.json({ message: "Workout deleted successfully" });
});

module.exports = router;
