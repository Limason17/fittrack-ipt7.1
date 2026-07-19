function migrationError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

const WORKOUT_TABLES = [
    "studio_workout_sessions",
    "studio_workout_session_exercises",
    "studio_workout_session_sets"
];

module.exports = {
    id: "007_studio_workout_execution",
    description: "Add studio workout sessions, session exercises, and session sets",
    async up({ connection, helpers }) {
        for (const table of WORKOUT_TABLES) {
            if (await helpers.tableExists(table)) {
                throw migrationError(
                    "WORKOUT_SCHEMA_ALREADY_EXISTS",
                    `Refusing to adopt pre-existing table ${table}.`
                );
            }
        }

        await connection.query(`
            CREATE TABLE studio_workout_sessions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                public_id CHAR(36) NOT NULL,
                studio_id INT NOT NULL,
                assignment_id INT NOT NULL,
                member_membership_id INT NOT NULL,
                program_version_id INT NOT NULL,
                program_day_id INT NOT NULL,
                coaching_relationship_id INT NOT NULL,
                status VARCHAR(16) NOT NULL DEFAULT 'in_progress',
                client_start_key VARCHAR(100) NOT NULL,
                revision INT NOT NULL DEFAULT 0,
                started_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                completed_at TIMESTAMP(3) NULL,
                aborted_at TIMESTAMP(3) NULL,
                member_note VARCHAR(500) NULL,
                created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                    ON UPDATE CURRENT_TIMESTAMP(3),
                UNIQUE INDEX uq_workout_sessions_public_id (public_id),
                UNIQUE INDEX uq_workout_sessions_start_key (
                    member_membership_id, assignment_id, client_start_key
                ),
                INDEX idx_workout_sessions_studio_status (studio_id, status),
                INDEX idx_workout_sessions_member_status (member_membership_id, status),
                INDEX idx_workout_sessions_assignment (assignment_id),
                INDEX idx_workout_sessions_coaching_relationship (coaching_relationship_id),
                CONSTRAINT fk_workout_sessions_studio
                    FOREIGN KEY (studio_id) REFERENCES studios(id)
                    ON DELETE CASCADE,
                CONSTRAINT fk_workout_sessions_assignment
                    FOREIGN KEY (assignment_id) REFERENCES studio_program_assignments(id)
                    ON DELETE CASCADE,
                CONSTRAINT fk_workout_sessions_member_membership
                    FOREIGN KEY (member_membership_id) REFERENCES studio_memberships(id)
                    ON DELETE CASCADE,
                CONSTRAINT fk_workout_sessions_program_version
                    FOREIGN KEY (program_version_id) REFERENCES studio_training_program_versions(id)
                    ON DELETE CASCADE,
                CONSTRAINT fk_workout_sessions_program_day
                    FOREIGN KEY (program_day_id) REFERENCES studio_training_program_days(id)
                    ON DELETE CASCADE,
                CONSTRAINT fk_workout_sessions_coaching_relationship
                    FOREIGN KEY (coaching_relationship_id) REFERENCES studio_coaching_relationships(id)
                    ON DELETE CASCADE,
                CONSTRAINT chk_workout_sessions_status
                    CHECK (status IN ('in_progress', 'completed', 'aborted')),
                CONSTRAINT chk_workout_sessions_revision
                    CHECK (revision >= 0),
                CONSTRAINT chk_workout_sessions_start_key
                    CHECK (CHAR_LENGTH(client_start_key) >= 1),
                CONSTRAINT chk_workout_sessions_completed_at
                    CHECK (
                        (status = 'completed' AND completed_at IS NOT NULL)
                        OR (status <> 'completed' AND completed_at IS NULL)
                    ),
                CONSTRAINT chk_workout_sessions_aborted_at
                    CHECK (
                        (status = 'aborted' AND aborted_at IS NOT NULL)
                        OR (status <> 'aborted' AND aborted_at IS NULL)
                    )
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        await connection.query(`
            CREATE TABLE studio_workout_session_exercises (
                id INT AUTO_INCREMENT PRIMARY KEY,
                public_id CHAR(36) NOT NULL,
                workout_session_id INT NOT NULL,
                source_program_exercise_id INT NULL,
                position INT NOT NULL,
                exercise_name_snapshot VARCHAR(80) NOT NULL,
                instructions_snapshot VARCHAR(500) NULL,
                target_sets SMALLINT NULL,
                target_reps_min SMALLINT NULL,
                target_reps_max SMALLINT NULL,
                target_weight DECIMAL(6,2) NULL,
                target_duration_minutes SMALLINT NULL,
                target_distance_km DECIMAL(7,2) NULL,
                target_rpe DECIMAL(3,1) NULL,
                rest_seconds SMALLINT NULL,
                status VARCHAR(16) NOT NULL DEFAULT 'pending',
                member_note VARCHAR(500) NULL,
                revision INT NOT NULL DEFAULT 0,
                created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                    ON UPDATE CURRENT_TIMESTAMP(3),
                UNIQUE INDEX uq_session_exercises_public_id (public_id),
                UNIQUE INDEX uq_session_exercises_session_position (
                    workout_session_id, position
                ),
                INDEX idx_session_exercises_session_status (workout_session_id, status),
                INDEX idx_session_exercises_source (source_program_exercise_id),
                CONSTRAINT fk_session_exercises_session
                    FOREIGN KEY (workout_session_id) REFERENCES studio_workout_sessions(id)
                    ON DELETE CASCADE,
                CONSTRAINT fk_session_exercises_source
                    FOREIGN KEY (source_program_exercise_id)
                    REFERENCES studio_training_program_exercises(id)
                    ON DELETE SET NULL,
                CONSTRAINT chk_session_exercises_position
                    CHECK (position >= 1),
                CONSTRAINT chk_session_exercises_status
                    CHECK (status IN ('pending', 'completed', 'skipped')),
                CONSTRAINT chk_session_exercises_revision
                    CHECK (revision >= 0),
                CONSTRAINT chk_session_exercises_sets
                    CHECK (target_sets IS NULL OR target_sets BETWEEN 1 AND 20),
                CONSTRAINT chk_session_exercises_reps_min
                    CHECK (target_reps_min IS NULL OR target_reps_min BETWEEN 1 AND 100),
                CONSTRAINT chk_session_exercises_reps_max
                    CHECK (target_reps_max IS NULL OR target_reps_max BETWEEN 1 AND 100),
                CONSTRAINT chk_session_exercises_reps_range
                    CHECK (
                        target_reps_min IS NULL OR target_reps_max IS NULL
                        OR target_reps_max >= target_reps_min
                    ),
                CONSTRAINT chk_session_exercises_weight
                    CHECK (target_weight IS NULL OR target_weight >= 0),
                CONSTRAINT chk_session_exercises_duration
                    CHECK (target_duration_minutes IS NULL OR target_duration_minutes BETWEEN 1 AND 600),
                CONSTRAINT chk_session_exercises_distance
                    CHECK (target_distance_km IS NULL OR target_distance_km >= 0),
                CONSTRAINT chk_session_exercises_rpe
                    CHECK (target_rpe IS NULL OR target_rpe BETWEEN 0 AND 10),
                CONSTRAINT chk_session_exercises_rest
                    CHECK (rest_seconds IS NULL OR rest_seconds BETWEEN 0 AND 3600)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        await connection.query(`
            CREATE TABLE studio_workout_session_sets (
                id INT AUTO_INCREMENT PRIMARY KEY,
                public_id CHAR(36) NOT NULL,
                session_exercise_id INT NOT NULL,
                position INT NOT NULL,
                status VARCHAR(16) NOT NULL DEFAULT 'pending',
                actual_reps SMALLINT NULL,
                actual_weight DECIMAL(6,2) NULL,
                actual_duration_minutes SMALLINT NULL,
                actual_distance_km DECIMAL(7,2) NULL,
                actual_rpe DECIMAL(3,1) NULL,
                member_note VARCHAR(500) NULL,
                revision INT NOT NULL DEFAULT 0,
                completed_at TIMESTAMP(3) NULL,
                created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                    ON UPDATE CURRENT_TIMESTAMP(3),
                UNIQUE INDEX uq_session_sets_public_id (public_id),
                UNIQUE INDEX uq_session_sets_exercise_position (
                    session_exercise_id, position
                ),
                INDEX idx_session_sets_exercise_status (session_exercise_id, status),
                CONSTRAINT fk_session_sets_exercise
                    FOREIGN KEY (session_exercise_id)
                    REFERENCES studio_workout_session_exercises(id)
                    ON DELETE CASCADE,
                CONSTRAINT chk_session_sets_position
                    CHECK (position >= 1),
                CONSTRAINT chk_session_sets_status
                    CHECK (status IN ('pending', 'completed', 'skipped')),
                CONSTRAINT chk_session_sets_revision
                    CHECK (revision >= 0),
                CONSTRAINT chk_session_sets_reps
                    CHECK (actual_reps IS NULL OR actual_reps BETWEEN 0 AND 100),
                CONSTRAINT chk_session_sets_weight
                    CHECK (actual_weight IS NULL OR actual_weight >= 0),
                CONSTRAINT chk_session_sets_duration
                    CHECK (actual_duration_minutes IS NULL OR actual_duration_minutes BETWEEN 0 AND 600),
                CONSTRAINT chk_session_sets_distance
                    CHECK (actual_distance_km IS NULL OR actual_distance_km >= 0),
                CONSTRAINT chk_session_sets_rpe
                    CHECK (actual_rpe IS NULL OR actual_rpe BETWEEN 0 AND 10),
                CONSTRAINT chk_session_sets_completed_at
                    CHECK (
                        (status = 'completed' AND completed_at IS NOT NULL)
                        OR (status <> 'completed' AND completed_at IS NULL)
                    )
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
    }
};
