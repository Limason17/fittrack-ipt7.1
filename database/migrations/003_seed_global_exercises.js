const EXERCISES = [
    ["Bench Press", "Klassische Druckübung für die Brust.", "Brust", "Brustmitte"],
    ["Incline Dumbbell Press", "Schrägbank mit Kurzhanteln für die obere Brust.", "Brust", "Obere Brust"],
    ["Lat Pulldown", "Zugübung für den Rücken und besonders den Latissimus.", "Rücken", "Latissimus"],
    ["Barbell Row", "Ruderübung für den oberen Rücken.", "Rücken", "Oberer Rücken"],
    ["Squat", "Grundübung für Beine und Rumpf.", "Beine", "Quads"],
    ["Romanian Deadlift", "Beinrückseite und Gesäss.", "Beine", "Hamstrings"],
    ["Standing Calf Raise", "Übung für die Waden.", "Beine", "Waden"],
    ["Shoulder Press", "Druckübung für die Schultern.", "Schultern", "Vordere Schulter"],
    ["Lateral Raise", "Isolation für die seitliche Schulter.", "Schultern", "Seitliche Schulter"],
    ["Barbell Curl", "Klassische Bizepsübung.", "Arme", "Bizeps"],
    ["Triceps Pushdown", "Isolation für den Trizeps.", "Arme", "Trizeps"],
    ["Crunch", "Bauchübung für die Körpermitte.", "Core", "Bauch"],
    ["Bauchpresse", "Maschinenübung für die Bauchmuskulatur.", "Core", "Bauch"],
    ["Cycling", "Cardio auf dem Fahrrad oder Ergometer.", "Cardio", "Beine"]
];

module.exports = {
    id: "003_seed_global_exercises",
    description: "Seed the global exercise library idempotently",
    async up({ connection }) {
        for (const [name, description, category, muscleGroup] of EXERCISES) {
            await connection.query(
                `INSERT INTO exercises (
                    user_id, name, description, category, muscle_group, image_url
                 )
                 SELECT NULL, ?, ?, ?, ?, NULL
                 FROM DUAL
                 WHERE NOT EXISTS (
                    SELECT 1
                    FROM exercises
                    WHERE user_id IS NULL AND name = ?
                 )`,
                [name, description, category, muscleGroup, name]
            );
        }
    }
};
