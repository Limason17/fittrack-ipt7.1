const { AppError } = require("./AppError");

class CoachingRelationshipNotFoundError extends AppError {
    constructor() {
        super({
            status: 404,
            code: "COACHING_RELATIONSHIP_NOT_FOUND",
            message: "Coaching relationship not found."
        });
    }
}

class CoachingRelationshipExistsError extends AppError {
    constructor() {
        super({
            status: 409,
            code: "COACHING_RELATIONSHIP_ALREADY_ACTIVE",
            message: "An active coaching relationship already exists for this coach and member."
        });
    }
}

class CoachingRelationshipIneligibleError extends AppError {
    constructor(reason = "COACHING_RELATIONSHIP_INELIGIBLE") {
        super({
            status: 409,
            code: reason,
            message: "The coach or member membership is not eligible for a coaching relationship."
        });
    }
}

class TrainingProgramNotFoundError extends AppError {
    constructor() {
        super({ status: 404, code: "TRAINING_PROGRAM_NOT_FOUND", message: "Training program not found." });
    }
}

class ProgramArchivedError extends AppError {
    constructor() {
        super({
            status: 409,
            code: "TRAINING_PROGRAM_ARCHIVED",
            message: "An archived training program cannot be modified."
        });
    }
}

class ProgramVersionNotFoundError extends AppError {
    constructor() {
        super({ status: 404, code: "PROGRAM_VERSION_NOT_FOUND", message: "Program version not found." });
    }
}

class ProgramVersionNotDraftError extends AppError {
    constructor() {
        super({
            status: 409,
            code: "PROGRAM_VERSION_NOT_DRAFT",
            message: "Only a draft program version can be modified or published."
        });
    }
}

class ProgramDayNotFoundError extends AppError {
    constructor() {
        super({ status: 404, code: "PROGRAM_DAY_NOT_FOUND", message: "Program day not found." });
    }
}

class ProgramExerciseNotFoundError extends AppError {
    constructor() {
        super({ status: 404, code: "PROGRAM_EXERCISE_NOT_FOUND", message: "Program exercise not found." });
    }
}

class ProgramAssignmentNotFoundError extends AppError {
    constructor() {
        super({ status: 404, code: "PROGRAM_ASSIGNMENT_NOT_FOUND", message: "Program assignment not found." });
    }
}

class ProgramVersionNotPublishedError extends AppError {
    constructor() {
        super({
            status: 409,
            code: "PROGRAM_VERSION_NOT_PUBLISHED",
            message: "Only a published program version can be assigned."
        });
    }
}

class ProgramAssignmentStateError extends AppError {
    constructor(message = "The program assignment is not in a state that allows this action.") {
        super({ status: 409, code: "PROGRAM_ASSIGNMENT_INVALID_STATE", message });
    }
}

class CoachingRelationshipRequiredError extends AppError {
    constructor() {
        super({
            status: 409,
            code: "COACHING_RELATIONSHIP_REQUIRED",
            message: "The member has no active coaching relationship in this studio."
        });
    }
}

module.exports = {
    CoachingRelationshipExistsError,
    CoachingRelationshipIneligibleError,
    CoachingRelationshipNotFoundError,
    CoachingRelationshipRequiredError,
    ProgramArchivedError,
    ProgramAssignmentNotFoundError,
    ProgramAssignmentStateError,
    ProgramDayNotFoundError,
    ProgramExerciseNotFoundError,
    ProgramVersionNotDraftError,
    ProgramVersionNotFoundError,
    ProgramVersionNotPublishedError,
    TrainingProgramNotFoundError
};
