function migrationError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

const SCHEDULE_RULES_TABLE = "studio_assignment_schedule_rules";
const CALENDAR_ENTRIES_TABLE = "training_calendar_entries";

module.exports = {
    id: "012_unified_training_calendar",
    description: "Add recurring assignment schedule rules and unified training calendar entries; add public_id to workouts",
    async up({ connection, helpers }) {
        if (await helpers.tableExists(SCHEDULE_RULES_TABLE)) {
            throw migrationError(
                "UNIFIED_CALENDAR_SCHEMA_ALREADY_EXISTS",
                `Refusing to adopt pre-existing table ${SCHEDULE_RULES_TABLE}.`
            );
        }
        if (await helpers.tableExists(CALENDAR_ENTRIES_TABLE)) {
            throw migrationError(
                "UNIFIED_CALENDAR_SCHEMA_ALREADY_EXISTS",
                `Refusing to adopt pre-existing table ${CALENDAR_ENTRIES_TABLE}.`
            );
        }
        if (await helpers.columnExists("workouts", "public_id")) {
            throw migrationError(
                "UNIFIED_CALENDAR_SCHEMA_ALREADY_EXISTS",
                "Refusing to adopt pre-existing column workouts.public_id."
            );
        }

        // workouts predates the public_id convention introduced in Stage 1A
        // (005_studio_tenancy_and_rbac.js) and has always exposed its raw
        // AUTO_INCREMENT id via the existing GET/PUT/DELETE /workouts
        // routes - a pre-existing, unrelated contract this migration does
        // not touch. The unified calendar read model (Section 15) needs a
        // way to reference a legacy personal workout as
        // linkedWorkoutPublicId without leaking that internal integer, so
        // every workouts row gets a real public_id here: nullable first so
        // the single UPDATE below can backfill a distinct crypto-random
        // UUID per existing row (MySQL evaluates UUID() per row, not once
        // for the whole statement), then tightened to NOT NULL + unique.
        await connection.query("ALTER TABLE workouts ADD COLUMN public_id CHAR(36) NULL");
        await connection.query("UPDATE workouts SET public_id = UUID() WHERE public_id IS NULL");
        await connection.query(`
            ALTER TABLE workouts
                MODIFY COLUMN public_id CHAR(36) NOT NULL,
                ADD UNIQUE INDEX uq_workouts_public_id (public_id)
        `);

        // Recurring coach/studio scheduling rule for one program day within
        // one assignment. Intentionally NOT one row per future occurrence -
        // see training_calendar_entries below and
        // docs/STAGE_5A1_UNIFIED_CALENDAR_BACKEND.md ("Architekturentscheidung")
        // for why that would risk unbounded materialization for an
        // open-ended assignment. A studio can hold many rules (one per
        // weekday a coach schedules), but the row count is bounded by how
        // many distinct recurring patterns a human configures, never by how
        // far into the future an assignment remains open.
        await connection.query(`
            CREATE TABLE ${SCHEDULE_RULES_TABLE} (
                id INT AUTO_INCREMENT PRIMARY KEY,
                public_id CHAR(36) NOT NULL,
                studio_id INT NOT NULL,
                assignment_id INT NOT NULL,
                program_day_id INT NOT NULL,
                weekday TINYINT NOT NULL,
                week_interval INT NOT NULL DEFAULT 1,
                anchor_date DATE NOT NULL,
                active_from DATE NOT NULL,
                active_until DATE NULL,
                status VARCHAR(16) NOT NULL DEFAULT 'active',
                created_by_user_id INT NOT NULL,
                created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                    ON UPDATE CURRENT_TIMESTAMP(3),
                UNIQUE INDEX uq_assignment_schedule_rules_public_id (public_id),
                INDEX idx_assignment_schedule_rules_assignment (assignment_id),
                INDEX idx_assignment_schedule_rules_studio_status (studio_id, status),
                CONSTRAINT fk_assignment_schedule_rules_studio
                    FOREIGN KEY (studio_id) REFERENCES studios(id) ON DELETE CASCADE,
                CONSTRAINT fk_assignment_schedule_rules_assignment
                    FOREIGN KEY (assignment_id) REFERENCES studio_program_assignments(id) ON DELETE CASCADE,
                CONSTRAINT fk_assignment_schedule_rules_program_day
                    FOREIGN KEY (program_day_id) REFERENCES studio_training_program_days(id) ON DELETE CASCADE,
                CONSTRAINT fk_assignment_schedule_rules_created_by
                    FOREIGN KEY (created_by_user_id) REFERENCES users(id),
                CONSTRAINT chk_assignment_schedule_rules_weekday
                    CHECK (weekday BETWEEN 0 AND 6),
                CONSTRAINT chk_assignment_schedule_rules_week_interval
                    CHECK (week_interval BETWEEN 1 AND 52),
                CONSTRAINT chk_assignment_schedule_rules_active_window
                    CHECK (active_until IS NULL OR active_until >= active_from),
                CONSTRAINT chk_assignment_schedule_rules_status
                    CHECK (status IN ('active', 'disabled'))
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        // Unified occurrence/entry table. One row per concrete calendar day,
        // for both personal one-off entries (source_type='personal',
        // schedule_rule_id NULL, written directly by the mutation API) and
        // studio occurrences lazily materialized from a schedule rule
        // (source_type='studio', schedule_rule_id NOT NULL). The unique
        // index on (schedule_rule_id, scheduled_date) is the idempotency
        // guarantee: materializing the same rule+date twice (a second page
        // load, two parallel requests) always collapses onto the same row
        // via INSERT IGNORE, never a duplicate - MySQL treats each row's
        // NULL schedule_rule_id as distinct from every other NULL for
        // uniqueness purposes, so personal entries never collide with each
        // other through this index. Once a row exists, later schedule-rule
        // edits never touch it again (the materializer only ever inserts
        // new rows for not-yet-materialized dates) - this is what keeps
        // historical/completed entries immutable under rule changes.
        //
        // "Exactly one linked workout" (personal_workout_id XOR
        // studio_workout_session_id) is a real invariant but cannot be a DB
        // CHECK constraint here: MySQL 8 rejects a column used in both a
        // CHECK and an ON DELETE SET NULL foreign-key action
        // (ER_CHECK_CONSTRAINT_CLAUSE_USING_FK_REFER_ACTION_COLUMN, and both
        // link columns need SET NULL so deleting an old legacy workout or a
        // workout session never cascades into deleting the calendar record
        // of what was planned). Enforced instead at the service layer
        // (trainingCalendarService.js) on every write path that touches
        // either column, with dedicated test coverage - see
        // docs/STAGE_5A1_UNIFIED_CALENDAR_BACKEND.md.
        await connection.query(`
            CREATE TABLE ${CALENDAR_ENTRIES_TABLE} (
                id INT AUTO_INCREMENT PRIMARY KEY,
                public_id CHAR(36) NOT NULL,
                user_id INT NOT NULL,
                scheduled_date DATE NOT NULL,
                status VARCHAR(16) NOT NULL DEFAULT 'PLANNED',
                source_type VARCHAR(16) NOT NULL,
                title_snapshot VARCHAR(160) NOT NULL,
                studio_id INT NULL,
                program_assignment_id INT NULL,
                program_day_id INT NULL,
                schedule_rule_id INT NULL,
                personal_workout_id INT NULL,
                studio_workout_session_id INT NULL,
                completed_at TIMESTAMP(3) NULL,
                skipped_at TIMESTAMP(3) NULL,
                cancelled_at TIMESTAMP(3) NULL,
                created_by_user_id INT NULL,
                created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                    ON UPDATE CURRENT_TIMESTAMP(3),
                revision INT NOT NULL DEFAULT 0,
                UNIQUE INDEX uq_training_calendar_entries_public_id (public_id),
                UNIQUE INDEX uq_training_calendar_entries_rule_date (schedule_rule_id, scheduled_date),
                INDEX idx_training_calendar_entries_user_date (user_id, scheduled_date),
                INDEX idx_training_calendar_entries_studio (studio_id),
                INDEX idx_training_calendar_entries_assignment (program_assignment_id),
                CONSTRAINT fk_training_calendar_entries_user
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                CONSTRAINT fk_training_calendar_entries_studio
                    FOREIGN KEY (studio_id) REFERENCES studios(id) ON DELETE CASCADE,
                CONSTRAINT fk_training_calendar_entries_assignment
                    FOREIGN KEY (program_assignment_id) REFERENCES studio_program_assignments(id) ON DELETE CASCADE,
                CONSTRAINT fk_training_calendar_entries_program_day
                    FOREIGN KEY (program_day_id) REFERENCES studio_training_program_days(id) ON DELETE CASCADE,
                CONSTRAINT fk_training_calendar_entries_schedule_rule
                    FOREIGN KEY (schedule_rule_id) REFERENCES ${SCHEDULE_RULES_TABLE}(id) ON DELETE CASCADE,
                CONSTRAINT fk_training_calendar_entries_personal_workout
                    FOREIGN KEY (personal_workout_id) REFERENCES workouts(id) ON DELETE SET NULL,
                CONSTRAINT fk_training_calendar_entries_workout_session
                    FOREIGN KEY (studio_workout_session_id) REFERENCES studio_workout_sessions(id) ON DELETE SET NULL,
                CONSTRAINT fk_training_calendar_entries_created_by
                    FOREIGN KEY (created_by_user_id) REFERENCES users(id),
                CONSTRAINT chk_training_calendar_entries_status
                    CHECK (status IN ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED', 'CANCELLED')),
                CONSTRAINT chk_training_calendar_entries_source_type
                    CHECK (source_type IN ('personal', 'studio')),
                CONSTRAINT chk_training_calendar_entries_source_shape
                    CHECK (
                        (source_type = 'personal'
                            AND studio_id IS NULL AND program_assignment_id IS NULL
                            AND program_day_id IS NULL AND schedule_rule_id IS NULL)
                        OR
                        (source_type = 'studio'
                            AND studio_id IS NOT NULL AND program_assignment_id IS NOT NULL
                            AND program_day_id IS NOT NULL AND schedule_rule_id IS NOT NULL)
                    ),
                CONSTRAINT chk_training_calendar_entries_completed_at
                    CHECK ((status = 'COMPLETED' AND completed_at IS NOT NULL) OR (status <> 'COMPLETED' AND completed_at IS NULL)),
                CONSTRAINT chk_training_calendar_entries_skipped_at
                    CHECK ((status = 'SKIPPED' AND skipped_at IS NOT NULL) OR (status <> 'SKIPPED' AND skipped_at IS NULL)),
                CONSTRAINT chk_training_calendar_entries_cancelled_at
                    CHECK ((status = 'CANCELLED' AND cancelled_at IS NOT NULL) OR (status <> 'CANCELLED' AND cancelled_at IS NULL)),
                CONSTRAINT chk_training_calendar_entries_revision
                    CHECK (revision >= 0)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
    }
};
