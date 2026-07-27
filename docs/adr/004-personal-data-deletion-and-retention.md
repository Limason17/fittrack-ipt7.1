# ADR 004: Personal data deletion and retention (Stage 5C)

- Status: Accepted (design only — no implementation in this phase)
- Date: 2026-07-27
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

### Historical studio data is never rewritten, only its author becomes unidentifiable

Completed workout sessions, sets, exercises, assignments, program versions,
and feedback are not touched by a deletion beyond what anonymizing the
`users` row already achieves indirectly. The one explicit exception is the
free-text `member_note` field on session/set rows, which is cleared (set to
`NULL`, not replaced) because it is unstructured, potentially PII-bearing
text with no equivalent fact-preservation requirement — unlike the numeric
results and timestamps around it. `studio_workout_session_feedback.body` is
never touched at all; it has no update path today and this design adds
none.

### A restore from before a deletion is a documented operational reconciliation step, not a database ledger row

A ledger table recording "this account was deleted at time T" would live in
the same database snapshot as the anonymized `users` row itself — a backup
taken before the deletion contains neither. It cannot solve the problem it
would be built for. Instead, deletion completion is recorded as a
structured application log event (`account_deletion_completed`, internal
ID only, no direct identifiers) — durable independently of the database's
own backup/restore cycle — and `docs/STAGE_5C_PERSONAL_DATA_LIFECYCLE_DESIGN.md`
Section 21 defines a manual runbook step: after any restore whose backup
predates a logged deletion, an operator re-runs that deletion, idempotently,
against the restored database before returning it to service.

## What this phase does not build

- Any of the above as running code, API endpoints, UI, or a migration.
- An automated, delayed/two-phase deletion flow.
- A personal-data export ("data portability") feature.
- An admin/support-initiated deletion of someone else's account (the
  `deletion_reason='admin_initiated'` value is reserved in the design but
  has no accompanying flow in this phase).
- Automatic studio-ownership transfer.
- A generic, cross-studio audit log system.
- A new retention-ledger database table.

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
- **A new `account_deletion_receipts`/retention-ledger table:** rejected —
  subject to the exact same backup/restore point-in-time limitation as the
  anonymized row itself; a structured log event outside the database's own
  backup cycle actually solves the reconciliation problem this would only
  appear to solve.
- **Reusing a brand-new membership status instead of the existing `left`:**
  rejected — `left` already carries the correct semantics ("no longer a
  member, rejoin requires a fresh invitation") for both administrative
  removal and self-removal; a second status would be an unjustified schema
  addition.

## Consequences

- Every future migration that adds a new table with a `user_id`/
  `*_by_user_id` reference must be explicitly classified (hard-delete,
  anonymize-indirectly, or retain-unchanged) — no automatic mechanism
  enforces this, only migration-review discipline.
- The smallest possible schema change is required for this decision:
  three additive columns on `users`, no new table.
- A future admin-initiated deletion flow, or a data-export feature, can be
  layered on top of this design later without revisiting the core
  anonymize-vs-hard-delete decision — the `lifecycle_status`/`deleted_at`/
  `deletion_reason` columns are designed with that extensibility in mind
  (`deletion_reason='admin_initiated'` is already reserved).
- Restore-from-backup operations gain a new mandatory manual step
  (reconciliation) that did not exist before this design; this is a real,
  ongoing operational cost, not a one-time implementation cost.
