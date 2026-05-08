const { normalizeText } = require("./taxonomy");

function isCardioCategory(category) {
    return normalizeText(category) === "Cardio";
}

function isCardioExercise(exercise) {
    return isCardioCategory(exercise?.category);
}

function positiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
}

function nullableNonNegativeNumber(value) {
    if (value === "" || value === null || value === undefined) {
        return null;
    }

    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
}

function nullablePositiveInteger(value) {
    if (value === "" || value === null || value === undefined) {
        return null;
    }

    return positiveInteger(value);
}

function normalizeTrainingRow(row) {
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
    const hasInvalidExercise = normalizedRows.some((row) => !row.exercise_id);

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

module.exports = {
    isCardioCategory,
    isCardioExercise,
    normalizeRowForExercise,
    normalizeTrainingRow,
    normalizeTrainingRows,
    nullableNonNegativeNumber,
    nullablePositiveInteger,
    positiveInteger
};
