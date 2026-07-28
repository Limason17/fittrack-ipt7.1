const { NotFoundError } = require("../errors/AppError");
const {
    hasNoStudioHistory,
    isDeletedLifecycleStatus
} = require("../domain/userLifecycleDomain");

const FREE_TEXT_RETENTION_NOTICE =
    "Free-text notes and coach feedback tied to your historical training records are not deleted or " +
    "altered - only your account's own username and e-mail address become unidentifiable. Tenant- and " +
    "role-scoped access to that history is unchanged.";
const BACKUP_RETENTION_NOTICE =
    "Encrypted backups created before this request may retain your data for up to the documented backup " +
    "retention window.";

// Section 18.1: Preview (GET .../deletion-preview, forUpdate:false) and
// Execute (POST .../deletion-request, forUpdate:true, as the first part of
// its own transaction) call this exact same function - there is no second,
// independently-maintained code path that could ever drift from what the
// preview showed (Blocker 6 / Section 30's "Preview entspricht exakt der
// tatsächlichen Ausführung").
async function planAccountDeletion(connection, userId, { forUpdate = false } = {}) {
    const lock = forUpdate ? " FOR UPDATE" : "";

    const [userRows] = await connection.query(
        `SELECT id, username, lifecycle_status FROM users WHERE id = ?${lock}`,
        [userId]
    );
    if (userRows.length === 0) {
        throw new NotFoundError("User not found.");
    }
    const user = userRows[0];

    if (isDeletedLifecycleStatus(user.lifecycle_status)) {
        return Object.freeze({ userId, alreadyDeleted: true });
    }

    // All membership rows regardless of status: the hard-delete-eligibility
    // check (Section 8.4) must count even a single historical `left` row,
    // and locking every row here (not just active ones) is what serializes
    // a concurrent second deletion attempt against the same account
    // (Section 18.3's "sperrt zugleich implizit gegen einen parallelen
    // zweiten Löschversuch").
    const [membershipRows] = await connection.query(
        `SELECT sm.id AS membership_internal_id, sm.public_id AS membership_public_id,
                sm.role, sm.status, s.id AS studio_internal_id,
                s.public_id AS studio_public_id, s.name AS studio_name
         FROM studio_memberships sm
         INNER JOIN studios s ON s.id = sm.studio_id
         WHERE sm.user_id = ?${lock}`,
        [userId]
    );

    const hardDeleteEligible = hasNoStudioHistory(membershipRows.length);
    const membershipInternalIds = membershipRows.map((row) => row.membership_internal_id);

    const currentStudios = membershipRows.filter((row) => ["active", "suspended"].includes(row.status));
    const ownedActiveStudios = membershipRows.filter((row) => row.role === "owner" && row.status === "active");

    const blockers = [];
    const soleOwnerStudioIds = new Set();
    for (const owned of ownedActiveStudios) {
        const [[{ active_owner_count: activeOwnerCount }]] = await connection.query(
            `SELECT COUNT(*) AS active_owner_count
             FROM studio_memberships
             WHERE studio_id = ? AND role = 'owner' AND status = 'active'${lock}`,
            [owned.studio_internal_id]
        );
        if (Number(activeOwnerCount) <= 1) {
            soleOwnerStudioIds.add(owned.studio_public_id);
        }
    }
    if (soleOwnerStudioIds.size > 0) {
        blockers.push({
            code: "ACCOUNT_DELETION_STUDIO_OWNERSHIP_REQUIRED",
            studios: currentStudios
                .filter((row) => soleOwnerStudioIds.has(row.studio_public_id))
                .map((row) => ({ studioId: row.studio_public_id, studioName: row.studio_name }))
        });
    }

    const studios = currentStudios.map((row) => ({
        studioId: row.studio_public_id,
        studioName: row.studio_name,
        role: row.role,
        isSoleActiveOwner: row.role === "owner" && soleOwnerStudioIds.has(row.studio_public_id)
    }));

    async function countWhere(sql, params) {
        if (membershipInternalIds.length === 0) return 0;
        const [[{ total }]] = await connection.query(sql, params);
        return Number(total);
    }

    const runningWorkoutSessions = await countWhere(
        `SELECT COUNT(*) AS total FROM studio_workout_sessions
         WHERE member_membership_id IN (?) AND status = 'in_progress'`,
        [membershipInternalIds]
    );
    const activeAssignments = await countWhere(
        `SELECT COUNT(*) AS total FROM studio_program_assignments
         WHERE member_membership_id IN (?) AND status = 'active'`,
        [membershipInternalIds]
    );
    const activeCoachingRelationships = await countWhere(
        `SELECT COUNT(*) AS total FROM studio_coaching_relationships
         WHERE (coach_membership_id IN (?) OR member_membership_id IN (?)) AND status = 'active'`,
        [membershipInternalIds, membershipInternalIds]
    );
    const [[{ total: activeScheduleRules }]] = await connection.query(
        `SELECT COUNT(*) AS total FROM studio_assignment_schedule_rules
         WHERE created_by_user_id = ? AND status = 'active'`,
        [userId]
    );
    const [[{ total: futureStudioCalendarEntries }]] = await connection.query(
        `SELECT COUNT(*) AS total FROM training_calendar_entries
         WHERE user_id = ? AND source_type = 'studio' AND status = 'PLANNED'`,
        [userId]
    );
    // Not date-filtered, matching the deletion transaction's own step 9b
    // (an unconditional DELETE by source_type='personal', no scheduled_date
    // predicate) - a preview that only counted future-dated rows here would
    // silently understate what execution actually removes, breaking the
    // "preview never diverges from execution" invariant this function
    // exists to guarantee. The field name mirrors the design document's
    // illustrative JSON (Section 15.1); the value mirrors the actual
    // transaction contract (Section 18.2).
    const [[{ total: futurePersonalCalendarEntries }]] = await connection.query(
        `SELECT COUNT(*) AS total FROM training_calendar_entries
         WHERE user_id = ? AND source_type = 'personal'`,
        [userId]
    );

    const [[{ total: personalWorkouts }]] = await connection.query(
        "SELECT COUNT(*) AS total FROM workouts WHERE user_id = ?",
        [userId]
    );
    const [[{ total: personalProgressEntries }]] = await connection.query(
        "SELECT COUNT(*) AS total FROM progress_entries WHERE user_id = ?",
        [userId]
    );
    const [[{ total: personalExercises }]] = await connection.query(
        "SELECT COUNT(*) AS total FROM exercises WHERE user_id = ?",
        [userId]
    );

    const preservedStudioWorkoutSessions = await countWhere(
        "SELECT COUNT(*) AS total FROM studio_workout_sessions WHERE member_membership_id IN (?)",
        [membershipInternalIds]
    );
    const preservedProgramAssignments = await countWhere(
        "SELECT COUNT(*) AS total FROM studio_program_assignments WHERE member_membership_id IN (?)",
        [membershipInternalIds]
    );
    const coachFeedbackReceived = await countWhere(
        `SELECT COUNT(*) AS total FROM studio_workout_session_feedback
         WHERE workout_session_id IN (
             SELECT id FROM studio_workout_sessions WHERE member_membership_id IN (?)
         )`,
        [membershipInternalIds]
    );
    const [[{ total: coachFeedbackAuthored }]] = await connection.query(
        "SELECT COUNT(*) AS total FROM studio_workout_session_feedback WHERE author_user_id = ?",
        [userId]
    );

    return Object.freeze({
        userId,
        alreadyDeleted: false,
        username: user.username,
        mode: hardDeleteEligible ? "hard_delete" : "anonymize",
        membershipInternalIds,
        studios,
        blockers,
        impact: Object.freeze({
            runningWorkoutSessions,
            activeAssignments,
            activeCoachingRelationships,
            activeScheduleRules,
            futurePersonalCalendarEntries,
            futureStudioCalendarEntries
        }),
        personalDataCounts: Object.freeze({
            workouts: personalWorkouts,
            progressEntries: personalProgressEntries,
            personalExercises
        }),
        preservedHistoryCounts: Object.freeze({
            studioWorkoutSessions: preservedStudioWorkoutSessions,
            programAssignments: preservedProgramAssignments,
            coachFeedbackReceived,
            coachFeedbackAuthored
        }),
        confirmationPhrase: Object.freeze({ type: "username" }),
        notices: Object.freeze({
            freeTextRetention: FREE_TEXT_RETENTION_NOTICE,
            backupRetention: BACKUP_RETENTION_NOTICE
        })
    });
}

// Public API-facing projection: no internal ids, no data belonging to
// anyone but the requesting user (Section 15.1's "keine internen IDs, keine
// SQL-Details, keine Daten Dritter").
function publicDeletionPreview(plan) {
    if (plan.alreadyDeleted) {
        return { alreadyDeleted: true };
    }
    return {
        mode: plan.mode,
        studios: plan.studios.map(({ studioId, studioName, role, isSoleActiveOwner }) => ({
            studioId,
            studioName,
            role,
            isSoleActiveOwner
        })),
        blockers: plan.blockers.map((blocker) => ({
            code: blocker.code,
            studios: blocker.studios
        })),
        impact: plan.impact,
        personalDataCounts: plan.personalDataCounts,
        preservedHistoryCounts: plan.preservedHistoryCounts,
        confirmationPhrase: plan.confirmationPhrase,
        notices: plan.notices
    };
}

module.exports = {
    BACKUP_RETENTION_NOTICE,
    FREE_TEXT_RETENTION_NOTICE,
    planAccountDeletion,
    publicDeletionPreview
};
