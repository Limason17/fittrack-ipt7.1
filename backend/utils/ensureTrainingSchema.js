const db = require("../config/db");

const ignoredMigrationErrors = new Set(["ER_DUP_FIELDNAME"]);

async function runMigration(sql) {
    try {
        await db.promise().query(sql);
    } catch (error) {
        if (!ignoredMigrationErrors.has(error.code)) {
            throw error;
        }
    }
}

async function ensureTrainingSchema() {
    const migrations = [
        "ALTER TABLE workout_exercises MODIFY sets INT NULL",
        "ALTER TABLE workout_exercises MODIFY reps INT NULL",
        "ALTER TABLE workout_exercises MODIFY weight DECIMAL(6,2) NULL",
        "ALTER TABLE workout_exercises ADD COLUMN duration_minutes INT NULL AFTER weight",
        "ALTER TABLE workout_exercises ADD COLUMN distance_km DECIMAL(7,2) NULL AFTER duration_minutes",
        "ALTER TABLE workout_exercises ADD COLUMN intensity_level INT NULL AFTER distance_km",
        "ALTER TABLE progress_entries MODIFY sets INT NULL",
        "ALTER TABLE progress_entries MODIFY reps INT NULL",
        "ALTER TABLE progress_entries MODIFY weight DECIMAL(6,2) NULL",
        "ALTER TABLE progress_entries ADD COLUMN duration_minutes INT NULL AFTER sets",
        "ALTER TABLE progress_entries ADD COLUMN distance_km DECIMAL(7,2) NULL AFTER duration_minutes",
        "ALTER TABLE progress_entries ADD COLUMN intensity_level INT NULL AFTER distance_km"
    ];

    for (const migration of migrations) {
        await runMigration(migration);
    }
}

module.exports = ensureTrainingSchema;
