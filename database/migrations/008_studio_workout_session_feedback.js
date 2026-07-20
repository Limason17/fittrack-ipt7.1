function migrationError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

const FEEDBACK_TABLE = "studio_workout_session_feedback";

module.exports = {
    id: "008_studio_workout_session_feedback",
    description: "Add append-only coach feedback on studio workout sessions",
    async up({ connection, helpers }) {
        if (await helpers.tableExists(FEEDBACK_TABLE)) {
            throw migrationError(
                "WORKOUT_FEEDBACK_SCHEMA_ALREADY_EXISTS",
                `Refusing to adopt pre-existing table ${FEEDBACK_TABLE}.`
            );
        }

        await connection.query(`
            CREATE TABLE ${FEEDBACK_TABLE} (
                id INT AUTO_INCREMENT PRIMARY KEY,
                public_id CHAR(36) NOT NULL,
                studio_id INT NOT NULL,
                workout_session_id INT NOT NULL,
                coaching_relationship_id INT NOT NULL,
                coach_membership_id INT NOT NULL,
                author_user_id INT NOT NULL,
                client_feedback_key CHAR(36) NOT NULL,
                body VARCHAR(2000) NOT NULL,
                created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
                UNIQUE INDEX uq_workout_session_feedback_public_id (public_id),
                UNIQUE INDEX uq_workout_session_feedback_idempotency (
                    workout_session_id, coach_membership_id, client_feedback_key
                ),
                INDEX idx_workout_session_feedback_session_created (
                    workout_session_id, created_at, id
                ),
                INDEX idx_workout_session_feedback_studio (studio_id),
                INDEX idx_workout_session_feedback_relationship (coaching_relationship_id),
                INDEX idx_workout_session_feedback_coach_membership (coach_membership_id),
                INDEX idx_workout_session_feedback_author (author_user_id),
                CONSTRAINT fk_workout_session_feedback_studio
                    FOREIGN KEY (studio_id) REFERENCES studios(id)
                    ON DELETE CASCADE,
                CONSTRAINT fk_workout_session_feedback_session
                    FOREIGN KEY (workout_session_id) REFERENCES studio_workout_sessions(id)
                    ON DELETE CASCADE,
                CONSTRAINT fk_workout_session_feedback_relationship
                    FOREIGN KEY (coaching_relationship_id) REFERENCES studio_coaching_relationships(id)
                    ON DELETE CASCADE,
                CONSTRAINT fk_workout_session_feedback_coach_membership
                    FOREIGN KEY (coach_membership_id) REFERENCES studio_memberships(id)
                    ON DELETE CASCADE,
                CONSTRAINT fk_workout_session_feedback_author
                    FOREIGN KEY (author_user_id) REFERENCES users(id)
                    ON DELETE RESTRICT,
                CONSTRAINT chk_workout_session_feedback_body
                    CHECK (CHAR_LENGTH(body) BETWEEN 1 AND 2000)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
    }
};
