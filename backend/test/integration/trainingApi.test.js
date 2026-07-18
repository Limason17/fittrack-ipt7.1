const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const mysql = require("mysql2/promise");

const TEST_DATABASE = `fittrack_api_test_${process.pid}_${Date.now()}`;
if (!/^fittrack_api_test_[A-Za-z0-9_]+$/.test(TEST_DATABASE)) {
    throw new Error("Refusing to use an unsafe API test database name.");
}

process.env.NODE_ENV = "test";
process.env.DB_NAME = TEST_DATABASE;
process.env.JWT_SECRET = "fittrack-stage-0a-test-secret-with-at-least-32-characters";

const db = require("../../config/db");
const { readDatabaseConfig } = require("../../config/db");
const { createMigrationRunner } = require("../../migrations/runner");
const { createApp } = require("../../startup/app");

const logger = { info() {}, error() {} };
let admin;
let server;
let baseUrl;
let pool;
let strengthExerciseId;
let userA;
let userB;

async function api(path, { method = "GET", token, body } = {}) {
    const headers = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = await response.json();
    return { response, data };
}

async function registerAndLogin(username, email) {
    const registration = await api("/api/users/register", {
        method: "POST",
        body: { username, email, password: "correct horse battery staple" }
    });
    assert.equal(registration.response.status, 201);
    const login = await api("/api/users/login", {
        method: "POST",
        body: { email, password: "correct horse battery staple" }
    });
    assert.equal(login.response.status, 200);
    return {
        id: login.data.user.id,
        token: login.data.token
    };
}

function strengthWorkout(title = "Strength", weight = 100) {
    return {
        title,
        workout_date: "2026-07-18",
        notes: "Stage 0A integration test",
        exercises: [{
            exercise_id: strengthExerciseId,
            sets: 3,
            reps: 8,
            weight
        }]
    };
}

before(async () => {
    admin = await mysql.createConnection(
        readDatabaseConfig(process.env, { includeDatabase: false })
    );
    await admin.query(`CREATE DATABASE \`${TEST_DATABASE}\` CHARACTER SET utf8mb4`);

    const runner = createMigrationRunner({ pool: db, logger });
    await runner.migrate();
    const secondRun = await runner.migrate();
    assert.deepEqual(secondRun.applied, []);

    pool = db.promise();
    const [strengthExercises] = await pool.query(
        "SELECT id FROM exercises WHERE category <> 'Cardio' ORDER BY id LIMIT 1"
    );
    strengthExerciseId = strengthExercises[0].id;

    const readiness = { check: async () => ({ ready: true }) };
    const app = createApp({
        readiness,
        logger
    });
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    userA = await registerAndLogin("stage0a-user-a", "stage0a-a@example.test");
    userB = await registerAndLogin("stage0a-user-b", "stage0a-b@example.test");
});

after(async () => {
    if (server) {
        await new Promise((resolve) => server.close(resolve));
    }
    await db.closePool(db);
    if (admin) {
        await admin.query(`DROP DATABASE IF EXISTS \`${TEST_DATABASE}\``);
        await admin.end();
    }
});

test("authentication and validation use stable error envelopes", async () => {
    const unauthenticated = await api("/api/workouts");
    assert.equal(unauthenticated.response.status, 401);
    assert.equal(unauthenticated.data.error.code, "AUTHENTICATION_REQUIRED");
    assert.equal(
        unauthenticated.response.headers.get("x-request-id"),
        unauthenticated.data.error.requestId
    );

    const invalid = await api("/api/workouts", {
        method: "POST",
        token: userA.token,
        body: {
            ...strengthWorkout(),
            exercises: [{ exercise_id: strengthExerciseId, sets: 3, reps: true, weight: -1 }]
        }
    });
    assert.equal(invalid.response.status, 400);
    assert.equal(invalid.data.error.code, "VALIDATION_ERROR");
    assert.ok(invalid.data.error.fields["exercises.0.reps"]);
    assert.doesNotMatch(JSON.stringify(invalid.data), /SELECT|node_modules|\.js:/);

    const contradictory = await api("/api/workouts", {
        method: "POST",
        token: userA.token,
        body: {
            ...strengthWorkout(),
            exercises: [{
                exercise_id: strengthExerciseId,
                sets: 3,
                reps: 8,
                weight: 100,
                duration_minutes: 30
            }]
        }
    });
    assert.equal(contradictory.response.status, 400);
    assert.equal(contradictory.data.error.code, "VALIDATION_ERROR");
    assert.ok(contradictory.data.error.fields["exercises.0.metrics"]);

    const malformedResponse = await fetch(`${baseUrl}/api/workouts`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${userA.token}`,
            "Content-Type": "application/json"
        },
        body: "{not-json"
    });
    const malformed = await malformedResponse.json();
    assert.equal(malformedResponse.status, 400);
    assert.equal(malformed.error.code, "INVALID_JSON");
});

test("workout CRUD keeps exactly one immutable derived progress row", async () => {
    const created = await api("/api/workouts", {
        method: "POST",
        token: userA.token,
        body: strengthWorkout("Derived source", 100)
    });
    assert.equal(created.response.status, 201);
    const workoutId = created.data.workoutId;

    let [derived] = await pool.query(
        `SELECT pe.id, pe.source_type, pe.workout_exercise_id, pe.weight
         FROM progress_entries pe
         WHERE pe.workout_id = ?`,
        [workoutId]
    );
    assert.equal(derived.length, 1);
    assert.equal(derived[0].source_type, "workout");
    assert.ok(derived[0].workout_exercise_id);

    const protectedDelete = await api(`/api/progress/${derived[0].id}`, {
        method: "DELETE",
        token: userA.token
    });
    assert.equal(protectedDelete.response.status, 409);
    assert.equal(protectedDelete.data.error.code, "DERIVED_PROGRESS_IMMUTABLE");

    const foreignUpdate = await api(`/api/workouts/${workoutId}`, {
        method: "PUT",
        token: userB.token,
        body: strengthWorkout("Foreign", 999)
    });
    assert.equal(foreignUpdate.response.status, 404);

    const foreignDelete = await api(`/api/workouts/${workoutId}`, {
        method: "DELETE",
        token: userB.token
    });
    assert.equal(foreignDelete.response.status, 404);

    const updated = await api(`/api/workouts/${workoutId}`, {
        method: "PUT",
        token: userA.token,
        body: strengthWorkout("Updated source", 110)
    });
    assert.equal(updated.response.status, 200);

    [derived] = await pool.query(
        `SELECT pe.id, pe.weight, pe.workout_exercise_id
         FROM progress_entries pe WHERE pe.workout_id = ?`,
        [workoutId]
    );
    assert.equal(derived.length, 1);
    assert.equal(Number(derived[0].weight), 110);

    const foreignList = await api("/api/progress", { token: userB.token });
    assert.equal(foreignList.response.status, 200);
    assert.equal(foreignList.data.some((entry) => entry.workout_id === workoutId), false);

    const removed = await api(`/api/workouts/${workoutId}`, {
        method: "DELETE",
        token: userA.token
    });
    assert.equal(removed.response.status, 200);
    const [[remaining]] = await pool.query(
        "SELECT COUNT(*) AS total FROM progress_entries WHERE workout_id = ?",
        [workoutId]
    );
    assert.equal(Number(remaining.total), 0);
});

test("manual progress stays distinguishable and can be deleted", async () => {
    const created = await api("/api/progress", {
        method: "POST",
        token: userA.token,
        body: {
            exercise_id: strengthExerciseId,
            entry_date: "2026-07-18",
            sets: 4,
            reps: 6,
            weight: 90
        }
    });
    assert.equal(created.response.status, 201);
    const progressId = created.data.progressId;
    const [[stored]] = await pool.query(
        `SELECT source_type, workout_id, workout_exercise_id
         FROM progress_entries WHERE id = ?`,
        [progressId]
    );
    assert.equal(stored.source_type, "manual");
    assert.equal(stored.workout_id, null);
    assert.equal(stored.workout_exercise_id, null);

    const foreignDelete = await api(`/api/progress/${progressId}`, {
        method: "DELETE",
        token: userB.token
    });
    assert.equal(foreignDelete.response.status, 404);
    const ownerDelete = await api(`/api/progress/${progressId}`, {
        method: "DELETE",
        token: userA.token
    });
    assert.equal(ownerDelete.response.status, 200);
});

test("exercise edits and later workout updates preserve historical metadata", async () => {
    const exercise = await api("/api/exercises", {
        method: "POST",
        token: userA.token,
        body: {
            name: "Historical name",
            description: "Snapshot test",
            category: "Strength",
            muscle_group: "Core"
        }
    });
    assert.equal(exercise.response.status, 201);
    const exerciseId = exercise.data.exerciseId;
    const workout = await api("/api/workouts", {
        method: "POST",
        token: userA.token,
        body: {
            title: "Snapshot workout",
            workout_date: "2026-07-18",
            notes: "",
            exercises: [{ exercise_id: exerciseId, sets: 3, reps: 10, weight: 25 }]
        }
    });
    assert.equal(workout.response.status, 201);

    const renamed = await api(`/api/exercises/${exerciseId}`, {
        method: "PUT",
        token: userA.token,
        body: {
            name: "Changed later",
            description: "Current exercise",
            category: "Cardio",
            muscle_group: "Whole body"
        }
    });
    assert.equal(renamed.response.status, 200);

    const currentCardioProgress = await api("/api/progress", {
        method: "POST",
        token: userA.token,
        body: {
            exercise_id: exerciseId,
            entry_date: "2026-07-19",
            duration_minutes: 30,
            distance_km: 8,
            intensity_level: 7
        }
    });
    assert.equal(currentCardioProgress.response.status, 201);

    const summaryBeforeWorkoutEdit = await api("/api/progress/summary", {
        token: userA.token
    });
    const summariesForExercise = summaryBeforeWorkoutEdit.data.filter(
        (item) => item.exercise_id === exerciseId
    );
    const historicalSummaryBeforeEdit = summaryBeforeWorkoutEdit.data.find(
        (item) => item.exercise_id === exerciseId && item.exercise_name === "Historical name"
    );
    assert.equal(summaryBeforeWorkoutEdit.response.status, 200);
    assert.equal(summariesForExercise.length, 2);
    assert.ok(historicalSummaryBeforeEdit);
    assert.equal(historicalSummaryBeforeEdit.category, "Strength");
    assert.equal(Number(historicalSummaryBeforeEdit.max_weight), 25);
    const currentSummary = summariesForExercise.find(
        (item) => item.exercise_name === "Changed later"
    );
    assert.equal(currentSummary.category, "Cardio");
    assert.equal(Number(currentSummary.max_duration_minutes), 30);

    const metadataOnlyUpdate = await api(`/api/workouts/${workout.data.workoutId}`, {
        method: "PUT",
        token: userA.token,
        body: {
            title: "Snapshot workout, edited note",
            workout_date: "2026-07-18",
            notes: "Metadata-only edit after exercise rename",
            exercises: [{ exercise_id: exerciseId, sets: 3, reps: 10, weight: 25 }]
        }
    });
    assert.equal(metadataOnlyUpdate.response.status, 200);

    const workouts = await api("/api/workouts", { token: userA.token });
    const historicalWorkout = workouts.data.find((item) => item.id === workout.data.workoutId);
    assert.equal(historicalWorkout.exercises[0].name, "Historical name");
    assert.equal(historicalWorkout.exercises[0].category, "Strength");

    const progress = await api("/api/progress", { token: userA.token });
    const historicalProgress = progress.data.find(
        (item) => item.workout_id === workout.data.workoutId
    );
    assert.equal(historicalProgress.exercise_name, "Historical name");
    assert.equal(historicalProgress.category, "Strength");

    const summary = await api("/api/progress/summary", { token: userA.token });
    const historicalSummary = summary.data.find(
        (item) => item.exercise_id === exerciseId && item.exercise_name === "Historical name"
    );
    assert.ok(historicalSummary);
    assert.equal(historicalSummary.category, "Strength");
    assert.equal(Number(historicalSummary.max_weight), 25);
    assert.equal(historicalSummary.max_duration_minutes, null);
});

test("duplicate exercises keep snapshots attached to their explicit workout row IDs", async () => {
    const exercise = await api("/api/exercises", {
        method: "POST",
        token: userA.token,
        body: {
            name: "Duplicate snapshot v1",
            description: "Stable child identity",
            category: "Strength",
            muscle_group: "Core"
        }
    });
    const exerciseId = exercise.data.exerciseId;
    const workout = await api("/api/workouts", {
        method: "POST",
        token: userA.token,
        body: {
            title: "Duplicate snapshot rows",
            workout_date: "2026-07-18",
            notes: "",
            exercises: [{ exercise_id: exerciseId, sets: 3, reps: 10, weight: 10 }]
        }
    });
    const workoutId = workout.data.workoutId;
    let workouts = await api("/api/workouts", { token: userA.token });
    let storedWorkout = workouts.data.find((item) => item.id === workoutId);
    const originalRowId = storedWorkout.exercises[0].id;

    await api(`/api/exercises/${exerciseId}`, {
        method: "PUT",
        token: userA.token,
        body: {
            name: "Duplicate snapshot v2",
            description: "Current metadata",
            category: "Strength",
            muscle_group: "Core"
        }
    });

    const addDuplicate = await api(`/api/workouts/${workoutId}`, {
        method: "PUT",
        token: userA.token,
        body: {
            title: "Two versions",
            workout_date: "2026-07-18",
            notes: "",
            exercises: [
                {
                    workout_exercise_id: originalRowId,
                    exercise_id: exerciseId,
                    sets: 3,
                    reps: 10,
                    weight: 10
                },
                {
                    workout_exercise_id: null,
                    exercise_id: exerciseId,
                    sets: 4,
                    reps: 8,
                    weight: 20
                }
            ]
        }
    });
    assert.equal(addDuplicate.response.status, 200);

    workouts = await api("/api/workouts", { token: userA.token });
    storedWorkout = workouts.data.find((item) => item.id === workoutId);
    assert.equal(storedWorkout.exercises.length, 2);
    const oldSnapshotRow = storedWorkout.exercises.find(
        (item) => Number(item.weight) === 10
    );
    const currentSnapshotRow = storedWorkout.exercises.find(
        (item) => Number(item.weight) === 20
    );
    assert.equal(oldSnapshotRow.name, "Duplicate snapshot v1");
    assert.equal(currentSnapshotRow.name, "Duplicate snapshot v2");

    const keepOnlyCurrentRow = await api(`/api/workouts/${workoutId}`, {
        method: "PUT",
        token: userA.token,
        body: {
            title: "Only v2 remains",
            workout_date: "2026-07-18",
            notes: "",
            exercises: [{
                workout_exercise_id: currentSnapshotRow.id,
                exercise_id: exerciseId,
                sets: 4,
                reps: 8,
                weight: 20
            }]
        }
    });
    assert.equal(keepOnlyCurrentRow.response.status, 200);

    workouts = await api("/api/workouts", { token: userA.token });
    storedWorkout = workouts.data.find((item) => item.id === workoutId);
    assert.equal(storedWorkout.exercises.length, 1);
    assert.equal(storedWorkout.exercises[0].name, "Duplicate snapshot v2");
    const progress = await api("/api/progress", { token: userA.token });
    const derived = progress.data.filter((item) => item.workout_id === workoutId);
    assert.equal(derived.length, 1);
    assert.equal(derived[0].exercise_name, "Duplicate snapshot v2");
});
