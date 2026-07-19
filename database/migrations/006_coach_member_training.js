function migrationError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

const TRAINING_TABLES = [
    "studio_coaching_relationships",
    "studio_training_programs",
    "studio_training_program_versions",
    "studio_training_program_days",
    "studio_training_program_exercises",
    "studio_program_assignments"
];

module.exports = {
    id: "006_coach_member_training",
    description: "Add coach-member coaching relationships, studio training programs, versions, and assignments",
    async up({ connection, helpers }) {
        for (const table of TRAINING_TABLES) {
            if (await helpers.tableExists(table)) {
                throw migrationError(
                    "TRAINING_SCHEMA_ALREADY_EXISTS",
                    `Refusing to adopt pre-existing table ${table}.`
                );
            }
        }

        await connection.query(`
            CREATE TABLE studio_coaching_relationships (
                id INT AUTO_INCREMENT PRIMARY KEY,
                public_id CHAR(36) NOT NULL,
                studio_id INT NOT NULL,
                coach_membership_id INT NOT NULL,
                member_membership_id INT NOT NULL,
                status VARCHAR(16) NOT NULL DEFAULT 'active',
                active_pair_marker TINYINT GENERATED ALWAYS AS (
                    IF(status = 'active', 1, NULL)
                ) STORED,
                created_by_user_id INT NOT NULL,
                started_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                ended_at TIMESTAMP(3) NULL,
                created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                    ON UPDATE CURRENT_TIMESTAMP(3),
                UNIQUE INDEX uq_coaching_relationships_public_id (public_id),
                UNIQUE INDEX uq_coaching_relationships_active_pair (
                    coach_membership_id, member_membership_id, active_pair_marker
                ),
                INDEX idx_coaching_relationships_studio_status (studio_id, status),
                INDEX idx_coaching_relationships_coach_status (coach_membership_id, status),
                INDEX idx_coaching_relationships_member_status (member_membership_id, status),
                CONSTRAINT fk_coaching_relationships_studio
                    FOREIGN KEY (studio_id) REFERENCES studios(id)
                    ON DELETE CASCADE,
                CONSTRAINT fk_coaching_relationships_coach_membership
                    FOREIGN KEY (coach_membership_id) REFERENCES studio_memberships(id)
                    ON DELETE RESTRICT,
                CONSTRAINT fk_coaching_relationships_member_membership
                    FOREIGN KEY (member_membership_id) REFERENCES studio_memberships(id)
                    ON DELETE RESTRICT,
                CONSTRAINT fk_coaching_relationships_created_by_user
                    FOREIGN KEY (created_by_user_id) REFERENCES users(id)
                    ON DELETE RESTRICT,
                CONSTRAINT chk_coaching_relationships_status
                    CHECK (status IN ('active', 'ended')),
                CONSTRAINT chk_coaching_relationships_distinct_membership
                    CHECK (coach_membership_id <> member_membership_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        await connection.query(`
            CREATE TABLE studio_training_programs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                public_id CHAR(36) NOT NULL,
                studio_id INT NOT NULL,
                name VARCHAR(120) NOT NULL,
                description VARCHAR(500) NULL,
                status VARCHAR(16) NOT NULL DEFAULT 'draft',
                created_by_user_id INT NOT NULL,
                created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                    ON UPDATE CURRENT_TIMESTAMP(3),
                UNIQUE INDEX uq_training_programs_public_id (public_id),
                INDEX idx_training_programs_studio_status (studio_id, status),
                CONSTRAINT fk_training_programs_studio
                    FOREIGN KEY (studio_id) REFERENCES studios(id)
                    ON DELETE CASCADE,
                CONSTRAINT fk_training_programs_created_by_user
                    FOREIGN KEY (created_by_user_id) REFERENCES users(id)
                    ON DELETE RESTRICT,
                CONSTRAINT chk_training_programs_status
                    CHECK (status IN ('draft', 'active', 'archived'))
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        await connection.query(`
            CREATE TABLE studio_training_program_versions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                public_id CHAR(36) NOT NULL,
                program_id INT NOT NULL,
                version_number INT NOT NULL,
                status VARCHAR(16) NOT NULL DEFAULT 'draft',
                notes VARCHAR(500) NULL,
                created_by_user_id INT NOT NULL,
                published_at TIMESTAMP(3) NULL,
                created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                UNIQUE INDEX uq_program_versions_public_id (public_id),
                UNIQUE INDEX uq_program_versions_program_number (program_id, version_number),
                INDEX idx_program_versions_program_status (program_id, status),
                CONSTRAINT fk_program_versions_program
                    FOREIGN KEY (program_id) REFERENCES studio_training_programs(id)
                    ON DELETE CASCADE,
                CONSTRAINT fk_program_versions_created_by_user
                    FOREIGN KEY (created_by_user_id) REFERENCES users(id)
                    ON DELETE RESTRICT,
                CONSTRAINT chk_program_versions_status
                    CHECK (status IN ('draft', 'published', 'retired')),
                CONSTRAINT chk_program_versions_number
                    CHECK (version_number >= 1)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        await connection.query(`
            CREATE TABLE studio_training_program_days (
                id INT AUTO_INCREMENT PRIMARY KEY,
                public_id CHAR(36) NOT NULL,
                program_version_id INT NOT NULL,
                position INT NOT NULL,
                name VARCHAR(120) NOT NULL,
                instructions VARCHAR(1000) NULL,
                created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                    ON UPDATE CURRENT_TIMESTAMP(3),
                UNIQUE INDEX uq_program_days_public_id (public_id),
                UNIQUE INDEX uq_program_days_version_position (program_version_id, position),
                CONSTRAINT fk_program_days_version
                    FOREIGN KEY (program_version_id) REFERENCES studio_training_program_versions(id)
                    ON DELETE CASCADE,
                CONSTRAINT chk_program_days_position
                    CHECK (position >= 1)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        await connection.query(`
            CREATE TABLE studio_training_program_exercises (
                id INT AUTO_INCREMENT PRIMARY KEY,
                public_id CHAR(36) NOT NULL,
                program_day_id INT NOT NULL,
                position INT NOT NULL,
                exercise_name_snapshot VARCHAR(80) NOT NULL,
                instructions VARCHAR(500) NULL,
                target_sets SMALLINT NULL,
                target_reps_min SMALLINT NULL,
                target_reps_max SMALLINT NULL,
                target_weight DECIMAL(6,2) NULL,
                target_duration_minutes SMALLINT NULL,
                target_distance_km DECIMAL(7,2) NULL,
                target_rpe DECIMAL(3,1) NULL,
                rest_seconds SMALLINT NULL,
                created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                    ON UPDATE CURRENT_TIMESTAMP(3),
                UNIQUE INDEX uq_program_exercises_public_id (public_id),
                UNIQUE INDEX uq_program_exercises_day_position (program_day_id, position),
                CONSTRAINT fk_program_exercises_day
                    FOREIGN KEY (program_day_id) REFERENCES studio_training_program_days(id)
                    ON DELETE CASCADE,
                CONSTRAINT chk_program_exercises_position
                    CHECK (position >= 1),
                CONSTRAINT chk_program_exercises_sets
                    CHECK (target_sets IS NULL OR target_sets BETWEEN 1 AND 20),
                CONSTRAINT chk_program_exercises_reps_min
                    CHECK (target_reps_min IS NULL OR target_reps_min BETWEEN 1 AND 100),
                CONSTRAINT chk_program_exercises_reps_max
                    CHECK (target_reps_max IS NULL OR target_reps_max BETWEEN 1 AND 100),
                CONSTRAINT chk_program_exercises_reps_range
                    CHECK (
                        target_reps_min IS NULL OR target_reps_max IS NULL
                        OR target_reps_max >= target_reps_min
                    ),
                CONSTRAINT chk_program_exercises_weight
                    CHECK (target_weight IS NULL OR target_weight >= 0),
                CONSTRAINT chk_program_exercises_duration
                    CHECK (target_duration_minutes IS NULL OR target_duration_minutes BETWEEN 1 AND 600),
                CONSTRAINT chk_program_exercises_distance
                    CHECK (target_distance_km IS NULL OR target_distance_km >= 0),
                CONSTRAINT chk_program_exercises_rpe
                    CHECK (target_rpe IS NULL OR target_rpe BETWEEN 0 AND 10),
                CONSTRAINT chk_program_exercises_rest
                    CHECK (rest_seconds IS NULL OR rest_seconds BETWEEN 0 AND 3600)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        await connection.query(`
            CREATE TABLE studio_program_assignments (
                id INT AUTO_INCREMENT PRIMARY KEY,
                public_id CHAR(36) NOT NULL,
                studio_id INT NOT NULL,
                program_version_id INT NOT NULL,
                member_membership_id INT NOT NULL,
                assigned_by_user_id INT NOT NULL,
                coaching_relationship_id INT NOT NULL,
                status VARCHAR(16) NOT NULL DEFAULT 'active',
                starts_on DATE NULL,
                ends_on DATE NULL,
                assigned_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                completed_at TIMESTAMP(3) NULL,
                cancelled_at TIMESTAMP(3) NULL,
                created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                    ON UPDATE CURRENT_TIMESTAMP(3),
                UNIQUE INDEX uq_program_assignments_public_id (public_id),
                INDEX idx_program_assignments_studio_status (studio_id, status),
                INDEX idx_program_assignments_member_status (member_membership_id, status),
                INDEX idx_program_assignments_version (program_version_id),
                INDEX idx_program_assignments_coaching_relationship (coaching_relationship_id),
                CONSTRAINT fk_program_assignments_studio
                    FOREIGN KEY (studio_id) REFERENCES studios(id)
                    ON DELETE CASCADE,
                CONSTRAINT fk_program_assignments_version
                    FOREIGN KEY (program_version_id) REFERENCES studio_training_program_versions(id)
                    ON DELETE CASCADE,
                CONSTRAINT fk_program_assignments_member_membership
                    FOREIGN KEY (member_membership_id) REFERENCES studio_memberships(id)
                    ON DELETE RESTRICT,
                CONSTRAINT fk_program_assignments_assigned_by_user
                    FOREIGN KEY (assigned_by_user_id) REFERENCES users(id)
                    ON DELETE RESTRICT,
                CONSTRAINT fk_program_assignments_coaching_relationship
                    FOREIGN KEY (coaching_relationship_id) REFERENCES studio_coaching_relationships(id)
                    ON DELETE CASCADE,
                CONSTRAINT chk_program_assignments_status
                    CHECK (status IN ('active', 'completed', 'cancelled')),
                CONSTRAINT chk_program_assignments_dates
                    CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
    }
};
