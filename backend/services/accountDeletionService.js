const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");

const { NotFoundError } = require("../errors/AppError");
const { CurrentPasswordInvalidError } = require("../errors/AccountErrors");
const {
    AccountAlreadyDeletedError,
    AccountDeletionPhraseMismatchError,
    AccountDeletionServiceUnavailableError,
    AccountDeletionStudioOwnershipRequiredError,
    DeletionReceiptCorruptedError,
    DeletionReceiptPublishFailedError,
    DeletionReceiptReconciliationRequiredError
} = require("../errors/AccountDeletionErrors");
const {
    generateAnonymizedEmail,
    generateAnonymizedUsername
} = require("../domain/userLifecycleDomain");
const { buildAuditEvent } = require("../audit/studioAudit");
const { planAccountDeletion, publicDeletionPreview } = require("./accountDeletionPlanner");
const { createSessionService } = require("./sessionService");
const { readDeletionReceiptConfig } = require("../config/deletionReceiptConfig");
const { buildReceipt, generateReceiptId } = require("../security/deletionReceipts");
const { findValidReceiptForAccount, publishReceipt } = require("../deletionReceipts/deletionReceiptStore");

const PASSWORD_HASH_COST = 10;
const MAX_ANONYMIZATION_ATTEMPTS = 5;
const DELETION_REVOCATION_REASON = "account_deletion";

// Error codes verifyReceipt()/buildReceiptContent() raise for a receipt
// that was actually found and parsed but fails shape/version/signature
// verification - used to distinguish "a specific receipt for this account
// is corrupted" (fail-closed, DeletionReceiptCorruptedError) from any
// other failure while resolving a receipt (a directory-listing/filesystem
// problem - treated as a publish-availability issue instead).
const RECEIPT_VERIFICATION_ERROR_CODES = new Set([
    "DELETION_RECEIPT_MALFORMED",
    "DELETION_RECEIPT_UNKNOWN_SCHEMA_VERSION",
    "DELETION_RECEIPT_UNSUPPORTED_ALGORITHM",
    "DELETION_RECEIPT_INTEGRITY_INVALID",
    "DELETION_RECEIPT_INVALID_ID",
    "DELETION_RECEIPT_INVALID_ACCOUNT_REF",
    "DELETION_RECEIPT_INVALID_LIFECYCLE_ACTION",
    "DELETION_RECEIPT_INVALID_DELETED_AT"
]);

function promiseDatabase(database) {
    return typeof database.promise === "function" ? database.promise() : database;
}

function membershipPublicIdLookup(membershipRows) {
    const byInternalId = new Map(
        membershipRows.map((row) => [row.membership_internal_id, row.membership_public_id])
    );
    return (internalId) => byInternalId.get(internalId);
}

function createAccountDeletionService({
    database,
    now = () => new Date(),
    sessionService = createSessionService({ database }),
    readReceiptConfig = readDeletionReceiptConfig,
    generateReceiptId: generateReceiptIdFn = generateReceiptId,
    logger = console
} = {}) {
    if (!database) {
        throw new TypeError("Account deletion service requires a database.");
    }
    const sql = promiseDatabase(database);

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

    async function getDeletionPreview(actorUserId) {
        const plan = await planAccountDeletion(sql, actorUserId, { forUpdate: false });
        return { deletionPreview: publicDeletionPreview(plan) };
    }

    // Section 18.3's pre-flight gate: refuses to even begin a deletion whose
    // external receipt could never be trusted later, rather than letting the
    // DB transaction commit and only then discovering the receipt subsystem
    // is unusable. This is distinct from a receipt WRITE failing after a
    // successful commit (Section 18.3's "best effort" step 17), which never
    // fails the HTTP response - this check runs before step 1.
    function assertReceiptSubsystemUsable() {
        let config;
        try {
            config = readReceiptConfig();
        } catch (error) {
            throw new AccountDeletionServiceUnavailableError(
                "Account deletion is unavailable: deletion receipt configuration is unsafe."
            );
        }
        if (!config.configured && process.env.NODE_ENV === "production") {
            throw new AccountDeletionServiceUnavailableError(
                "Account deletion is unavailable: deletion receipts are not configured."
            );
        }
        return config;
    }

    async function terminalizeWorkoutSessions(connection, membershipInternalIds, auditEvents) {
        if (membershipInternalIds.length === 0) return;
        const [sessions] = await connection.query(
            `SELECT id, public_id, studio_id FROM studio_workout_sessions
             WHERE member_membership_id IN (?) AND status = 'in_progress' FOR UPDATE`,
            [membershipInternalIds]
        );
        if (sessions.length === 0) return;
        const ids = sessions.map((row) => row.id);

        await connection.query(
            `UPDATE studio_workout_sessions
             SET status = 'aborted', aborted_at = CURRENT_TIMESTAMP(6), revision = revision + 1
             WHERE id IN (?) AND status = 'in_progress'`,
            [ids]
        );
        // Existing IN_PROGRESS -> PLANNED calendar integration effect
        // (workoutSessionService.js's abortSession), reused verbatim: the
        // resulting PLANNED row is picked up by the studio-calendar
        // CANCELLED sweep below, since that query runs after this one.
        await connection.query(
            `UPDATE training_calendar_entries
             SET status = 'PLANNED', studio_workout_session_id = NULL, revision = revision + 1
             WHERE studio_workout_session_id IN (?) AND status = 'IN_PROGRESS'`,
            [ids]
        );

        for (const session of sessions) {
            auditEvents.push({
                studioId: session.studio_id,
                eventType: "workout_session.aborted",
                targetType: "workout_session",
                targetPublicId: session.public_id,
                details: {}
            });
        }
    }

    async function terminalizeAssignments(connection, membershipInternalIds, membershipPublicIdOf, auditEvents) {
        if (membershipInternalIds.length === 0) return;
        const [assignments] = await connection.query(
            `SELECT id, public_id, studio_id, member_membership_id FROM studio_program_assignments
             WHERE member_membership_id IN (?) AND status = 'active' FOR UPDATE`,
            [membershipInternalIds]
        );
        if (assignments.length === 0) return;
        const ids = assignments.map((row) => row.id);

        await connection.query(
            `UPDATE studio_program_assignments
             SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP(6)
             WHERE id IN (?) AND status = 'active'`,
            [ids]
        );

        for (const assignment of assignments) {
            auditEvents.push({
                studioId: assignment.studio_id,
                eventType: "training_program_assignment.cancelled",
                targetType: "program_assignment",
                targetPublicId: assignment.public_id,
                details: { memberMembershipId: membershipPublicIdOf(assignment.member_membership_id) }
            });
        }
    }

    async function terminalizeCoachingRelationships(connection, membershipInternalIds, membershipPublicIdOf, auditEvents) {
        if (membershipInternalIds.length === 0) return;
        const [relationships] = await connection.query(
            `SELECT id, public_id, studio_id, coach_membership_id, member_membership_id
             FROM studio_coaching_relationships
             WHERE (coach_membership_id IN (?) OR member_membership_id IN (?)) AND status = 'active'
             FOR UPDATE`,
            [membershipInternalIds, membershipInternalIds]
        );
        if (relationships.length === 0) return;
        const ids = relationships.map((row) => row.id);

        await connection.query(
            `UPDATE studio_coaching_relationships
             SET status = 'ended', ended_at = CURRENT_TIMESTAMP(6)
             WHERE id IN (?) AND status = 'active'`,
            [ids]
        );

        for (const relationship of relationships) {
            auditEvents.push({
                studioId: relationship.studio_id,
                eventType: "coaching_relationship.ended",
                targetType: "coaching_relationship",
                targetPublicId: relationship.public_id,
                details: {
                    coachMembershipId: membershipPublicIdOf(relationship.coach_membership_id),
                    memberMembershipId: membershipPublicIdOf(relationship.member_membership_id)
                }
            });
        }
    }

    // Merge-gate finding #2: the union of two independent sets, never just
    // one -
    //   (A) active rules for an assignment whose MEMBER is the deleted
    //       account (mirrors exactly which assignments terminalizeAssignments
    //       just cancelled above) - without this, a rule created by some
    //       OTHER, still-active coach would keep materializing future
    //       training days against an assignment whose member no longer
    //       exists/left, since trainingCalendarService.js never re-checks
    //       assignment status before materializing from a rule;
    //   (B) active rules the deleted account itself CREATED (as coach/
    //       admin/owner) - without this, a departed creator's rule would
    //       keep materializing future days for an unrelated, still-active
    //       member nobody is coaching anymore ("phantom coach").
    // A single WHERE ... OR ... over one JOIN naturally de-duplicates - a
    // rule matching both (A) and (B) is still exactly one row, never
    // double-processed. The planner's activeScheduleRules count and this
    // execute-time query share the identical predicate (see
    // accountDeletionPlanner.js) so preview can never diverge from
    // execution; reconciliation re-applies the same execution path, so no
    // third copy of this predicate exists anywhere.
    async function terminalizeScheduleRules(connection, actorUserId, membershipInternalIds, auditEvents) {
        const params = [actorUserId];
        let memberScopeClause = "";
        if (membershipInternalIds.length > 0) {
            memberScopeClause = " OR a.member_membership_id IN (?)";
            params.push(membershipInternalIds);
        }
        const [rules] = await connection.query(
            `SELECT r.id, r.public_id, r.studio_id, r.assignment_id
             FROM studio_assignment_schedule_rules r
             INNER JOIN studio_program_assignments a ON a.id = r.assignment_id
             WHERE r.status = 'active' AND (r.created_by_user_id = ?${memberScopeClause})
             FOR UPDATE`,
            params
        );
        if (rules.length === 0) return;
        const ids = rules.map((row) => row.id);

        await connection.query(
            `UPDATE studio_assignment_schedule_rules SET status = 'disabled' WHERE id IN (?) AND status = 'active'`,
            [ids]
        );

        const [assignmentRows] = await connection.query(
            "SELECT id, public_id FROM studio_program_assignments WHERE id IN (?)",
            [rules.map((row) => row.assignment_id)]
        );
        const assignmentPublicIdOf = new Map(assignmentRows.map((row) => [row.id, row.public_id]));

        for (const rule of rules) {
            auditEvents.push({
                studioId: rule.studio_id,
                eventType: "assignment.schedule_rule.disabled",
                targetType: "schedule_rule",
                targetPublicId: rule.public_id,
                details: { assignmentId: assignmentPublicIdOf.get(rule.assignment_id) }
            });
        }
    }

    // Merge-gate finding #3: Section 7.7 and the retention classification
    // table of the merged design (STAGE_5C_PERSONAL_DATA_LIFECYCLE_DESIGN.md)
    // are explicit: "Zukuenftige persoenliche Kalendereintraege ... werden
    // hart geloescht" and "persoenliche PLANNED-Eintraege werden hart
    // geloescht" - i.e. only the non-terminal status='PLANNED' rows, exactly
    // mirroring the studio-entry rule directly above (which was already
    // status-filtered). A COMPLETED/SKIPPED/already-CANCELLED personal entry
    // is historical fact and is retained - but only in the anonymize mode,
    // where the users row (and therefore the entry's owning user_id, an
    // ON DELETE CASCADE FK) survives. In hard_delete mode there is no
    // surviving row for a retained entry to attach to - training_calendar_
    // entries.user_id CASCADEs on the users row itself, so every one of the
    // account's calendar entries disappears the instant that row is
    // deleted regardless of what this function does; a retained historical
    // entry's still-set created_by_user_id (a separate, RESTRICT-by-default
    // FK, 012_unified_training_calendar.js) would otherwise block that same
    // DELETE. This function makes both outcomes explicit rather than
    // leaving the hard-delete case to an implicit cascade side effect,
    // mirroring the same "always an explicit step, never implicit cascade"
    // philosophy Section 7.9 already applies to workouts/progress_entries.
    // Filtering by the persisted status column (not by comparing
    // scheduled_date against "today") also sidesteps the timezone-dependent
    // date math that caused the earlier calendar-midnight hotfix - status
    // is unambiguous.
    async function terminalizeCalendarEntries(connection, actorUserId, mode) {
        await connection.query(
            `UPDATE training_calendar_entries
             SET status = 'CANCELLED', cancelled_at = CURRENT_TIMESTAMP(3), revision = revision + 1
             WHERE user_id = ? AND source_type = 'studio' AND status = 'PLANNED'`,
            [actorUserId]
        );
        if (mode === "hard_delete") {
            await connection.query(
                "DELETE FROM training_calendar_entries WHERE user_id = ? AND source_type = 'personal'",
                [actorUserId]
            );
            return;
        }
        await connection.query(
            "DELETE FROM training_calendar_entries WHERE user_id = ? AND source_type = 'personal' AND status = 'PLANNED'",
            [actorUserId]
        );
    }

    // Merge-gate finding #1: exercises.user_id is ON DELETE SET NULL
    // (001_initial_schema.js), and GET /exercises treats every user_id IS
    // NULL row as globally visible ("WHERE user_id = ? OR user_id IS
    // NULL", exercises.js) - a hard delete of the users row would silently
    // cascade a deleted account's private exercises into the global
    // library for every other user. Deleting them here, unconditionally in
    // both modes and strictly after progress_entries/workouts (whose own
    // rows are the only other referrers of a personal exercise, both
    // already gone by this point), removes the FK path that could ever
    // trigger SET NULL for a personal exercise, and keeps this function
    // consistent with what the preview's personalDataCounts.personalExercises
    // already promised in both modes (previously counted but never
    // actually deleted - a pre-existing preview/execute divergence, fixed
    // together with the leak itself). Never touches user_id IS NULL rows
    // - the global exercise library is untouched.
    async function deletePersonalData(connection, actorUserId) {
        await connection.query("DELETE FROM progress_entries WHERE user_id = ?", [actorUserId]);
        // workout_exercises cascades from workouts (ON DELETE CASCADE, 001_initial_schema.js).
        await connection.query("DELETE FROM workouts WHERE user_id = ?", [actorUserId]);
        await connection.query("DELETE FROM exercises WHERE user_id = ?", [actorUserId]);
    }

    async function anonymizeOrHardDeleteUser(connection, { actorUserId, mode, deletedAt }) {
        if (mode === "hard_delete") {
            const [result] = await connection.query(
                "DELETE FROM users WHERE id = ? AND lifecycle_status = 'active'",
                [actorUserId]
            );
            if (result.affectedRows !== 1) {
                throw new AccountAlreadyDeletedError();
            }
            return;
        }

        for (let attempt = 0; attempt < MAX_ANONYMIZATION_ATTEMPTS; attempt += 1) {
            const anonymizedUsername = generateAnonymizedUsername();
            const anonymizedEmail = generateAnonymizedEmail();
            const unusablePasswordHash = await bcrypt.hash(
                crypto.randomBytes(32).toString("hex"),
                PASSWORD_HASH_COST
            );
            try {
                const [result] = await connection.query(
                    `UPDATE users SET
                        lifecycle_status = 'deleted',
                        deleted_at = ?,
                        username = ?,
                        email = ?,
                        password_hash = ?,
                        auth_version = auth_version + 1
                     WHERE id = ? AND lifecycle_status = 'active'`,
                    [deletedAt, anonymizedUsername, anonymizedEmail, unusablePasswordHash, actorUserId]
                );
                if (result.affectedRows !== 1) {
                    throw new AccountAlreadyDeletedError();
                }
                return;
            } catch (error) {
                if (error.code === "ER_DUP_ENTRY" && attempt < MAX_ANONYMIZATION_ATTEMPTS - 1) {
                    continue;
                }
                throw error;
            }
        }
    }

    // Receipt-first commit protocol: resolves (reuses an existing valid
    // receipt for this account, or generates and durably publishes a new
    // one) BEFORE the caller commits the surrounding DB transaction. Any
    // failure here (config unsafe, an existing-but-corrupted match, or the
    // publish itself failing) throws and is caught by executeDeletionTransaction's
    // own try/catch, which rolls the whole transaction back - no account
    // data is ever changed and no receipt is ever left behind on this path.
    // Reuse is what makes retries (client retry, reconciliation re-apply,
    // a second attempt after a commit failure) idempotent and prevents
    // unbounded receipt accumulation for the same account.
    async function resolveDeletionReceipt({ accountRef, deletedAt, lifecycleAction, requestId }) {
        let config;
        try {
            config = readReceiptConfig();
        } catch (error) {
            throw new AccountDeletionServiceUnavailableError(
                "Account deletion is unavailable: deletion receipt configuration is unsafe."
            );
        }
        if (!config.configured) {
            if (process.env.NODE_ENV === "production") {
                throw new AccountDeletionServiceUnavailableError(
                    "Account deletion is unavailable: deletion receipts are not configured."
                );
            }
            // Non-production, deliberately unconfigured (Section 21 of the
            // design): the deletion proceeds without an external receipt -
            // there is nothing to publish and nothing to reuse.
            return null;
        }

        let existing;
        try {
            existing = await findValidReceiptForAccount(config.directory, accountRef, config.key);
        } catch (error) {
            if (RECEIPT_VERIFICATION_ERROR_CODES.has(error.code)) {
                // A receipt file that specifically claims to be for this
                // account failed cryptographic/shape verification - block
                // fail-closed rather than mint a second, possibly
                // conflicting receipt over an unresolved corruption.
                logger.error?.("account_deletion_receipt_corrupted", { requestId, userId: accountRef });
                throw new DeletionReceiptCorruptedError(
                    "Account deletion is unavailable: an existing deletion receipt for this account failed verification."
                );
            }
            // Any other failure (e.g. the receipt directory itself cannot
            // be listed - ENOTDIR/EACCES/etc.) means the subsystem could
            // not even be queried, not that a specific receipt is corrupt -
            // treated as a publish-availability problem, same as the
            // publish step itself failing below.
            logger.error?.("account_deletion_receipt_publish_failed", {
                requestId,
                userId: accountRef,
                error: error.message
            });
            throw new DeletionReceiptPublishFailedError();
        }
        if (existing) {
            return existing;
        }

        const receipt = buildReceipt({
            receiptId: generateReceiptIdFn(),
            accountRef,
            lifecycleAction,
            deletedAt,
            key: config.key,
            keyId: config.keyId
        });
        try {
            await publishReceipt(config.directory, receipt);
        } catch (error) {
            logger.error?.("account_deletion_receipt_publish_failed", {
                requestId,
                userId: accountRef,
                error: error.message
            });
            throw new DeletionReceiptPublishFailedError();
        }
        return receipt;
    }

    async function requestAccountDeletion(actorUserId, input, { requestId } = {}) {
        assertReceiptSubsystemUsable();

        // Section 18.2's explicit ordering: password/phrase verification
        // happens on an UNLOCKED read, before any row lock is taken, to
        // minimize lock hold time - the same CAS-guarded UPDATE in
        // anonymizeOrHardDeleteUser (WHERE lifecycle_status = 'active')
        // re-verifies the account is still active at mutation time.
        const [userRows] = await sql.query(
            "SELECT id, username, password_hash, lifecycle_status FROM users WHERE id = ?",
            [actorUserId]
        );
        if (userRows.length === 0) {
            throw new NotFoundError("User not found.");
        }
        const user = userRows[0];
        if (user.lifecycle_status !== "active") {
            throw new AccountAlreadyDeletedError();
        }

        const currentPasswordMatches = await bcrypt.compare(input.currentPassword, user.password_hash);
        if (!currentPasswordMatches) {
            throw new CurrentPasswordInvalidError();
        }
        if (input.confirmationPhrase !== user.username) {
            throw new AccountDeletionPhraseMismatchError();
        }

        return executeDeletionTransaction(actorUserId, { requestId, lifecycleAction: "deleted" });
    }

    // The password-less core: everything Section 18.2 specifies AFTER
    // credential verification (steps 1-16). Split out from
    // requestAccountDeletion so the restore-reconciliation path
    // (deletionReceiptReconciliation.js) can re-apply an *already-decided*
    // deletion for a restored-active account without a password/phrase it
    // has no way to obtain - reconciliation is an operator re-applying a
    // decision the account holder already made once, not a fresh request.
    async function executeDeletionTransaction(actorUserId, { requestId, lifecycleAction }) {
        const deletedAt = now();
        const connection = await begin();
        let plan;
        let studiosAffected = 0;
        let receipt = null;
        // Set instead of thrown directly inside the try below: throwing
        // there would be caught by this function's own catch block, which
        // would then try to rollback/release a connection this branch
        // already released, corrupting the pool connection's state. Every
        // path below reaches exactly one commit-or-rollback and exactly one
        // release; a deferred throw after that is always safe.
        let earlyExitError = null;
        try {
            plan = await planAccountDeletion(connection, actorUserId, { forUpdate: true });
            if (plan.alreadyDeleted) {
                earlyExitError = new AccountAlreadyDeletedError();
                await connection.commit();
                connection.release();
                throw earlyExitError;
            }
            if (plan.blockers.length > 0) {
                earlyExitError = new AccountDeletionStudioOwnershipRequiredError(plan.blockers[0].studios);
                await connection.rollback();
                connection.release();
                throw earlyExitError;
            }

            const auditEvents = [];

            // Re-fetched directly (rather than reusing the plan's public
            // projection, which deliberately strips internal ids per
            // Section 15.1's "keine internen IDs") under the same lock the
            // planner already took on this table.
            const [membershipRows] = await connection.query(
                "SELECT id AS membership_internal_id, public_id AS membership_public_id, " +
                "studio_id, role, status FROM studio_memberships WHERE user_id = ?",
                [actorUserId]
            );
            const membershipPublicIdOf = membershipPublicIdLookup(membershipRows);
            const membershipInternalIds = plan.membershipInternalIds;
            const activeOrSuspendedMemberships = membershipRows.filter((row) =>
                ["active", "suspended"].includes(row.status)
            );

            await terminalizeWorkoutSessions(connection, membershipInternalIds, auditEvents);
            await terminalizeAssignments(connection, membershipInternalIds, membershipPublicIdOf, auditEvents);
            await terminalizeCoachingRelationships(connection, membershipInternalIds, membershipPublicIdOf, auditEvents);
            await terminalizeScheduleRules(connection, actorUserId, membershipInternalIds, auditEvents);
            await terminalizeCalendarEntries(connection, actorUserId, plan.mode);
            await deletePersonalData(connection, actorUserId);

            // Section 7.1/17: every active/suspended membership becomes
            // 'left' - the same, already-established status transition
            // updateMembership() uses for a single studio, applied here
            // system-wide in one statement, with one 'membership.left'
            // audit event per affected studio (actor_user_id is the
            // deleted account itself - a self-triggered removal).
            if (activeOrSuspendedMemberships.length > 0) {
                await connection.query(
                    "UPDATE studio_memberships SET status = 'left' WHERE id IN (?) AND status IN ('active', 'suspended')",
                    [activeOrSuspendedMemberships.map((row) => row.membership_internal_id)]
                );
                for (const row of activeOrSuspendedMemberships) {
                    auditEvents.push({
                        studioId: row.studio_id,
                        eventType: "membership.left",
                        targetType: "membership",
                        targetPublicId: row.membership_public_id,
                        details: {
                            before: { role: row.role, status: row.status },
                            after: { role: row.role, status: "left" }
                        }
                    });
                }
            }

            await connection.query("DELETE FROM user_email_change_requests WHERE user_id = ?", [actorUserId]);
            await sessionService.revokeAllSessionsInTransaction(connection, actorUserId, DELETION_REVOCATION_REASON);

            await anonymizeOrHardDeleteUser(connection, { actorUserId, mode: plan.mode, deletedAt });

            for (const event of auditEvents) {
                const built = buildAuditEvent({ ...event, actorUserId });
                await connection.query(
                    `INSERT INTO studio_audit_events (
                        public_id, studio_id, actor_user_id, event_type,
                        target_type, target_public_id, details_json
                     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [
                        built.publicId,
                        built.studioId,
                        built.actorUserId,
                        built.eventType,
                        built.targetType,
                        built.targetPublicId,
                        built.detailsJson
                    ]
                );
            }

            studiosAffected = new Set(plan.studios.map((studio) => studio.studioId)).size;

            // Receipt-first commit protocol: resolved (reused or freshly
            // published) BEFORE commit, while the transaction can still be
            // rolled back cleanly on any failure here - config unsafe, an
            // existing-but-corrupted match, or the publish itself failing
            // (resolveDeletionReceipt's own comment has the full rationale).
            receipt = await resolveDeletionReceipt({
                accountRef: actorUserId,
                deletedAt,
                lifecycleAction,
                requestId
            });
        } catch (error) {
            if (error !== earlyExitError) {
                await rollbackAndRelease(connection);
            }
            throw error;
        }

        // Commit is deliberately outside the try/catch above: once the
        // receipt is durably published (or an existing one reused), it
        // must never be removed, so a failure here is handled differently
        // from every earlier failure - never a silent rollback-and-forget,
        // always a stable, recovery-pointing error. The Deletion Receipt
        // Doctor will see a valid receipt against a row that still shows
        // active (or, for hard delete, still exists) and flag it exactly
        // like a restored-active account; reconciliation completes the
        // job from there, reusing this same receipt.
        try {
            await connection.commit();
        } catch (commitError) {
            try {
                await connection.rollback();
            } catch {
                // The connection may already be unusable (e.g. dropped
                // mid-commit) - the receipt's durability never depended on
                // this, and a failed defensive rollback changes nothing
                // about it either way.
            } finally {
                connection.release();
            }
            logger.error?.("account_deletion_commit_failed_after_receipt", {
                requestId,
                userId: actorUserId,
                receiptId: receipt?.receiptId
            });
            throw new DeletionReceiptReconciliationRequiredError(
                "Account deletion could not be confirmed. Please try again shortly."
            );
        }
        connection.release();

        logger.info?.("account_deletion_completed", { requestId, userId: actorUserId, studiosAffected });

        return { accountDeletion: { completedAt: deletedAt, studiosAffected } };
    }

    return {
        executeDeletionTransaction,
        getDeletionPreview,
        requestAccountDeletion
    };
}

module.exports = { createAccountDeletionService };
