const MOJIBAKE_PATTERN = /Ã|Â|â|�/

export function normalizeText(value) {
    if (typeof value !== 'string') {
        return value
    }

    if (!MOJIBAKE_PATTERN.test(value)) {
        return value
    }

    try {
        return decodeURIComponent(escape(value))
    } catch (error) {
        return value
    }
}

export function normalizeExercise(exercise) {
    if (!exercise) {
        return exercise
    }

    return {
        ...exercise,
        name: normalizeText(exercise.name),
        description: normalizeText(exercise.description),
        category: normalizeText(exercise.category),
        muscle_group: normalizeText(exercise.muscle_group),
    }
}

export function normalizeWorkout(workout) {
    if (!workout) {
        return workout
    }

    return {
        ...workout,
        exercises: (workout.exercises || []).map(normalizeExercise),
    }
}

export function normalizeProgressEntry(entry) {
    if (!entry) {
        return entry
    }

    return {
        ...entry,
        exercise_name: normalizeText(entry.exercise_name),
        category: normalizeText(entry.category),
        muscle_group: normalizeText(entry.muscle_group),
        workout_title: normalizeText(entry.workout_title),
    }
}

export function normalizeProgressSummary(item) {
    if (!item) {
        return item
    }

    return {
        ...item,
        exercise_name: normalizeText(item.exercise_name),
        category: normalizeText(item.category),
        muscle_group: normalizeText(item.muscle_group),
    }
}
