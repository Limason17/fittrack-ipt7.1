const { ValidationError } = require("../errors/AppError");
const { isCardioExercise } = require("../utils/trainingMetrics");

const LIMITS = Object.freeze({
    title: 100,
    notes: 255,
    exercisesPerWorkout: 100,
    sets: 1000,
    reps: 10000,
    weight: 9999.99,
    durationMinutes: 10080,
    distanceKm: 99999.99,
    intensityLevel: 10
});

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(field, message) {
    throw new ValidationError({ [field]: message });
}

function validateDate(value, options = {}) {
    const field = options.field || "date";

    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        fail(field, "A valid date in YYYY-MM-DD format is required.");
    }

    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));

    if (
        parsed.getUTCFullYear() !== year ||
        parsed.getUTCMonth() !== month - 1 ||
        parsed.getUTCDate() !== day
    ) {
        fail(field, "The date does not represent a calendar day.");
    }

    return value;
}

function validateString(value, { field, required = false, maxLength }) {
    if (value === null || value === undefined) {
        if (required) {
            fail(field, "This field is required.");
        }
        return null;
    }

    if (typeof value !== "string") {
        fail(field, "This field must be a string.");
    }

    const normalized = value.trim();

    if (required && !normalized) {
        fail(field, "This field is required.");
    }

    if (normalized.length > maxLength) {
        fail(field, `This field must contain at most ${maxLength} characters.`);
    }

    return normalized || null;
}

function validateNumber(value, {
    field,
    required = false,
    integer = false,
    min = 0,
    max
}) {
    if (value === null || value === undefined) {
        if (required) {
            fail(field, "This field is required.");
        }
        return null;
    }

    if (typeof value !== "number" || !Number.isFinite(value)) {
        fail(field, "This field must be a finite number.");
    }

    if (integer && !Number.isInteger(value)) {
        fail(field, "This field must be an integer.");
    }

    if (value < min || (max !== undefined && value > max)) {
        const range = max === undefined ? `at least ${min}` : `between ${min} and ${max}`;
        fail(field, `This field must be ${range}.`);
    }

    return value;
}

function validatePathId(value, field = "id") {
    if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
        fail(field, "A positive integer identifier is required.");
    }

    const id = Number(value);
    if (!Number.isSafeInteger(id)) {
        fail(field, "The identifier is outside the supported range.");
    }
    return id;
}

function validateTrainingRow(row, prefix = "", { allowWorkoutExerciseId = false } = {}) {
    const field = (name) => prefix ? `${prefix}.${name}` : name;

    if (!isPlainObject(row)) {
        fail(prefix || "exercise", "A training entry must be an object.");
    }

    const result = {
        exercise_id: validateNumber(row.exercise_id, {
            field: field("exercise_id"), required: true, integer: true, min: 1,
            max: Number.MAX_SAFE_INTEGER
        }),
        sets: validateNumber(row.sets, {
            field: field("sets"), integer: true, min: 1, max: LIMITS.sets
        }),
        reps: validateNumber(row.reps, {
            field: field("reps"), integer: true, min: 1, max: LIMITS.reps
        }),
        weight: validateNumber(row.weight, {
            field: field("weight"), min: 0, max: LIMITS.weight
        }),
        duration_minutes: validateNumber(row.duration_minutes, {
            field: field("duration_minutes"), integer: true, min: 1,
            max: LIMITS.durationMinutes
        }),
        distance_km: validateNumber(row.distance_km, {
            field: field("distance_km"), min: 0, max: LIMITS.distanceKm
        }),
        intensity_level: validateNumber(row.intensity_level, {
            field: field("intensity_level"), integer: true, min: 1,
            max: LIMITS.intensityLevel
        })
    };

    if (allowWorkoutExerciseId && Object.hasOwn(row, "workout_exercise_id")) {
        result.workout_exercise_id = validateNumber(row.workout_exercise_id, {
            field: field("workout_exercise_id"), integer: true, min: 1,
            max: Number.MAX_SAFE_INTEGER
        });
    }

    return result;
}

function validateMetricsForExercise(row, exercise, prefix = "") {
    const field = (name) => prefix ? `${prefix}.${name}` : name;

    if (isCardioExercise(exercise)) {
        if (row.duration_minutes === null) {
            fail(field("duration_minutes"), "Duration is required for cardio exercises.");
        }
        if (row.sets !== null || row.reps !== null || row.weight !== null) {
            fail(field("metrics"), "Strength metrics are not allowed for cardio exercises.");
        }
    } else {
        if (row.sets === null || row.reps === null) {
            fail(field("sets"), "Sets and repetitions are required for strength exercises.");
        }
        if (
            row.duration_minutes !== null ||
            row.distance_km !== null ||
            row.intensity_level !== null
        ) {
            fail(field("metrics"), "Cardio metrics are not allowed for strength exercises.");
        }
    }

    return row;
}

function validateWorkoutPayload(body) {
    if (!isPlainObject(body)) {
        fail("body", "A JSON object is required.");
    }

    if (!Array.isArray(body.exercises) || body.exercises.length === 0) {
        fail("exercises", "At least one exercise is required.");
    }

    if (body.exercises.length > LIMITS.exercisesPerWorkout) {
        fail("exercises", `At most ${LIMITS.exercisesPerWorkout} exercises are allowed.`);
    }

    return {
        title: validateString(body.title, {
            field: "title", required: true, maxLength: LIMITS.title
        }),
        workout_date: validateDate(body.workout_date, { field: "workout_date" }),
        notes: validateString(body.notes, {
            field: "notes", maxLength: LIMITS.notes
        }),
        exercises: body.exercises.map((row, index) =>
            validateTrainingRow(row, `exercises.${index}`, {
                allowWorkoutExerciseId: true
            })
        )
    };
}

function validateProgressPayload(body) {
    if (!isPlainObject(body)) {
        fail("body", "A JSON object is required.");
    }

    return {
        ...validateTrainingRow(body),
        entry_date: validateDate(body.entry_date, { field: "entry_date" })
    };
}

module.exports = {
    LIMITS,
    isPlainObject,
    validateDate,
    validateMetricsForExercise,
    validateNumber,
    validatePathId,
    validateProgressPayload,
    validateString,
    validateTrainingRow,
    validateWorkoutPayload
};
