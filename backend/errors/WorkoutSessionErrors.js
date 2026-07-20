const { AppError } = require("./AppError");

class WorkoutAssignmentNotAvailableError extends AppError {
    constructor() {
        super({
            status: 409,
            code: "WORKOUT_ASSIGNMENT_NOT_AVAILABLE",
            message: "This assignment is not currently available to start a workout session."
        });
    }
}

class WorkoutDayNotAvailableError extends AppError {
    constructor() {
        super({
            status: 409,
            code: "WORKOUT_DAY_NOT_AVAILABLE",
            message: "The requested training day does not belong to the assigned program version."
        });
    }
}

class WorkoutSessionNotFoundError extends AppError {
    constructor() {
        super({ status: 404, code: "WORKOUT_SESSION_NOT_FOUND", message: "Workout session not found." });
    }
}

class WorkoutSessionNotMutableError extends AppError {
    constructor() {
        super({
            status: 409,
            code: "WORKOUT_SESSION_NOT_MUTABLE",
            message: "A completed or aborted workout session can no longer be changed."
        });
    }
}

class WorkoutSessionAlreadyTerminalError extends AppError {
    constructor() {
        super({
            status: 409,
            code: "WORKOUT_SESSION_ALREADY_TERMINAL",
            message: "This workout session has already been completed or aborted."
        });
    }
}

class WorkoutSessionIncompleteError extends AppError {
    constructor() {
        super({
            status: 409,
            code: "WORKOUT_SESSION_INCOMPLETE",
            message: "The workout session cannot be completed until every exercise is completed or skipped."
        });
    }
}

class WorkoutSessionConflictError extends AppError {
    constructor() {
        super({
            status: 409,
            code: "WORKOUT_SESSION_CONFLICT",
            message: "The workout session was changed by another request. Reload and try again."
        });
    }
}

class WorkoutExerciseNotFoundError extends AppError {
    constructor() {
        super({ status: 404, code: "WORKOUT_EXERCISE_NOT_FOUND", message: "Workout session exercise not found." });
    }
}

class WorkoutExerciseConflictError extends AppError {
    constructor() {
        super({
            status: 409,
            code: "WORKOUT_EXERCISE_CONFLICT",
            message: "The workout exercise was changed by another request. Reload and try again."
        });
    }
}

class WorkoutSetNotFoundError extends AppError {
    constructor() {
        super({ status: 404, code: "WORKOUT_SET_NOT_FOUND", message: "Workout session set not found." });
    }
}

class WorkoutSetConflictError extends AppError {
    constructor() {
        super({
            status: 409,
            code: "WORKOUT_SET_CONFLICT",
            message: "The workout set was changed by another request. Reload and try again."
        });
    }
}

class WorkoutResultInvalidError extends AppError {
    constructor(fields) {
        super({
            status: 400,
            code: "WORKOUT_RESULT_INVALID",
            message: "A completed set requires at least one plausible result metric.",
            fields
        });
    }
}

class WorkoutStartKeyConflictError extends AppError {
    constructor() {
        super({
            status: 409,
            code: "WORKOUT_START_KEY_CONFLICT",
            message: "This idempotency key was already used to start a different workout session."
        });
    }
}

class WorkoutFeedbackSessionNotTerminalError extends AppError {
    constructor() {
        super({
            status: 409,
            code: "WORKOUT_FEEDBACK_SESSION_NOT_TERMINAL",
            message: "Feedback can only be added once the workout session is completed or aborted."
        });
    }
}

class WorkoutFeedbackKeyConflictError extends AppError {
    constructor() {
        super({
            status: 409,
            code: "WORKOUT_FEEDBACK_KEY_CONFLICT",
            message: "This idempotency key was already used to submit different feedback."
        });
    }
}

module.exports = {
    WorkoutAssignmentNotAvailableError,
    WorkoutDayNotAvailableError,
    WorkoutExerciseConflictError,
    WorkoutExerciseNotFoundError,
    WorkoutFeedbackKeyConflictError,
    WorkoutFeedbackSessionNotTerminalError,
    WorkoutResultInvalidError,
    WorkoutSessionAlreadyTerminalError,
    WorkoutSessionConflictError,
    WorkoutSessionIncompleteError,
    WorkoutSessionNotFoundError,
    WorkoutSessionNotMutableError,
    WorkoutSetConflictError,
    WorkoutSetNotFoundError,
    WorkoutStartKeyConflictError
};
