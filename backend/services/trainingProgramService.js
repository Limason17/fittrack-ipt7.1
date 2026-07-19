const { ConflictError } = require("../errors/AppError");
const {
    ProgramArchivedError,
    ProgramDayNotFoundError,
    ProgramExerciseNotFoundError,
    ProgramVersionNotDraftError,
    ProgramVersionNotFoundError,
    TrainingProgramNotFoundError
} = require("../errors/TrainingProgramErrors");
const { createPublicId } = require("../domain/studioDomain");
const {
    PERMISSIONS,
    canMutateProgramVersion,
    canPublishProgramVersion
} = require("../domain/studioPolicy");
const {
    createTrainingServiceHelpers,
    paginationResult,
    promiseDatabase
} = require("./trainingServiceHelpers");

const REORDER_OFFSET = 100000;

function programFromRow(row) {
    return {
        internalId: Number(row.id),
        id: row.public_id,
        name: row.name,
        description: row.description,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

function publicProgram(program) {
    return {
        id: program.id,
        name: program.name,
        description: program.description,
        status: program.status,
        createdAt: program.createdAt,
        updatedAt: program.updatedAt
    };
}

function versionFromRow(row) {
    return {
        internalId: Number(row.id),
        id: row.public_id,
        programInternalId: Number(row.program_id),
        versionNumber: Number(row.version_number),
        status: row.status,
        notes: row.notes,
        publishedAt: row.published_at,
        createdAt: row.created_at
    };
}

function publicVersion(version) {
    return {
        id: version.id,
        versionNumber: version.versionNumber,
        status: version.status,
        notes: version.notes,
        publishedAt: version.publishedAt,
        createdAt: version.createdAt
    };
}

function dayFromRow(row) {
    return {
        internalId: Number(row.id),
        id: row.public_id,
        versionInternalId: Number(row.program_version_id),
        position: Number(row.position),
        name: row.name,
        instructions: row.instructions,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

function publicDay(day, exercises) {
    return {
        id: day.id,
        position: day.position,
        name: day.name,
        instructions: day.instructions,
        ...(exercises ? { exercises: exercises.map(publicExercise) } : {})
    };
}

function exerciseFromRow(row) {
    return {
        internalId: Number(row.id),
        id: row.public_id,
        dayInternalId: Number(row.program_day_id),
        position: Number(row.position),
        exerciseNameSnapshot: row.exercise_name_snapshot,
        instructions: row.instructions,
        targetSets: row.target_sets,
        targetRepsMin: row.target_reps_min,
        targetRepsMax: row.target_reps_max,
        targetWeight: row.target_weight === null ? null : Number(row.target_weight),
        targetDurationMinutes: row.target_duration_minutes,
        targetDistanceKm: row.target_distance_km === null ? null : Number(row.target_distance_km),
        targetRpe: row.target_rpe === null ? null : Number(row.target_rpe),
        restSeconds: row.rest_seconds
    };
}

function publicExercise(exercise) {
    return {
        id: exercise.id,
        position: exercise.position,
        exerciseNameSnapshot: exercise.exerciseNameSnapshot,
        instructions: exercise.instructions,
        targetSets: exercise.targetSets,
        targetRepsMin: exercise.targetRepsMin,
        targetRepsMax: exercise.targetRepsMax,
        targetWeight: exercise.targetWeight,
        targetDurationMinutes: exercise.targetDurationMinutes,
        targetDistanceKm: exercise.targetDistanceKm,
        targetRpe: exercise.targetRpe,
        restSeconds: exercise.restSeconds
    };
}

function updateStatement(changes, columns) {
    const fields = Object.keys(changes).filter((field) => Object.hasOwn(columns, field));
    return {
        fields,
        assignments: fields.map((field) => `${columns[field]} = ?`).join(", "),
        values: fields.map((field) => changes[field])
    };
}

async function renumberSiblings(connection, table, scopeColumn, scopeValue, orderedInternalIds) {
    for (let index = 0; index < orderedInternalIds.length; index += 1) {
        await connection.query(
            `UPDATE ${table} SET position = ? WHERE id = ? AND ${scopeColumn} = ?`,
            [REORDER_OFFSET + index, orderedInternalIds[index], scopeValue]
        );
    }
    for (let index = 0; index < orderedInternalIds.length; index += 1) {
        await connection.query(
            `UPDATE ${table} SET position = ? WHERE id = ? AND ${scopeColumn} = ?`,
            [index + 1, orderedInternalIds[index], scopeValue]
        );
    }
}

function moveToPosition(currentIds, movingId, targetPosition) {
    const withoutMoving = currentIds.filter((id) => id !== movingId);
    const clampedIndex = Math.max(0, Math.min(withoutMoving.length, targetPosition - 1));
    withoutMoving.splice(clampedIndex, 0, movingId);
    return withoutMoving;
}

const PROGRAM_UPDATE_COLUMNS = Object.freeze({ name: "name", description: "description" });
const VERSION_UPDATE_COLUMNS = Object.freeze({ notes: "notes" });
const DAY_UPDATE_COLUMNS = Object.freeze({ name: "name", instructions: "instructions" });
const EXERCISE_UPDATE_COLUMNS = Object.freeze({
    exercise_name_snapshot: "exercise_name_snapshot",
    instructions: "instructions",
    target_sets: "target_sets",
    target_reps_min: "target_reps_min",
    target_reps_max: "target_reps_max",
    target_weight: "target_weight",
    target_duration_minutes: "target_duration_minutes",
    target_distance_km: "target_distance_km",
    target_rpe: "target_rpe",
    rest_seconds: "rest_seconds"
});

function createTrainingProgramService({ database, generatePublicId = createPublicId } = {}) {
    if (!database) {
        throw new TypeError("Training program service requires a database.");
    }
    const sql = promiseDatabase(database);
    const helpers = createTrainingServiceHelpers(sql);

    async function lockProgram(connection, studioInternalId, programPublicId) {
        const [rows] = await connection.query(
            `SELECT id, public_id, studio_id, name, description, status, created_at, updated_at
             FROM studio_training_programs
             WHERE studio_id = ? AND public_id = ?
             FOR UPDATE`,
            [studioInternalId, programPublicId]
        );
        if (rows.length === 0) throw new TrainingProgramNotFoundError();
        return programFromRow(rows[0]);
    }

    async function lockVersion(connection, program, versionPublicId) {
        const [rows] = await connection.query(
            `SELECT id, public_id, program_id, version_number, status, notes, published_at, created_at
             FROM studio_training_program_versions
             WHERE program_id = ? AND public_id = ?
             FOR UPDATE`,
            [program.internalId, versionPublicId]
        );
        if (rows.length === 0) throw new ProgramVersionNotFoundError();
        return versionFromRow(rows[0]);
    }

    async function readVersion(connection, program, versionPublicId) {
        const [rows] = await connection.query(
            `SELECT id, public_id, program_id, version_number, status, notes, published_at, created_at
             FROM studio_training_program_versions
             WHERE program_id = ? AND public_id = ?`,
            [program.internalId, versionPublicId]
        );
        if (rows.length === 0) throw new ProgramVersionNotFoundError();
        return versionFromRow(rows[0]);
    }

    async function lockDay(connection, version, dayPublicId) {
        const [rows] = await connection.query(
            `SELECT id, public_id, program_version_id, position, name, instructions, created_at, updated_at
             FROM studio_training_program_days
             WHERE program_version_id = ? AND public_id = ?
             FOR UPDATE`,
            [version.internalId, dayPublicId]
        );
        if (rows.length === 0) throw new ProgramDayNotFoundError();
        return dayFromRow(rows[0]);
    }

    async function lockExercise(connection, day, exercisePublicId) {
        const [rows] = await connection.query(
            `SELECT id, public_id, program_day_id, position, exercise_name_snapshot, instructions,
                    target_sets, target_reps_min, target_reps_max, target_weight,
                    target_duration_minutes, target_distance_km, target_rpe, rest_seconds
             FROM studio_training_program_exercises
             WHERE program_day_id = ? AND public_id = ?
             FOR UPDATE`,
            [day.internalId, exercisePublicId]
        );
        if (rows.length === 0) throw new ProgramExerciseNotFoundError();
        return exerciseFromRow(rows[0]);
    }

    // ---- Programs ----

    async function createProgram(actorUserId, context, input) {
        return helpers.withLockedStudioAccess(
            context,
            PERMISSIONS.PROGRAM_MANAGE,
            async (connection, studio) => {
                const publicId = generatePublicId();
                const [result] = await connection.query(
                    `INSERT INTO studio_training_programs (
                        public_id, studio_id, name, description, status, created_by_user_id
                     ) VALUES (?, ?, ?, ?, 'draft', ?)`,
                    [publicId, studio.internalId, input.name, input.description, actorUserId]
                );
                await helpers.insertAudit(connection, {
                    studioId: studio.internalId,
                    actorUserId,
                    eventType: "training_program.created",
                    targetType: "training_program",
                    targetPublicId: publicId,
                    details: { name: input.name }
                });
                const [rows] = await connection.query(
                    `SELECT id, public_id, name, description, status, created_at, updated_at
                     FROM studio_training_programs WHERE id = ?`,
                    [result.insertId]
                );
                return publicProgram(programFromRow(rows[0]));
            }
        );
    }

    async function listPrograms(context, pagination) {
        return helpers.withLockedStudioAccess(
            context,
            PERMISSIONS.PROGRAM_READ,
            async (connection, studio) => {
                const [[countRow]] = await connection.query(
                    "SELECT COUNT(*) AS total FROM studio_training_programs WHERE studio_id = ?",
                    [studio.internalId]
                );
                const [rows] = await connection.query(
                    `SELECT id, public_id, name, description, status, created_at, updated_at
                     FROM studio_training_programs
                     WHERE studio_id = ?
                     ORDER BY created_at DESC, id DESC
                     LIMIT ? OFFSET ?`,
                    [studio.internalId, pagination.limit, pagination.offset]
                );
                return {
                    trainingPrograms: rows.map((row) => publicProgram(programFromRow(row))),
                    pagination: paginationResult(Number(countRow.total), pagination)
                };
            }
        );
    }

    async function getProgram(context, programPublicId) {
        return helpers.withLockedStudioAccess(
            context,
            PERMISSIONS.PROGRAM_READ,
            async (connection, studio) => {
                const program = await lockProgram(connection, studio.internalId, programPublicId);
                return publicProgram(program);
            }
        );
    }

    async function updateProgram(actorUserId, context, programPublicId, changes) {
        return helpers.withLockedStudioAccess(
            context,
            PERMISSIONS.PROGRAM_MANAGE,
            async (connection, studio) => {
                const program = await lockProgram(connection, studio.internalId, programPublicId);
                if (program.status === "archived") {
                    throw new ProgramArchivedError();
                }

                const isArchiving = changes.status === "archived";
                const fieldChanges = { ...changes };
                delete fieldChanges.status;
                const update = updateStatement(fieldChanges, PROGRAM_UPDATE_COLUMNS);
                const setClauses = [...update.assignments ? [update.assignments] : []];
                const values = [...update.values];
                if (isArchiving) {
                    setClauses.push("status = 'archived'");
                }
                if (setClauses.length > 0) {
                    await connection.query(
                        `UPDATE studio_training_programs SET ${setClauses.join(", ")} WHERE id = ?`,
                        [...values, program.internalId]
                    );
                }

                if (isArchiving) {
                    await helpers.insertAudit(connection, {
                        studioId: studio.internalId,
                        actorUserId,
                        eventType: "training_program.archived",
                        targetType: "training_program",
                        targetPublicId: program.id,
                        details: {}
                    });
                } else if (update.fields.length > 0) {
                    await helpers.insertAudit(connection, {
                        studioId: studio.internalId,
                        actorUserId,
                        eventType: "training_program.updated",
                        targetType: "training_program",
                        targetPublicId: program.id,
                        details: { fields: update.fields }
                    });
                }

                const [rows] = await connection.query(
                    `SELECT id, public_id, name, description, status, created_at, updated_at
                     FROM studio_training_programs WHERE id = ?`,
                    [program.internalId]
                );
                return publicProgram(programFromRow(rows[0]));
            }
        );
    }

    // ---- Versions ----

    async function createVersion(actorUserId, context, programPublicId, input) {
        return helpers.withLockedStudioAccess(
            context,
            PERMISSIONS.PROGRAM_MANAGE,
            async (connection, studio) => {
                const program = await lockProgram(connection, studio.internalId, programPublicId);
                if (program.status === "archived") {
                    throw new ProgramArchivedError();
                }

                const [[maxRow]] = await connection.query(
                    `SELECT COALESCE(MAX(version_number), 0) AS max_number
                     FROM studio_training_program_versions
                     WHERE program_id = ?
                     FOR UPDATE`,
                    [program.internalId]
                );
                const versionNumber = Number(maxRow.max_number) + 1;
                const publicId = generatePublicId();

                await connection.query(
                    `INSERT INTO studio_training_program_versions (
                        public_id, program_id, version_number, status, notes, created_by_user_id
                     ) VALUES (?, ?, ?, 'draft', ?, ?)`,
                    [publicId, program.internalId, versionNumber, input.notes, actorUserId]
                );
                await helpers.insertAudit(connection, {
                    studioId: studio.internalId,
                    actorUserId,
                    eventType: "training_program_version.created",
                    targetType: "training_program_version",
                    targetPublicId: publicId,
                    details: { versionNumber }
                });

                const version = await readVersion(connection, program, publicId);
                return publicVersion(version);
            }
        );
    }

    async function listVersions(context, programPublicId, pagination) {
        return helpers.withLockedStudioAccess(
            context,
            PERMISSIONS.PROGRAM_READ,
            async (connection, studio) => {
                const program = await lockProgram(connection, studio.internalId, programPublicId);
                const [[countRow]] = await connection.query(
                    "SELECT COUNT(*) AS total FROM studio_training_program_versions WHERE program_id = ?",
                    [program.internalId]
                );
                const [rows] = await connection.query(
                    `SELECT id, public_id, program_id, version_number, status, notes, published_at, created_at
                     FROM studio_training_program_versions
                     WHERE program_id = ?
                     ORDER BY version_number DESC
                     LIMIT ? OFFSET ?`,
                    [program.internalId, pagination.limit, pagination.offset]
                );
                return {
                    programVersions: rows.map((row) => publicVersion(versionFromRow(row))),
                    pagination: paginationResult(Number(countRow.total), pagination)
                };
            }
        );
    }

    async function getVersion(context, programPublicId, versionPublicId) {
        return helpers.withLockedStudioAccess(
            context,
            PERMISSIONS.PROGRAM_READ,
            async (connection, studio) => {
                const program = await lockProgram(connection, studio.internalId, programPublicId);
                const version = await readVersion(connection, program, versionPublicId);

                const [dayRows] = await connection.query(
                    `SELECT id, public_id, program_version_id, position, name, instructions, created_at, updated_at
                     FROM studio_training_program_days
                     WHERE program_version_id = ?
                     ORDER BY position ASC`,
                    [version.internalId]
                );
                const days = dayRows.map((row) => dayFromRow(row));
                let exercisesByDay = new Map();
                if (days.length > 0) {
                    const [exerciseRows] = await connection.query(
                        `SELECT id, public_id, program_day_id, position, exercise_name_snapshot, instructions,
                                target_sets, target_reps_min, target_reps_max, target_weight,
                                target_duration_minutes, target_distance_km, target_rpe, rest_seconds
                         FROM studio_training_program_exercises
                         WHERE program_day_id IN (?)
                         ORDER BY position ASC`,
                        [days.map((day) => day.internalId)]
                    );
                    exercisesByDay = exerciseRows.reduce((map, row) => {
                        const exercise = exerciseFromRow(row);
                        const list = map.get(exercise.dayInternalId) || [];
                        list.push(exercise);
                        map.set(exercise.dayInternalId, list);
                        return map;
                    }, new Map());
                }

                return {
                    ...publicVersion(version),
                    days: days.map((day) => publicDay(day, exercisesByDay.get(day.internalId) || []))
                };
            }
        );
    }

    async function updateVersion(actorUserId, context, programPublicId, versionPublicId, changes) {
        return helpers.withLockedStudioAccess(
            context,
            PERMISSIONS.PROGRAM_MANAGE,
            async (connection, studio) => {
                const program = await lockProgram(connection, studio.internalId, programPublicId);
                const version = await lockVersion(connection, program, versionPublicId);
                if (!canMutateProgramVersion(version)) {
                    throw new ProgramVersionNotDraftError();
                }

                const update = updateStatement(changes, VERSION_UPDATE_COLUMNS);
                if (update.fields.length > 0) {
                    await connection.query(
                        `UPDATE studio_training_program_versions SET ${update.assignments} WHERE id = ?`,
                        [...update.values, version.internalId]
                    );
                }

                const fresh = await readVersion(connection, program, versionPublicId);
                return publicVersion(fresh);
            }
        );
    }

    async function publishVersion(actorUserId, context, programPublicId, versionPublicId) {
        return helpers.withLockedStudioAccess(
            context,
            PERMISSIONS.PROGRAM_PUBLISH,
            async (connection, studio) => {
                const program = await lockProgram(connection, studio.internalId, programPublicId);
                if (program.status === "archived") {
                    throw new ProgramArchivedError();
                }
                const version = await lockVersion(connection, program, versionPublicId);
                if (!canPublishProgramVersion(version)) {
                    throw new ProgramVersionNotDraftError();
                }

                await connection.query(
                    `UPDATE studio_training_program_versions
                     SET status = 'published', published_at = CURRENT_TIMESTAMP(6)
                     WHERE id = ? AND status = 'draft'`,
                    [version.internalId]
                );

                if (program.status === "draft") {
                    await connection.query(
                        "UPDATE studio_training_programs SET status = 'active' WHERE id = ?",
                        [program.internalId]
                    );
                }

                await helpers.insertAudit(connection, {
                    studioId: studio.internalId,
                    actorUserId,
                    eventType: "training_program_version.published",
                    targetType: "training_program_version",
                    targetPublicId: version.id,
                    details: { versionNumber: version.versionNumber }
                });

                const fresh = await readVersion(connection, program, versionPublicId);
                return publicVersion(fresh);
            }
        );
    }

    // ---- Days ----

    async function createDay(actorUserId, context, programPublicId, versionPublicId, input) {
        return helpers.withLockedStudioAccess(
            context,
            PERMISSIONS.PROGRAM_MANAGE,
            async (connection, studio) => {
                const program = await lockProgram(connection, studio.internalId, programPublicId);
                const version = await lockVersion(connection, program, versionPublicId);
                if (!canMutateProgramVersion(version)) {
                    throw new ProgramVersionNotDraftError();
                }

                const [[maxRow]] = await connection.query(
                    `SELECT COALESCE(MAX(position), 0) AS max_position
                     FROM studio_training_program_days WHERE program_version_id = ?`,
                    [version.internalId]
                );
                const position = Number(maxRow.max_position) + 1;
                const publicId = generatePublicId();

                await connection.query(
                    `INSERT INTO studio_training_program_days (
                        public_id, program_version_id, position, name, instructions
                     ) VALUES (?, ?, ?, ?, ?)`,
                    [publicId, version.internalId, position, input.name, input.instructions]
                );

                const [rows] = await connection.query(
                    `SELECT id, public_id, program_version_id, position, name, instructions, created_at, updated_at
                     FROM studio_training_program_days WHERE public_id = ?`,
                    [publicId]
                );
                return publicDay(dayFromRow(rows[0]));
            }
        );
    }

    async function updateDay(actorUserId, context, programPublicId, versionPublicId, dayPublicId, changes) {
        return helpers.withLockedStudioAccess(
            context,
            PERMISSIONS.PROGRAM_MANAGE,
            async (connection, studio) => {
                const program = await lockProgram(connection, studio.internalId, programPublicId);
                const version = await lockVersion(connection, program, versionPublicId);
                if (!canMutateProgramVersion(version)) {
                    throw new ProgramVersionNotDraftError();
                }
                const day = await lockDay(connection, version, dayPublicId);

                const { position, ...fieldChanges } = changes;
                const update = updateStatement(fieldChanges, DAY_UPDATE_COLUMNS);
                if (update.fields.length > 0) {
                    await connection.query(
                        `UPDATE studio_training_program_days SET ${update.assignments} WHERE id = ?`,
                        [...update.values, day.internalId]
                    );
                }

                if (position !== undefined && position !== day.position) {
                    const [siblingRows] = await connection.query(
                        `SELECT id FROM studio_training_program_days
                         WHERE program_version_id = ? ORDER BY position ASC
                         FOR UPDATE`,
                        [version.internalId]
                    );
                    const orderedIds = siblingRows.map((row) => row.id);
                    const reordered = moveToPosition(orderedIds, day.internalId, position);
                    await renumberSiblings(
                        connection, "studio_training_program_days", "program_version_id",
                        version.internalId, reordered
                    );
                }

                const [rows] = await connection.query(
                    `SELECT id, public_id, program_version_id, position, name, instructions, created_at, updated_at
                     FROM studio_training_program_days WHERE id = ?`,
                    [day.internalId]
                );
                return publicDay(dayFromRow(rows[0]));
            }
        );
    }

    async function deleteDay(actorUserId, context, programPublicId, versionPublicId, dayPublicId) {
        return helpers.withLockedStudioAccess(
            context,
            PERMISSIONS.PROGRAM_MANAGE,
            async (connection, studio) => {
                const program = await lockProgram(connection, studio.internalId, programPublicId);
                const version = await lockVersion(connection, program, versionPublicId);
                if (!canMutateProgramVersion(version)) {
                    throw new ProgramVersionNotDraftError();
                }
                const day = await lockDay(connection, version, dayPublicId);
                await connection.query(
                    "DELETE FROM studio_training_program_days WHERE id = ?",
                    [day.internalId]
                );
                return { id: day.id };
            }
        );
    }

    // ---- Exercises ----

    async function createExercise(actorUserId, context, programPublicId, versionPublicId, dayPublicId, input) {
        return helpers.withLockedStudioAccess(
            context,
            PERMISSIONS.PROGRAM_MANAGE,
            async (connection, studio) => {
                const program = await lockProgram(connection, studio.internalId, programPublicId);
                const version = await lockVersion(connection, program, versionPublicId);
                if (!canMutateProgramVersion(version)) {
                    throw new ProgramVersionNotDraftError();
                }
                const day = await lockDay(connection, version, dayPublicId);

                const [[maxRow]] = await connection.query(
                    `SELECT COALESCE(MAX(position), 0) AS max_position
                     FROM studio_training_program_exercises WHERE program_day_id = ?`,
                    [day.internalId]
                );
                const position = Number(maxRow.max_position) + 1;
                const publicId = generatePublicId();

                await connection.query(
                    `INSERT INTO studio_training_program_exercises (
                        public_id, program_day_id, position, exercise_name_snapshot, instructions,
                        target_sets, target_reps_min, target_reps_max, target_weight,
                        target_duration_minutes, target_distance_km, target_rpe, rest_seconds
                     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        publicId, day.internalId, position,
                        input.exercise_name_snapshot, input.instructions,
                        input.target_sets, input.target_reps_min, input.target_reps_max, input.target_weight,
                        input.target_duration_minutes, input.target_distance_km, input.target_rpe, input.rest_seconds
                    ]
                );

                const [rows] = await connection.query(
                    `SELECT id, public_id, program_day_id, position, exercise_name_snapshot, instructions,
                            target_sets, target_reps_min, target_reps_max, target_weight,
                            target_duration_minutes, target_distance_km, target_rpe, rest_seconds
                     FROM studio_training_program_exercises WHERE public_id = ?`,
                    [publicId]
                );
                return publicExercise(exerciseFromRow(rows[0]));
            }
        );
    }

    async function updateExercise(actorUserId, context, programPublicId, versionPublicId, dayPublicId, exercisePublicId, changes) {
        return helpers.withLockedStudioAccess(
            context,
            PERMISSIONS.PROGRAM_MANAGE,
            async (connection, studio) => {
                const program = await lockProgram(connection, studio.internalId, programPublicId);
                const version = await lockVersion(connection, program, versionPublicId);
                if (!canMutateProgramVersion(version)) {
                    throw new ProgramVersionNotDraftError();
                }
                const day = await lockDay(connection, version, dayPublicId);
                const exercise = await lockExercise(connection, day, exercisePublicId);

                const { position, ...fieldChanges } = changes;
                const update = updateStatement(fieldChanges, EXERCISE_UPDATE_COLUMNS);
                if (update.fields.length > 0) {
                    await connection.query(
                        `UPDATE studio_training_program_exercises SET ${update.assignments} WHERE id = ?`,
                        [...update.values, exercise.internalId]
                    );
                }

                if (position !== undefined && position !== exercise.position) {
                    const [siblingRows] = await connection.query(
                        `SELECT id FROM studio_training_program_exercises
                         WHERE program_day_id = ? ORDER BY position ASC
                         FOR UPDATE`,
                        [day.internalId]
                    );
                    const orderedIds = siblingRows.map((row) => row.id);
                    const reordered = moveToPosition(orderedIds, exercise.internalId, position);
                    await renumberSiblings(
                        connection, "studio_training_program_exercises", "program_day_id",
                        day.internalId, reordered
                    );
                }

                const [rows] = await connection.query(
                    `SELECT id, public_id, program_day_id, position, exercise_name_snapshot, instructions,
                            target_sets, target_reps_min, target_reps_max, target_weight,
                            target_duration_minutes, target_distance_km, target_rpe, rest_seconds
                     FROM studio_training_program_exercises WHERE id = ?`,
                    [exercise.internalId]
                );
                return publicExercise(exerciseFromRow(rows[0]));
            }
        );
    }

    async function deleteExercise(actorUserId, context, programPublicId, versionPublicId, dayPublicId, exercisePublicId) {
        return helpers.withLockedStudioAccess(
            context,
            PERMISSIONS.PROGRAM_MANAGE,
            async (connection, studio) => {
                const program = await lockProgram(connection, studio.internalId, programPublicId);
                const version = await lockVersion(connection, program, versionPublicId);
                if (!canMutateProgramVersion(version)) {
                    throw new ProgramVersionNotDraftError();
                }
                const day = await lockDay(connection, version, dayPublicId);
                const exercise = await lockExercise(connection, day, exercisePublicId);
                await connection.query(
                    "DELETE FROM studio_training_program_exercises WHERE id = ?",
                    [exercise.internalId]
                );
                return { id: exercise.id };
            }
        );
    }

    return {
        createDay,
        createExercise,
        createProgram,
        createVersion,
        deleteDay,
        deleteExercise,
        getProgram,
        getVersion,
        listPrograms,
        listVersions,
        publishVersion,
        updateDay,
        updateExercise,
        updateProgram,
        updateVersion
    };
}

module.exports = {
    createTrainingProgramService,
    dayFromRow,
    exerciseFromRow,
    programFromRow,
    publicDay,
    publicExercise,
    publicProgram,
    publicVersion,
    versionFromRow
};
