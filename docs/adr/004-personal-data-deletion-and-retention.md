# ADR 004: Personal data deletion and retention (Stage 5C)

- Status: Accepted (design only — no implementation in this phase)
- Date: 2026-07-27 (revised same day: four design blockers resolved before
  merge — running workout sessions, assignment/calendar terminal states,
  free-text honesty, and restore reconciliation; see the additions below
  and `docs/STAGE_5C_PERSONAL_DATA_LIFECYCLE_DESIGN.md`'s "Aufgelöste
  Designblocker" section)
- Stage: 5C

## Context

Stage 5B's Product & Pilot Readiness Audit found FitTrack's single P1
blocker: no process exists anywhere in the schema or code to delete or
irreversibly anonymize a real person's data before a real pilot studio and
real participants use the product. Stage 5C is a design-only gate that
decides how that gap gets closed, without implementing anything yet.

The decision is harder than "add a `DELETE` endpoint" because of choices
this project already made deliberately in ADR 001–003: `users` is the sole
identity boundary, studio membership is a separate, never-hard-deleted
status row, and studio history (who created a program, who assigned it, who
gave feedback) is protected by `ON DELETE RESTRICT` foreign keys precisely
so it can never silently disappear as a side effect of an unrelated action.
This ADR has to decide what "delete my account" means when the schema
itself was built to resist exactly that.

## Decision

### A user row is anonymized in place, never physically removed, for any account with studio history

Eight foreign keys reference `users(id)` with `ON DELETE RESTRICT` or MySQL's
default (functionally identical) action:
`studios.created_by_user_id`, `studio_memberships.user_id`,
`studio_coaching_relationships.created_by_user_id`,
`studio_training_programs.created_by_user_id`,
`studio_training_program_versions.created_by_user_id`,
`studio_program_assignments.assigned_by_user_id`,
`studio_workout_session_feedback.author_user_id`,
`studio_assignment_schedule_rules.created_by_user_id`, and
`training_calendar_entries.created_by_user_id`. Every one of them exists
because ADR 001–003 chose to protect studio history over the convenience of
a simple row deletion. A raw `DELETE FROM users` therefore does not merely
risk cascading damage — it is architecturally impossible for anyone who
ever created, joined, coached, assigned, or gave feedback in a studio,
short of either aborting the delete or cascading through tables that belong
to other, unrelated members.

Anonymization keeps the row (referential stability for every one of those
foreign keys) and overwrites only `username`, `email`, and `password_hash`
with non-derivable, collision-free placeholders, bumps `auth_version`, and
sets a new `lifecycle_status='deleted'` plus `deleted_at`. Every table that
references this user continues to resolve correctly; none of them needs to
change.

### The one exception: an account with zero studio membership history is hard-deleted

`workouts.user_id` and `progress_entries.user_id` are `ON DELETE CASCADE`;
`exercises.user_id` is `ON DELETE SET NULL`. An account that never held a
single `studio_memberships` row has no `RESTRICT` reference blocking it at
all — a real `DELETE FROM users` succeeds today, as-is, with the existing
schema. This phase recommends taking that path whenever it applies (checked
by a trivial, exact `COUNT(*) FROM studio_memberships WHERE user_id=?`),
because it is simpler and leaves no residual row, rather than anonymizing
an account that never needed the protection anonymization exists for.

### Studio membership removal stays a status transition, reusing the existing `left` status

Owner/admin removal of a member, and a newly proposed self-removal path for
trainers and members (who today have no way to leave a studio themselves —
`MEMBERSHIP_MANAGE` is granted only to `owner`/`admin`), both resolve to
the same, already-implemented `status='left'` transition
(`studio_memberships`, `membershipChangeDecision()`). No new status value,
no hard delete of the membership row — consistent with the existing
`RESTRICT` foreign keys from coaching relationships and assignments that
would block a hard delete anyway.

### Sole studio ownership blocks account deletion outright; nothing is auto-transferred

Before any mutation, deletion checks — per studio, under the same
`FOR UPDATE` locking order `updateMembership()` already uses — whether the
account is the studio's only active owner. If so, the whole deletion is
rejected (`409 ACCOUNT_DELETION_STUDIO_OWNERSHIP_REQUIRED`), mirroring the
existing `LastOwnerRequiredError`/`LAST_OWNER_REQUIRED` mechanism that
already blocks demoting a studio's last owner today. No studio is ever
auto-transferred to another member and no studio is ever auto-archived —
both would be an implicit, unconsented permission change for a third party,
which this product's entire RBAC model has never done anywhere else.

### Deletion is immediate and single-phase, not a delayed two-step flow

A "request now, executes in N days, cancellable in between" flow would
require a recurring background job — a category of infrastructure that
does not exist anywhere in this codebase today, and one that
`FITTRACK_NEXT_PHASE_RECOMMENDATION.md` explicitly names among the topics
excluded without a fresh, explicit go-ahead. Immediate execution, gated by
password re-entry plus a typed confirmation phrase, is the smallest design
consistent with the project's existing infrastructure and its own
previously stated scope boundary.

### A running workout session is aborted, not left dangling or used to block deletion

A member with an `in_progress` studio workout session at the moment of
deletion gets that session atomically set to `aborted` within the same
transaction — reusing the existing, precondition-free `in_progress →
aborted` transition ADR 003 already defined ("abort exists precisely for
'I'm stopping now, whatever state this is in'"). No new transition, no new
status value, and no blocker: the session simply reaches the terminal state
it was always allowed to reach on demand. Its linked calendar entry follows
the existing `IN_PROGRESS → PLANNED` integration effect already documented
in `trainingCalendarDomain.js`, then gets swept up by the calendar
cancellation rule below.

### Assignments, schedule rules, and calendar entries reach one consistent terminal state, not a mix of live and stale

The first draft of this design left an active assignment `active` while its
coaching relationship ended and its schedule rules were disabled — an
inconsistent middle state. The corrected rule: an assignment where the
deleted account is the **member** is atomically `cancelled` (reusing the
existing `active → cancelled` transition); a schedule rule the deleted
account **created** is `disabled` regardless of which member it serves
(verified against `trainingCalendarService.js`: materialization never
re-checks the coaching relationship's live status, so leaving a departed
coach's rule active would generate future training days nobody is
coaching); a future `PLANNED` studio calendar entry belonging to the
deleted account becomes `CANCELLED` (the existing, verified
`PLANNED → CANCELLED` transition — `IN_PROGRESS → CANCELLED` does not
exist, which is exactly why sessions are aborted first, reverting their
entry to `PLANNED`, before this rule runs). Assignments the deleted account
merely created *for another, non-deleted member* are left untouched — that
member's own training plan is not this account's data to cancel.

### Historical studio data is never rewritten, and free-text fields are left alone rather than falsely presented as scrubbed

Completed workout sessions, sets, exercises, assignments, program versions,
and feedback are not touched by a deletion beyond what anonymizing the
`users` row already achieves indirectly. The first draft of this ADR
additionally cleared the free-text `member_note` field on session/set rows
— that created an internal contradiction with the design document's own
Section 5, which already classified `member_note` and feedback `body` as
possible indirect identifiers while simultaneously claiming no PII survives
in history. Corrected position: **all free text is left completely
unchanged** — `member_note` and `studio_workout_session_feedback.body` may
still carry personal content after a deletion, tenant/role-scoped access to
them is unchanged, and this document does not claim otherwise. A more
thorough free-text redaction feature is explicitly out of scope for this
phase (see below).

### A restore from before a deletion is reconciled against an external, integrity-protected receipt — not a database ledger row and not a log line alone

A ledger table recording "this account was deleted at time T" would live in
the same database snapshot as the anonymized `users` row itself — a backup
taken before the deletion contains neither, so a DB-internal ledger cannot
solve the problem it would be built for. A plain structured log line alone
is also insufficient (not transactional with the DB commit, may have
expired or been dropped by the time it's needed, has no guaranteed
availability independent of the database). The resolved design instead
writes one append-only, HMAC-integrity-protected **Deletion Receipt** file
per completed deletion, to a directory outside both the git repository and
the database's own backup directory — `users.lifecycle_status` remains the
fast, transactional source of truth for normal operation (login, auth
middleware), while the external receipt exists specifically to survive a
restore that the database's own state cannot. A "Deletion Receipt Doctor"
consistency check — extending the same fail-closed pattern the existing
Migration Doctor already uses on `/api/health/ready` — runs on every
application start and is a mandatory step after any restore: it detects a
restored row that shows `active` despite a valid receipt saying otherwise,
and re-applies the deletion idempotently; it also self-heals the rarer case
of a receipt that never got written after a real DB commit (reconstructible
purely from the already-anonymized row); and it fails closed, refusing to
report the app as ready, on any receipt whose integrity check does not
verify. See `docs/STAGE_5C_PERSONAL_DATA_LIFECYCLE_DESIGN.md` Section 21
for the full mechanism and runbook.

## What this phase does not build

- Any of the above as running code, API endpoints, UI, or a migration.
- An automated, delayed/two-phase deletion flow.
- A personal-data export ("data portability") feature.
- An admin/support-initiated deletion of someone else's account — deliberately
  no reserved column for this exists in the migration draft either (see
  Consequences: a speculative `deletion_reason` column was removed after
  critical review, since exactly one trigger for deletion exists in this
  phase's actual scope).
- Automatic studio-ownership transfer.
- A generic, cross-studio audit log system.
- A new retention-ledger database table (the external Deletion Receipt is
  deliberately file-based, not a database object).
- A more thorough, standalone free-text redaction/anonymization feature for
  `member_note`/feedback bodies.

See the design document's Section 32/33 for the complete in-scope/out-of-scope
list.

## Alternatives rejected

- **Hard-deleting the `users` row unconditionally:** rejected — impossible
  for any account with studio history without either aborting on
  `RESTRICT` or cascading into other members' shared studio data.
- **Cascading a deletion through all of a user's created studio content**
  (programs, versions, assignments) to make hard delete possible:
  rejected — would destroy other, unrelated members' assignments,
  sessions, and results as a side effect of one person's own account
  deletion.
- **Automatic ownership transfer to another active owner/admin on sole-owner
  deletion:** rejected — an implicit permission grant to a third party
  without their consent, inconsistent with every other RBAC decision this
  product has made.
- **Automatic studio archival on sole-owner deletion:** rejected — an
  unconsented, disruptive state change imposed on the studio's remaining
  trainers and members.
- **A delayed, cancellable two-phase deletion:** rejected for this phase —
  requires recurring-job infrastructure that does not exist and is
  explicitly out of the project's current scope.
- **A new `account_deletion_receipts`/retention-ledger *database* table:**
  rejected — subject to the exact same backup/restore point-in-time
  limitation as the anonymized row itself (a table row written at deletion
  time is absent from any backup taken before that time, exactly like the
  anonymized `users` row it would be meant to back up).
- **A plain structured log line as the sole restore-safety mechanism (the
  first draft's approach):** rejected on reflection — not transactional
  with the DB commit, subject to shorter log retention than backup
  retention, not guaranteed available/undamaged independent of the
  database, and an unacceptable single point of failure for an irreversible
  action. Replaced with the external, integrity-protected Deletion Receipt
  plus `users.lifecycle_status` combination described above.
- **Reusing a brand-new membership status instead of the existing `left`:**
  rejected — `left` already carries the correct semantics ("no longer a
  member, rejoin requires a fresh invitation") for both administrative
  removal and self-removal; a second status would be an unjustified schema
  addition.
- **Blocking account deletion while any workout session is `in_progress`:**
  rejected — the existing `in_progress → aborted` transition already exists
  precisely for this situation and has no preconditions; requiring the
  member to first manually abort or complete a session before they're even
  allowed to request deletion adds friction without any corresponding
  safety benefit.
- **Leaving cancelled/disabled assignments' calendar entries as `PLANNED`
  instead of cancelling them:** rejected — would leave the member's own
  calendar showing training days for a program they're no longer assigned
  to, a confusing and unnecessary inconsistency given the underlying
  assignment is already terminal.
- **Clearing `member_note` (the first draft's approach):** rejected — see
  the free-text section above; clearing one specific field while claiming
  full PII removal was itself the internal contradiction this revision
  fixes, and clearing it while *not* claiming full removal would still be
  an arbitrary half-measure with no clear stopping point (why only this
  field, not others).

## Consequences

- Every future migration that adds a new table with a `user_id`/
  `*_by_user_id` reference must be explicitly classified (hard-delete,
  anonymize-indirectly, or retain-unchanged) — no automatic mechanism
  enforces this, only migration-review discipline.
- The smallest possible schema change is required for this decision:
  **two** additive columns on `users` (`lifecycle_status`, `deleted_at`),
  no new table. A third column, `deletion_reason`, was drafted and then
  removed after critical review: this phase has exactly one deletion
  trigger (self-service), so a column that would hold the same constant
  value on every row it ever applies to serves no purpose yet. A future
  admin-initiated deletion phase should design whatever it actually needs
  at that time, not inherit an untested guess made before that flow exists.
- Every completed deletion now also writes one external file (the Deletion
  Receipt) outside the database and its backup path — a new operational
  artifact this project did not have before, with its own (independent)
  backup discipline requirement.
- Restore-from-backup operations gain a new mandatory step — the Deletion
  Receipt Doctor consistency check — that did not exist before this
  design; it runs automatically on every application start in addition to
  being a mandatory manual step after any restore, so the ongoing
  operational cost is mostly automated, not purely manual.
- Assignment, schedule-rule, and calendar-entry terminalization on deletion
  now touches more rows per deletion than the first draft did (previously
  only membership status and coaching-relationship status changed) — a
  larger, but still single, atomic transaction; the security analysis
  (design document Section 24) adds corresponding scope-boundary tests to
  ensure this never reaches another member's own assignments or calendar.
