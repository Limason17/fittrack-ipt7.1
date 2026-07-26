const {
    CalendarAssignmentInactiveError,
    CalendarEntryForbiddenError,
    CalendarProgramDayInvalidError,
    CalendarScheduleRuleConflictError,
    CalendarScheduleRuleNotFoundError
} = require("../errors/TrainingCalendarErrors");
const { createPublicId } = require("../domain/studioDomain");
const { PERMISSIONS } = require("../domain/studioPolicy");
const { isoWeekdayOf } = require("../domain/trainingCalendarDomain");
const {
    createTrainingServiceHelpers,
    promiseDatabase
} = require("./trainingServiceHelpers");

function ruleFromRow(row) {
    return {
        internalId: Number(row.id),
        id: row.public_id,
        studioInternalId: Number(row.studio_id),
        assignmentInternalId: Number(row.assignment_id),
        assignmentPublicId: row.assignment_public_id,
        programDayInternalId: Number(row.program_day_id),
        programDayPublicId: row.program_day_public_id,
        programDayName: row.program_day_name,
        weekday: Number(row.weekday),
        weekInterval: Number(row.week_interval),
        anchorDate: row.anchor_date,
        activeFrom: row.active_from,
        activeUntil: row.active_until,
        status: row.status,
        createdByUserId: row.created_by_user_id === null ? null : Number(row.created_by_user_id),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

function publicRule(rule) {
    return {
        id: rule.id,
        assignmentId: rule.assignmentPublicId,
        programDay: { id: rule.programDayPublicId, name: rule.programDayName },
        weekday: rule.weekday,
        weekInterval: rule.weekInterval,
        anchorDate: rule.anchorDate,
        activeFrom: rule.activeFrom,
        activeUntil: rule.activeUntil,
        status: rule.status,
        createdAt: rule.createdAt,
        updatedAt: rule.updatedAt
    };
}

const RULE_SELECT = `
    SELECT
        r.id, r.public_id, r.studio_id, r.assignment_id, r.program_day_id,
        r.weekday, r.week_interval,
        DATE_FORMAT(r.anchor_date, '%Y-%m-%d') AS anchor_date,
        DATE_FORMAT(r.active_from, '%Y-%m-%d') AS active_from,
        DATE_FORMAT(r.active_until, '%Y-%m-%d') AS active_until,
        r.status, r.created_by_user_id, r.created_at, r.updated_at,
        pa.public_id AS assignment_public_id,
        pd.public_id AS program_day_public_id, pd.name AS program_day_name
    FROM studio_assignment_schedule_rules r
    INNER JOIN studio_program_assignments pa ON pa.id = r.assignment_id
    INNER JOIN studio_training_program_days pd ON pd.id = r.program_day_id
`;

function createScheduleRuleService({ database, generatePublicId = createPublicId } = {}) {
    if (!database) {
        throw new TypeError("Schedule rule service requires a database.");
    }
    const sql = promiseDatabase(database);
    const helpers = createTrainingServiceHelpers(sql);

    // Same ad-hoc "re-check the actor's own active coaching relationship for
    // this specific assignment" shape already used by
    // programAssignmentService.js#getAssignment/updateAssignment - Stage 5A1
    // deliberately follows the existing convention rather than centralizing
    // it (coachActionEligibility() exists in studioPolicy.js but is unused
    // dead code today; reviving it is an unrelated refactor outside this
    // phase's scope).
    async function lockAssignmentForActor(connection, studioInternalId, actor, assignmentPublicId) {
        const [rows] = await connection.query(
            `SELECT id, public_id, status, program_version_id, coaching_relationship_id
             FROM studio_program_assignments
             WHERE studio_id = ? AND public_id = ?
             FOR UPDATE`,
            [studioInternalId, assignmentPublicId]
        );
        if (rows.length === 0) throw new CalendarScheduleRuleNotFoundError();
        const assignment = rows[0];

        if (actor.role === "trainer") {
            const [relRows] = await connection.query(
                `SELECT id FROM studio_coaching_relationships
                 WHERE id = ? AND studio_id = ? AND coach_membership_id = ? AND status = 'active'`,
                [assignment.coaching_relationship_id, studioInternalId, actor.internalId]
            );
            if (relRows.length === 0) throw new CalendarEntryForbiddenError();
        }
        return assignment;
    }

    async function createScheduleRule(actorUserId, context, assignmentPublicId, input) {
        return helpers.withLockedStudioAccess(
            context,
            PERMISSIONS.SCHEDULE_RULE_MANAGE,
            async (connection, studio, actor) => {
                const assignment = await lockAssignmentForActor(connection, studio.internalId, actor, assignmentPublicId);
                if (assignment.status !== "active") throw new CalendarAssignmentInactiveError();

                const [dayRows] = await connection.query(
                    `SELECT id, public_id, program_version_id FROM studio_training_program_days WHERE public_id = ?`,
                    [input.programDayId]
                );
                if (dayRows.length === 0 || Number(dayRows[0].program_version_id) !== Number(assignment.program_version_id)) {
                    throw new CalendarProgramDayInvalidError();
                }
                const programDay = dayRows[0];

                if (isoWeekdayOf(input.anchorDate) !== input.weekday) {
                    throw new CalendarProgramDayInvalidError();
                }

                const [conflictRows] = await connection.query(
                    `SELECT id FROM studio_assignment_schedule_rules
                     WHERE assignment_id = ? AND program_day_id = ? AND weekday = ? AND status = 'active'
                     FOR UPDATE`,
                    [assignment.id, programDay.id, input.weekday]
                );
                if (conflictRows.length > 0) throw new CalendarScheduleRuleConflictError();

                const publicId = generatePublicId();
                await connection.query(
                    `INSERT INTO studio_assignment_schedule_rules (
                        public_id, studio_id, assignment_id, program_day_id, weekday, week_interval,
                        anchor_date, active_from, active_until, status, created_by_user_id
                     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
                    [
                        publicId, studio.internalId, assignment.id, programDay.id, input.weekday, input.weekInterval,
                        input.anchorDate, input.activeFrom, input.activeUntil, actorUserId
                    ]
                );

                await helpers.insertAudit(connection, {
                    studioId: studio.internalId,
                    actorUserId,
                    eventType: "assignment.schedule_rule.created",
                    targetType: "assignment_schedule_rule",
                    targetPublicId: publicId,
                    details: {
                        assignmentId: assignment.public_id,
                        weekday: input.weekday
                    }
                });

                const [rows] = await connection.query(`${RULE_SELECT} WHERE r.public_id = ?`, [publicId]);
                return publicRule(ruleFromRow(rows[0]));
            }
        );
    }

    async function listScheduleRules(context, assignmentPublicId) {
        return helpers.withLockedStudioAccess(
            context,
            PERMISSIONS.SCHEDULE_RULE_READ,
            async (connection, studio, actor) => {
                if (actor.role === "trainer") {
                    await lockAssignmentForActor(connection, studio.internalId, actor, assignmentPublicId);
                } else {
                    const [rows] = await connection.query(
                        `SELECT id FROM studio_program_assignments WHERE studio_id = ? AND public_id = ?`,
                        [studio.internalId, assignmentPublicId]
                    );
                    if (rows.length === 0) throw new CalendarScheduleRuleNotFoundError();
                }
                const [rows] = await connection.query(
                    `${RULE_SELECT} WHERE r.studio_id = ? AND pa.public_id = ? ORDER BY r.weekday ASC, r.id ASC`,
                    [studio.internalId, assignmentPublicId]
                );
                return { scheduleRules: rows.map((row) => publicRule(ruleFromRow(row))) };
            }
        );
    }

    async function updateScheduleRule(actorUserId, context, assignmentPublicId, rulePublicId, changes) {
        return helpers.withLockedStudioAccess(
            context,
            PERMISSIONS.SCHEDULE_RULE_MANAGE,
            async (connection, studio, actor) => {
                const assignment = await lockAssignmentForActor(connection, studio.internalId, actor, assignmentPublicId);

                const [ruleRows] = await connection.query(
                    `SELECT id, public_id, program_day_id, weekday, status
                     FROM studio_assignment_schedule_rules
                     WHERE studio_id = ? AND assignment_id = ? AND public_id = ?
                     FOR UPDATE`,
                    [studio.internalId, assignment.id, rulePublicId]
                );
                if (ruleRows.length === 0) throw new CalendarScheduleRuleNotFoundError();
                const rule = ruleRows[0];

                const nextWeekday = changes.weekday !== undefined ? changes.weekday : rule.weekday;
                const nextAnchor = changes.anchorDate;
                if (nextAnchor && isoWeekdayOf(nextAnchor) !== nextWeekday) {
                    throw new CalendarProgramDayInvalidError();
                }
                if (
                    changes.activeFrom && changes.activeUntil &&
                    changes.activeUntil < changes.activeFrom
                ) {
                    throw new CalendarProgramDayInvalidError();
                }

                if (
                    (changes.weekday !== undefined || changes.status === "active") &&
                    nextWeekday !== rule.weekday
                ) {
                    const [conflictRows] = await connection.query(
                        `SELECT id FROM studio_assignment_schedule_rules
                         WHERE assignment_id = ? AND program_day_id = ? AND weekday = ? AND status = 'active' AND id <> ?
                         FOR UPDATE`,
                        [assignment.id, rule.program_day_id, nextWeekday, rule.id]
                    );
                    if (conflictRows.length > 0) throw new CalendarScheduleRuleConflictError();
                }

                const setClauses = [];
                const values = [];
                for (const [field, column] of [
                    ["weekday", "weekday"],
                    ["weekInterval", "week_interval"],
                    ["anchorDate", "anchor_date"],
                    ["activeFrom", "active_from"],
                    ["activeUntil", "active_until"],
                    ["status", "status"]
                ]) {
                    if (changes[field] !== undefined) {
                        setClauses.push(`${column} = ?`);
                        values.push(changes[field]);
                    }
                }
                await connection.query(
                    `UPDATE studio_assignment_schedule_rules SET ${setClauses.join(", ")} WHERE id = ?`,
                    [...values, rule.id]
                );

                await helpers.insertAudit(connection, {
                    studioId: studio.internalId,
                    actorUserId,
                    eventType: changes.status === "disabled"
                        ? "assignment.schedule_rule.disabled"
                        : "assignment.schedule_rule.updated",
                    targetType: "assignment_schedule_rule",
                    targetPublicId: rulePublicId,
                    details: { assignmentId: assignment.public_id }
                });

                const [rows] = await connection.query(`${RULE_SELECT} WHERE r.id = ?`, [rule.id]);
                return publicRule(ruleFromRow(rows[0]));
            }
        );
    }

    return { createScheduleRule, listScheduleRules, updateScheduleRule };
}

module.exports = {
    createScheduleRuleService,
    publicRule,
    ruleFromRow
};
