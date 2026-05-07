const MOJIBAKE_PATTERN = /Ã|Â|â|�/;

function normalizeText(value) {
    if (typeof value !== "string") {
        return value;
    }

    if (!MOJIBAKE_PATTERN.test(value)) {
        return value;
    }

    return Buffer.from(value, "latin1").toString("utf8");
}

function mojibakeVariant(value) {
    if (typeof value !== "string") {
        return value;
    }

    return Buffer.from(value, "utf8").toString("latin1");
}

function taxonomyVariants(value) {
    const normalized = normalizeText(value);

    return [...new Set([
        value,
        normalized,
        mojibakeVariant(normalized)
    ].filter(Boolean))];
}

function normalizeExercise(exercise) {
    if (!exercise) {
        return exercise;
    }

    return {
        ...exercise,
        name: normalizeText(exercise.name),
        description: normalizeText(exercise.description),
        category: normalizeText(exercise.category),
        muscle_group: normalizeText(exercise.muscle_group)
    };
}

function normalizeProgressEntry(entry) {
    if (!entry) {
        return entry;
    }

    return {
        ...entry,
        exercise_name: normalizeText(entry.exercise_name),
        category: normalizeText(entry.category),
        muscle_group: normalizeText(entry.muscle_group),
        workout_title: normalizeText(entry.workout_title)
    };
}

module.exports = {
    normalizeText,
    taxonomyVariants,
    normalizeExercise,
    normalizeProgressEntry
};
