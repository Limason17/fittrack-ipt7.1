const {
    CalendarEntryConflictError,
    CalendarEntryNotFoundError,
    CalendarInvalidTransitionError
} = require("../errors/TrainingCalendarErrors");
const { createPublicId } = require("../domain/studioDomain");
const {
    DEFAULT_PERSONAL_TIMEZONE,
    canTransitionCalendarStatus,
    deriveAvailableActions,
    deriveDisplayStatus,
    resolvePersonalCreationStatus,
    scheduleRuleDatesInRange,
    scheduleRuleOccursOn,
    todayInTimezone
} = require("../domain/trainingCalendarDomain");
const { createTrainingServiceHelpers, promiseDatabase } = require("./trainingServiceHelpers");

// Shared with workoutSessionService.js (Section 13 integration): given an
// already-open connection/transaction and today's date, finds the schedule
// rule (if any) covering this exact assignment+day+weekday, lazily
// materializes today's occurrence if it does not exist yet (the member may
// never have opened the calendar view for today), and returns the row
// locked FOR UPDATE - or null if no active rule produces an occurrence
// today, in which case the caller's pre-existing, unrelated session-start
// behavior is entirely unchanged (Section 13: "bestehendes Verhalten nicht
// still verändern").
async function findOrMaterializeTodayCalendarEntry(
    connection,
    { userId, studioInternalId, assignmentInternalId, programDayInternalId, today, generatePublicId = createPublicId }
) {
    const [ruleRows] = await connection.query(
        `SELECT id, weekday, week_interval,
                DATE_FORMAT(anchor_date, '%Y-%m-%d') AS anchor_date,
                DATE_FORMAT(active_from, '%Y-%m-%d') AS active_from,
                DATE_FORMAT(active_until, '%Y-%m-%d') AS active_until
         FROM studio_assignment_schedule_rules
         WHERE assignment_id = ? AND program_day_id = ? AND status = 'active'`,
        [assignmentInternalId, programDayInternalId]
    );
    const matchingRule = ruleRows.find((rule) => scheduleRuleOccursOn({
        weekday: Number(rule.weekday),
        weekInterval: Number(rule.week_interval),
        anchorDate: rule.anchor_date,
        activeFrom: rule.active_from,
        activeUntil: rule.active_until
    }, today));
    if (!matchingRule) return null;

    const [dayRows] = await connection.query(
        "SELECT name FROM studio_training_program_days WHERE id = ?",
        [programDayInternalId]
    );

    await connection.query(
        `INSERT IGNORE INTO training_calendar_entries (
            public_id, user_id, scheduled_date, status, source_type, title_snapshot,
            studio_id, program_assignment_id, program_day_id, schedule_rule_id
         ) VALUES (?, ?, ?, 'PLANNED', 'studio', ?, ?, ?, ?, ?)`,
        [
            generatePublicId(), userId, today, dayRows[0].name,
            studioInternalId, assignmentInternalId, programDayInternalId, matchingRule.id
        ]
    );

    const [entryRows] = await connection.query(
        `SELECT id, public_id, status, studio_workout_session_id, revision
         FROM training_calendar_entries
         WHERE schedule_rule_id = ? AND scheduled_date = ?
         FOR UPDATE`,
        [matchingRule.id, today]
    );
    return entryRows[0] || null;
}

// ---- Row shaping ----

// Stage 5A2 contract fixes (documented in docs/STAGE_5A1_UNIFIED_CALENDAR_BACKEND.md
// and docs/STAGE_5A2_PERSONAL_CALENDAR_UI.md):
// 1) every mutation endpoint requires the caller to send `expectedRevision`,
//    but no response previously exposed the current `revision` value - a real
//    HTTP client had no way to learn it (Stage 5A1's own integration tests
//    could only work around this by querying the database directly, which is
//    not an option for the frontend). `revision` is `null` for the
//    synthesized legacy-workout rows in getCalendar() below, which have no
//    backing training_calendar_entries row and are never mutable.
// 2) the START action is advertised via availableActions for studio entries,
//    but starting a session requires the assignment's public id in the URL
//    (POST /v1/studios/:studioId/program-assignments/:assignmentId/workout-sessions,
//    see workoutSessionApi.js) - a value the response never exposed even
//    though studio_program_assignments was already joined for program/day
//    metadata. `assignmentId` is `null` for personal/legacy entries.
function publicCalendarEntry(row, { today }) {
    const displayStatus = deriveDisplayStatus(row.status, row.scheduledDate, today);
    const hasLinkedWorkout = Boolean(row.linkedWorkoutPublicId);
    return {
        id: row.publicId,
        scheduledDate: row.scheduledDate,
        persistedStatus: row.status,
        displayStatus,
        sourceType: row.sourceType,
        title: row.title,
        revision: row.revision === undefined ? null : row.revision,
        studio: row.studioPublicId ? { id: row.studioPublicId, name: row.studioName } : null,
        program: row.programPublicId ? { id: row.programPublicId, name: row.programName } : null,
        programDay: row.programDayPublicId ? { id: row.programDayPublicId, name: row.programDayName } : null,
        assignmentId: row.assignmentPublicId || null,
        linkedWorkoutType: row.linkedWorkoutType,
        linkedWorkoutPublicId: row.linkedWorkoutPublicId,
        availableActions: deriveAvailableActions({ displayStatus, sourceType: row.sourceType, hasLinkedWorkout })
    };
}

function createTrainingCalendarService({ database, generatePublicId = createPublicId } = {}) {
    if (!database) {
        throw new TypeError("Training calendar service requires a database.");
    }
    const sql = promiseDatabase(database);
    // Only ever used for its standalone insertAudit() - schedule rule/studio
    // context checks are not this service's job (personal calendar routes
    // are deliberately not studio-scoped, see docs/STAGE_5A1_UNIFIED_CALENDAR_BACKEND.md).
    const auditHelpers = createTrainingServiceHelpers(sql);

    async function begin() {
        const connection = await sql.getConnection();
        try {
            await connection.beginTransaction();
            return connection;
        } catch (error) {
            connection.release();
            throw error;
        }
    }

    async function rollbackAndRelease(connection) {
        try {
            await connection.rollback();
        } finally {
            connection.release();
        }
    }

    // ---- Materialization (Section 7/8: lazy, idempotent, bounded) ----

    async function materializeStudioOccurrences(connection, actorUserId, from, to) {
        const [ruleRows] = await connection.query(
            `SELECT r.id, r.assignment_id, r.program_day_id, r.weekday, r.week_interval,
                    DATE_FORMAT(r.anchor_date, '%Y-%m-%d') AS anchor_date,
                    DATE_FORMAT(r.active_from, '%Y-%m-%d') AS active_from,
                    DATE_FORMAT(r.active_until, '%Y-%m-%d') AS active_until,
                    pa.studio_id, pd.name AS program_day_name
             FROM studio_assignment_schedule_rules r
             INNER JOIN studio_program_assignments pa ON pa.id = r.assignment_id
             INNER JOIN studio_training_program_days pd ON pd.id = r.program_day_id
             INNER JOIN studio_memberships sm ON sm.id = pa.member_membership_id
             WHERE sm.user_id = ? AND r.status = 'active' AND pa.status = 'active'
               AND r.active_from <= ? AND (r.active_until IS NULL OR r.active_until >= ?)`,
            [actorUserId, to, from]
        );

        for (const rule of ruleRows) {
            const dates = scheduleRuleDatesInRange(
                {
                    weekday: Number(rule.weekday),
                    weekInterval: Number(rule.week_interval),
                    anchorDate: rule.anchor_date,
                    activeFrom: rule.active_from,
                    activeUntil: rule.active_until
                },
                from,
                to
            );
            for (const scheduledDate of dates) {
                // INSERT IGNORE + the (schedule_rule_id, scheduled_date) unique
                // index is the whole idempotency guarantee: two parallel
                // requests materializing the same rule+date collapse onto one
                // row, never a duplicate (Section 7 "parallele Requests
                // erzeugen keine doppelten Occurrences").
                await connection.query(
                    `INSERT IGNORE INTO training_calendar_entries (
                        public_id, user_id, scheduled_date, status, source_type, title_snapshot,
                        studio_id, program_assignment_id, program_day_id, schedule_rule_id
                     ) VALUES (?, ?, ?, 'PLANNED', 'studio', ?, ?, ?, ?, ?)`,
                    [
                        generatePublicId(), actorUserId, scheduledDate, rule.program_day_name,
                        rule.studio_id, rule.assignment_id, rule.program_day_id, rule.id
                    ]
                );
            }
        }
    }

    // ---- Read ----

    async function getCalendar(actorUserId, { from, to, timezone }) {
        const connection = await sql.getConnection();
        try {
            await materializeStudioOccurrences(connection, actorUserId, from, to);

            const [entryRows] = await connection.query(
                `SELECT
                    e.public_id, DATE_FORMAT(e.scheduled_date, '%Y-%m-%d') AS scheduled_date,
                    e.status, e.source_type, e.title_snapshot, e.revision,
                    e.personal_workout_id, e.studio_workout_session_id,
                    s.public_id AS studio_public_id, s.name AS studio_name, s.default_timezone AS studio_timezone,
                    pa.public_id AS assignment_public_id,
                    tp.public_id AS program_public_id, tp.name AS program_name,
                    pd.public_id AS program_day_public_id, pd.name AS program_day_name,
                    w.public_id AS personal_workout_public_id,
                    ws.public_id AS workout_session_public_id
                 FROM training_calendar_entries e
                 LEFT JOIN studios s ON s.id = e.studio_id
                 LEFT JOIN studio_program_assignments pa ON pa.id = e.program_assignment_id
                 LEFT JOIN studio_training_program_versions pv ON pv.id = pa.program_version_id
                 LEFT JOIN studio_training_programs tp ON tp.id = pv.program_id
                 LEFT JOIN studio_training_program_days pd ON pd.id = e.program_day_id
                 LEFT JOIN workouts w ON w.id = e.personal_workout_id
                 LEFT JOIN studio_workout_sessions ws ON ws.id = e.studio_workout_session_id
                 WHERE e.user_id = ? AND e.scheduled_date BETWEEN ? AND ?`,
                [actorUserId, from, to]
            );

            const [legacyWorkoutRows] = await connection.query(
                `SELECT w.public_id, DATE_FORMAT(w.workout_date, '%Y-%m-%d') AS workout_date, w.title
                 FROM workouts w
                 WHERE w.user_id = ? AND w.workout_date BETWEEN ? AND ?
                   AND NOT EXISTS (
                       SELECT 1 FROM training_calendar_entries e WHERE e.personal_workout_id = w.id
                   )`,
                [actorUserId, from, to]
            );

            const studioTimezoneCache = new Map();
            const rows = entryRows.map((row) => ({
                publicId: row.public_id,
                scheduledDate: row.scheduled_date,
                status: row.status,
                sourceType: row.source_type,
                title: row.title_snapshot,
                revision: row.revision,
                studioPublicId: row.studio_public_id,
                studioName: row.studio_name,
                studioTimezone: row.studio_timezone,
                assignmentPublicId: row.assignment_public_id,
                programPublicId: row.program_public_id,
                programName: row.program_name,
                programDayPublicId: row.program_day_public_id,
                programDayName: row.program_day_name,
                linkedWorkoutType: row.personal_workout_id ? "personal_workout" : (row.studio_workout_session_id ? "studio_workout_session" : null),
                linkedWorkoutPublicId: row.personal_workout_public_id || row.workout_session_public_id || null
            }));
            for (const row of legacyWorkoutRows) {
                rows.push({
                    publicId: `legacy-workout:${row.public_id}`,
                    scheduledDate: row.workout_date,
                    status: "COMPLETED",
                    sourceType: "personal",
                    title: row.title,
                    revision: null,
                    studioPublicId: null,
                    studioName: null,
                    studioTimezone: null,
                    assignmentPublicId: null,
                    programPublicId: null,
                    programName: null,
                    programDayPublicId: null,
                    programDayName: null,
                    linkedWorkoutType: "personal_workout",
                    linkedWorkoutPublicId: row.public_id
                });
            }

            const personalToday = todayInTimezone(timezone || DEFAULT_PERSONAL_TIMEZONE);
            const entries = rows.map((row) => {
                let today = personalToday;
                if (row.sourceType === "studio" && row.studioTimezone) {
                    if (!studioTimezoneCache.has(row.studioTimezone)) {
                        studioTimezoneCache.set(row.studioTimezone, todayInTimezone(row.studioTimezone));
                    }
                    today = studioTimezoneCache.get(row.studioTimezone);
                }
                return publicCalendarEntry(row, { today });
            });

            entries.sort((a, b) => {
                if (a.scheduledDate !== b.scheduledDate) return a.scheduledDate < b.scheduledDate ? -1 : 1;
                if (a.sourceType !== b.sourceType) return a.sourceType < b.sourceType ? -1 : 1;
                if (a.title !== b.title) return a.title < b.title ? -1 : 1;
                return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
            });

            await connection.commit();
            connection.release();
            return { entries };
        } catch (error) {
            await rollbackAndRelease(connection);
            throw error;
        }
    }

    // ---- Personal mutations ----

    async function lockOwnEntry(connection, actorUserId, entryPublicId) {
        const [rows] = await connection.query(
            `SELECT id, public_id, user_id, scheduled_date, status, source_type,
                    personal_workout_id, studio_id, revision
             FROM training_calendar_entries
             WHERE user_id = ? AND public_id = ?
             FOR UPDATE`,
            [actorUserId, entryPublicId]
        );
        if (rows.length === 0) throw new CalendarEntryNotFoundError();
        return rows[0];
    }

    async function loadEntryDetail(connection, entryInternalId, timezone) {
        const [rows] = await connection.query(
            `SELECT
                e.public_id, DATE_FORMAT(e.scheduled_date, '%Y-%m-%d') AS scheduled_date,
                e.status, e.source_type, e.title_snapshot, e.revision,
                e.personal_workout_id, e.studio_workout_session_id,
                w.public_id AS personal_workout_public_id,
                ws.public_id AS workout_session_public_id
             FROM training_calendar_entries e
             LEFT JOIN workouts w ON w.id = e.personal_workout_id
             LEFT JOIN studio_workout_sessions ws ON ws.id = e.studio_workout_session_id
             WHERE e.id = ?`,
            [entryInternalId]
        );
        const row = rows[0];
        const today = todayInTimezone(timezone || DEFAULT_PERSONAL_TIMEZONE);
        return publicCalendarEntry({
            publicId: row.public_id,
            scheduledDate: row.scheduled_date,
            status: row.status,
            sourceType: row.source_type,
            title: row.title_snapshot,
            revision: row.revision,
            studioPublicId: null,
            studioName: null,
            programPublicId: null,
            programName: null,
            programDayPublicId: null,
            programDayName: null,
            linkedWorkoutType: row.personal_workout_id ? "personal_workout" : (row.studio_workout_session_id ? "studio_workout_session" : null),
            linkedWorkoutPublicId: row.personal_workout_public_id || row.workout_session_public_id || null
        }, { today });
    }

    async function createPersonalEntry(actorUserId, input) {
        const today = todayInTimezone(input.timezone || DEFAULT_PERSONAL_TIMEZONE);
        const status = resolvePersonalCreationStatus({
            scheduledDate: input.scheduledDate,
            today,
            planAsUpcoming: input.planAsUpcoming
        });

        const connection = await begin();
        try {
            let personalWorkoutId = null;
            let completedAt = null;
            if (status === "COMPLETED") {
                // Preferred design (Section 12): a COMPLETED personal calendar
                // entry always has a real, minimal backing workouts row, so the
                // existing /workouts history/progress contract stays the single
                // source of truth for "what did I actually do" - never a
                // second, disconnected notion of a completed training. No
                // exercises are attached; workouts.title/workout_date/notes
                // alone are already a valid row under the pre-existing schema
                // (no NOT NULL constraint requires at least one exercise).
                const [workoutResult] = await connection.query(
                    `INSERT INTO workouts (user_id, title, workout_date, notes, public_id)
                     VALUES (?, ?, ?, ?, ?)`,
                    [actorUserId, input.title, input.scheduledDate, input.notes, generatePublicId()]
                );
                personalWorkoutId = workoutResult.insertId;
                completedAt = new Date();
            }

            const publicId = generatePublicId();
            await connection.query(
                `INSERT INTO training_calendar_entries (
                    public_id, user_id, scheduled_date, status, source_type, title_snapshot,
                    personal_workout_id, completed_at, created_by_user_id
                 ) VALUES (?, ?, ?, ?, 'personal', ?, ?, ?, ?)`,
                [publicId, actorUserId, input.scheduledDate, status, input.title, personalWorkoutId, completedAt, actorUserId]
            );

            await connection.commit();
            connection.release();
            return await getEntryByPublicIdForUser(actorUserId, publicId, input.timezone);
        } catch (error) {
            await rollbackAndRelease(connection);
            throw error;
        }
    }

    async function getEntryByPublicIdForUser(actorUserId, entryPublicId, timezone) {
        const connection = await sql.getConnection();
        try {
            const [rows] = await connection.query(
                `SELECT id FROM training_calendar_entries WHERE user_id = ? AND public_id = ?`,
                [actorUserId, entryPublicId]
            );
            if (rows.length === 0) throw new CalendarEntryNotFoundError();
            return await loadEntryDetail(connection, rows[0].id, timezone);
        } finally {
            connection.release();
        }
    }

    async function updatePersonalEntry(actorUserId, entryPublicId, changes) {
        const connection = await begin();
        try {
            const entry = await lockOwnEntry(connection, actorUserId, entryPublicId);
            if (entry.source_type !== "personal" || entry.status !== "PLANNED") {
                throw new CalendarInvalidTransitionError();
            }

            const setClauses = ["revision = revision + 1"];
            const values = [];
            if (changes.title !== undefined) {
                setClauses.push("title_snapshot = ?");
                values.push(changes.title);
            }

            const [result] = await connection.query(
                `UPDATE training_calendar_entries SET ${setClauses.join(", ")} WHERE id = ? AND revision = ?`,
                [...values, entry.id, changes.expectedRevision]
            );
            if (result.affectedRows === 0) throw new CalendarEntryConflictError();

            await connection.commit();
            connection.release();
            return await getEntryByPublicIdForUser(actorUserId, entryPublicId);
        } catch (error) {
            await rollbackAndRelease(connection);
            throw error;
        }
    }

    async function reschedulePersonalEntry(actorUserId, entryPublicId, input) {
        const connection = await begin();
        try {
            const entry = await lockOwnEntry(connection, actorUserId, entryPublicId);
            if (entry.source_type !== "personal" || entry.status !== "PLANNED") {
                throw new CalendarInvalidTransitionError();
            }
            if (!canTransitionCalendarStatus("PLANNED", "PLANNED")) {
                throw new CalendarInvalidTransitionError();
            }

            const [result] = await connection.query(
                `UPDATE training_calendar_entries
                 SET scheduled_date = ?, revision = revision + 1
                 WHERE id = ? AND revision = ?`,
                [input.scheduledDate, entry.id, input.expectedRevision]
            );
            if (result.affectedRows === 0) throw new CalendarEntryConflictError();

            await connection.commit();
            connection.release();
            return await getEntryByPublicIdForUser(actorUserId, entryPublicId, input.timezone);
        } catch (error) {
            await rollbackAndRelease(connection);
            throw error;
        }
    }

    // Direct, non-session completion - personal entries only. A studio
    // occurrence can only become COMPLETED via its linked workout session
    // (workoutSessionService.js#completeSession, Section 13); reaching this
    // function for a studio-sourced entry is rejected even though the HTTP
    // layer's availableActions already never advertises COMPLETE for one -
    // "keine UI-Berechtigungslogik als einzige Schutzschicht" (Section 11).
    async function completePersonalEntry(actorUserId, entryPublicId, { expectedRevision }) {
        const connection = await begin();
        try {
            const entry = await lockOwnEntry(connection, actorUserId, entryPublicId);
            if (entry.source_type !== "personal" || !canTransitionCalendarStatus(entry.status, "COMPLETED")) {
                throw new CalendarInvalidTransitionError();
            }

            let personalWorkoutId = entry.personal_workout_id;
            if (!personalWorkoutId) {
                const [titleRows] = await connection.query(
                    "SELECT title_snapshot FROM training_calendar_entries WHERE id = ?",
                    [entry.id]
                );
                const [workoutResult] = await connection.query(
                    `INSERT INTO workouts (user_id, title, workout_date, public_id)
                     VALUES (?, ?, ?, ?)`,
                    [actorUserId, titleRows[0].title_snapshot, entry.scheduled_date, generatePublicId()]
                );
                personalWorkoutId = workoutResult.insertId;
            }

            const [result] = await connection.query(
                `UPDATE training_calendar_entries
                 SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP(3),
                     personal_workout_id = ?, revision = revision + 1
                 WHERE id = ? AND revision = ?`,
                [personalWorkoutId, entry.id, expectedRevision]
            );
            if (result.affectedRows === 0) throw new CalendarEntryConflictError();

            await connection.commit();
            connection.release();
            return await getEntryByPublicIdForUser(actorUserId, entryPublicId);
        } catch (error) {
            await rollbackAndRelease(connection);
            throw error;
        }
    }

    async function skipEntry(actorUserId, entryPublicId, { expectedRevision }) {
        const connection = await begin();
        try {
            const entry = await lockOwnEntry(connection, actorUserId, entryPublicId);
            if (!canTransitionCalendarStatus(entry.status, "SKIPPED")) {
                throw new CalendarInvalidTransitionError();
            }
            const [result] = await connection.query(
                `UPDATE training_calendar_entries
                 SET status = 'SKIPPED', skipped_at = CURRENT_TIMESTAMP(3), revision = revision + 1
                 WHERE id = ? AND revision = ?`,
                [entry.id, expectedRevision]
            );
            if (result.affectedRows === 0) throw new CalendarEntryConflictError();

            // A studio-sourced occurrence is still audited even though this
            // is a "personal" self-service route with no studio context
            // middleware (Section 16 requires calendar.studio_workout.skipped
            // regardless of which endpoint triggered it); a purely personal
            // entry is deliberately never written to the studio audit log.
            if (entry.source_type === "studio" && entry.studio_id) {
                await auditHelpers.insertAudit(connection, {
                    studioId: entry.studio_id,
                    actorUserId,
                    eventType: "calendar.studio_workout.skipped",
                    targetType: "training_calendar_entry",
                    targetPublicId: entryPublicId,
                    details: {}
                });
            }

            await connection.commit();
            connection.release();
            return await getEntryByPublicIdForUser(actorUserId, entryPublicId);
        } catch (error) {
            await rollbackAndRelease(connection);
            throw error;
        }
    }

    async function cancelEntry(actorUserId, entryPublicId, { expectedRevision }) {
        const connection = await begin();
        try {
            const entry = await lockOwnEntry(connection, actorUserId, entryPublicId);
            if (!canTransitionCalendarStatus(entry.status, "CANCELLED")) {
                throw new CalendarInvalidTransitionError();
            }
            const [result] = await connection.query(
                `UPDATE training_calendar_entries
                 SET status = 'CANCELLED', cancelled_at = CURRENT_TIMESTAMP(3), revision = revision + 1
                 WHERE id = ? AND revision = ?`,
                [entry.id, expectedRevision]
            );
            if (result.affectedRows === 0) throw new CalendarEntryConflictError();

            if (entry.source_type === "studio" && entry.studio_id) {
                await auditHelpers.insertAudit(connection, {
                    studioId: entry.studio_id,
                    actorUserId,
                    eventType: "calendar.studio_workout.cancelled",
                    targetType: "training_calendar_entry",
                    targetPublicId: entryPublicId,
                    details: {}
                });
            }

            await connection.commit();
            connection.release();
            return await getEntryByPublicIdForUser(actorUserId, entryPublicId);
        } catch (error) {
            await rollbackAndRelease(connection);
            throw error;
        }
    }

    return {
        cancelEntry,
        completePersonalEntry,
        createPersonalEntry,
        getCalendar,
        reschedulePersonalEntry,
        skipEntry,
        updatePersonalEntry
    };
}

module.exports = {
    createTrainingCalendarService,
    findOrMaterializeTodayCalendarEntry,
    publicCalendarEntry
};
