const { normalizeText } = require("./taxonomy");

const MAX_EPLEY_REPS = 100;

function isCardioCategory(category) {
    return normalizeText(category) === "Cardio";
}

function isCardioExercise(exercise) {
    return isCardioCategory(exercise?.category);
}

function positiveInteger(value) {
    if (typeof value !== "number" && typeof value !== "string") {
        return null;
    }

    if (typeof value === "string" && !/^[1-9]\d*$/.test(value)) {
        return null;
    }

    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function nullableNonNegativeNumber(value) {
    if (value === null || value === undefined) {
        return null;
    }

    if (typeof value !== "number") {
        return null;
    }

    return Number.isFinite(value) && value >= 0 ? value : null;
}

function nullablePositiveInteger(value) {
    if (value === "" || value === null || value === undefined) {
        return null;
    }

    return positiveInteger(value);
}

function normalizeTrainingRow(row) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
        return null;
    }

    return {
        exercise_id: positiveInteger(row.exercise_id),
        sets: positiveInteger(row.sets),
        reps: positiveInteger(row.reps),
        weight: nullableNonNegativeNumber(row.weight),
        duration_minutes: positiveInteger(row.duration_minutes),
        distance_km: nullableNonNegativeNumber(row.distance_km),
        intensity_level: nullablePositiveInteger(row.intensity_level)
    };
}

function normalizeTrainingRows(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return null;
    }

    const normalizedRows = rows.map(normalizeTrainingRow);
    const hasInvalidExercise = normalizedRows.some((row) => !row || !row.exercise_id);

    return hasInvalidExercise ? null : normalizedRows;
}

function normalizeRowForExercise(row, exercise) {
    if (isCardioExercise(exercise)) {
        if (!row.duration_minutes) {
            return null;
        }

        return {
            ...row,
            sets: null,
            reps: null,
            weight: null
        };
    }

    if (!row.sets || !row.reps) {
        return null;
    }

    return {
        ...row,
        duration_minutes: null,
        distance_km: null,
        intensity_level: null
    };
}

// Epley formula. Very high repetition counts are intentionally rejected because
// they do not produce a useful one-repetition estimate and magnify bad input.
function estimateOneRepMax(weight, reps) {
    if (
        typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0 ||
        typeof reps !== "number" || !Number.isFinite(reps) || reps <= 0 ||
        reps > MAX_EPLEY_REPS
    ) {
        return null;
    }
    return weight * (1 + reps / 30);
}

module.exports = {
    MAX_EPLEY_REPS,
    estimateOneRepMax,
    isCardioCategory,
    isCardioExercise,
    normalizeRowForExercise,
    normalizeTrainingRow,
    normalizeTrainingRows,
    nullableNonNegativeNumber,
    nullablePositiveInteger,
    positiveInteger
};
