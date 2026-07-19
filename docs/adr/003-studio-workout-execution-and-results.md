# ADR 003: Studio workout execution and results (Stage 1B.2B1)

- Status: Accepted
- Date: 2026-07-19
- Stage: 1B.2B1

## Context

Stage 1B.1 gave studios coaching relationships, training programs, immutable
published versions, and member-facing program assignments. Stage 1B.2A built
the coach/program management UI and the member's read-only "Mein
Trainingsplan" view on top of that. Neither phase let a member actually
*perform* an assigned workout: there was no record of "I did this session, on
this day, with these results."

Stage 1B.2B1 is the backend and data-model foundation for that record only.
It does not ship a workout-execution UI, timers, or coach feedback — those are
Stage 1B.2B2's job. This ADR decides the ownership, snapshot, idempotency,
concurrency, and access model a later UI will be built on.

## Decision

### A studio workout session belongs to exactly one member, inside exactly one studio, against exactly one assignment

`studio_workout_sessions` carries `studio_id`, `assignment_id`,
`member_membership_id`, `program_version_id`, `program_day_id`, and
`coaching_relationship_id`. All six are resolved and locked together at start
time and never re-resolved afterward — a session is a fact about what
happened on a specific date against a specific plan, not a live view that
tracks whatever the assignment currently points at.

This mirrors Stage 1B.1's own precedent: `studio_program_assignments.
program_version_id` is bound forever to the version that existed at
assignment time, precisely so a new program version never rewrites history.
A workout session extends that same "reproducible historical record"
guarantee one level deeper, into what was actually trained.

### The plan is copied into the session as an immutable snapshot at start time

Starting a session copies the target program day's exercises
(`exercise_name_snapshot`, instructions, and every target metric) into
`studio_workout_session_exercises`, and — when `target_sets > 0` — pre-creates
that many `pending` rows in `studio_workout_session_sets`. `source_program_
exercise_id` is kept only as non-authoritative provenance (nullable, `ON
DELETE SET NULL`); nothing about the session is ever recomputed by re-reading
the program.

This is the same reasoning Stage 1B.1's ADR gave for binding assignments to
one version: if a trainer edits the program tomorrow (a new draft version,
new day content), every session a member already ran must keep showing
exactly what they were actually asked to do at the time, not a retroactively
edited plan. Editing an in-progress session's snapshot to match a program
change would silently rewrite what "today's workout" means mid-workout.

### Studio sessions are new tables, never the personal `workouts` schema

`workouts`, `workout_exercises`, and `progress_entries` remain exclusively
personal, per-user, non-tenant tables — the same boundary Stage 1A's ADR
established and Stage 1B.1's ADR repeated for the training-program tables.
Migration 007 adds no column, foreign key, or join between the new
`studio_workout_session*` tables and any personal table. A studio must never
be able to enumerate, join against, or accidentally expose a member's
personal workout history, and a member's personal training data must never
become reachable by walking a foreign key from studio content.

Concretely: a completed studio session does **not** create a row in
`workouts` or `progress_entries`. Personal progress remains something a
member records for themselves; studio session results are the studio's
record of a coached workout. Whether or how those two views converge for the
member's own benefit is explicitly a Stage 1B.2B2+ product decision, not an
automatic side effect this migration performs.

### A member may only start a session through their own active, current assignment

Starting requires, checked fresh inside the transaction: the member's studio
membership is `active`; the target assignment's `member_membership_id`
matches the actor; the assignment's `status` is `active` (not `cancelled` or
`completed`); today is on or after `starts_on` (if set) and on or before
`ends_on` (if set); the requested `program_day_id` belongs to the
assignment's own `program_version_id`; and the assignment's
`coaching_relationship_id` is still `active` and tenant-consistent. All six
conditions are re-checked live — none are trusted from a prior read or from
client input.

### Duplicate starts are prevented by an idempotency key, not by "one session per assignment"

A member can legitimately run the same assigned program multiple times (e.g.
the same day, different weeks), so uniqueness cannot be `(assignment_id,
program_day_id)`. Instead the client supplies a `client_start_key` (opaque,
client-generated, e.g. a UUID minted once per "start workout" tap); the
server enforces `UNIQUE(member_membership_id, assignment_id,
client_start_key)`. Replaying the same start request (network retry,
double-tap) with the same key returns the existing session unchanged — no
second session, no duplicate exercises or sets. Reusing that same key against
a *different* assignment or day is treated as a client bug and rejected with
`WORKOUT_START_KEY_CONFLICT` rather than silently starting the original
session's plan under a new identity.

### Autosave uses per-row optimistic concurrency, not last-write-wins

Every mutable row — the session itself, each session exercise, each set —
carries a monotonically increasing `revision`, starting at 0. Every mutating
request must supply the `expectedRevision` it last saw; the update statement
is `UPDATE ... SET revision = revision + 1, ... WHERE id = ? AND revision =
?`. Zero affected rows means someone else (another device, a completed
autosave the client hasn't seen yet) already moved the revision forward, and
the request fails with a stable `*_CONFLICT` code and no data written. This
is deliberately not resolved server-side: the client is expected to reload
and let the member decide, the same way a merge conflict is surfaced rather
than silently guessed. Given that a real workout is frequently logged from a
phone with poor connectivity, silently accepting a stale write would risk
quietly discarding a set the member already believed was saved.

### Completion requires an explicit, validated, all-or-nothing transition

A session may move `in_progress → completed` only when every session
exercise is `completed` or `skipped` (none left `pending`), every
`completed` exercise has zero `pending` sets, and at least one exercise has
at least one `completed` set with a plausible metric recorded. There is no
silent auto-completion of anything left open — an incomplete session simply
cannot complete (`WORKOUT_SESSION_INCOMPLETE`) until the member explicitly
marks the remaining items `completed` or `skipped`. `in_progress → aborted`
has no such precondition: abort exists precisely for "I'm stopping now,
whatever state this is in," and preserves every row exactly as it stood.
Both transitions are terminal; `completed` and `aborted` sessions (and their
exercises and sets) reject every further mutation.

### A trainer's (or owner's, or admin's) read access to results requires their own active coaching relationship — role alone is never enough

This is the one point where Stage 1B.2B1 is *stricter* than Stage 1B.1's
existing assignment-management model. In Stage 1B.1, an owner or admin can
manage (create/list) any assignment in their studio purely from their role,
because an assignment is operational/administrative metadata (who is
enrolled in what). A workout session's **results** — actual reps, weight,
RPE, notes — are the closest thing this application has to health data, and
Stage 1B.2B1 does not extend the owner/admin administrative bypass to them.
Reading a coached member's session detail requires, with no role-based
exception: the reader's own studio membership is `active` with role
`owner`, `admin`, or `trainer`; a `studio_coaching_relationships` row with
`status = 'active'` exists where `coach_membership_id` is the reader's own
membership and `member_membership_id` is the session's member; and the
target member's own membership is still `active`. An owner or admin who
wants to see a specific member's results must hold that same explicit,
revocable coaching relationship a trainer would — being the studio's owner
grants no shortcut.

A studio-wide "list all sessions for operational/debugging purposes,
metadata only, no set results" capability for owner/admin was considered and
is explicitly deferred, not built, in this phase — see Alternatives.

### Access ends immediately when the coaching relationship ends; the member's own access never does

Ending a coaching relationship (or suspending/removing the coach's
membership) removes that coach's read access to the member's sessions on the
very next request — access is recomputed live, exactly as Stage 1B.1's ADR
already established for assignments. It does **not** touch the session rows
themselves, does not cancel an in-progress session, and does not affect the
member's own access in any way: the member who owns a session may keep
reading it, keep completing or aborting an already-started `in_progress`
session, and keeps permanent read access to their own historical results,
regardless of what happens to the coaching relationship that was active when
they started it. A different trainer gains no access merely because the
first relationship ended — they need their own explicit active relationship
with that member, the same as in Stage 1B.1.

Foreign access attempts (wrong studio, wrong member, ended relationship,
guessed session ID) all resolve to the identical `WORKOUT_SESSION_NOT_FOUND`
— no distinction between "does not exist" and "exists but not yours to see."

### The studio audit trail records that a session happened, never what happened in it

`workout_session.started`, `workout_session.completed`, and
`workout_session.aborted` are added to the same allowlisted, same-transaction
audit contract Stage 1A and 1B.1 already use. Their detail payload is limited
to identifiers and status (session/assignment/day references, resulting
status) — never weight, reps, duration, distance, RPE, or member notes.
Per-set and per-exercise autosave mutations do not create audit rows at all;
if they did, the append-only audit log would silently become an
unbounded, unredactable archive of every training metric a member ever
logged, defeating the entire purpose of keeping the audit trail
health-data-free. Normal application logs follow the same rule: request
logging must never surface a workout result or a member note.

## What Stage 1B.2B2 owns instead

- The actual workout-execution UI: starting a session from "Mein
  Trainingsplan," a set-by-set logger, rest timers.
- A coach-facing results view built on the read endpoints this phase
  exposes.
- Coach comments or feedback threads on a completed session.
- Any reconciliation between studio session results and the member's
  personal progress views, if ever wanted.
- The deferred owner/admin metadata-only (no results) operational view, if
  a real operational need for it materializes.

## Alternatives rejected

- **Writing completed studio sessions into the personal `workouts` /
  `progress_entries` tables:** rejected for the same reason Stage 1A and
  Stage 1B.1 rejected tenantizing personal tables — it would blur exactly the
  boundary those ADRs exist to protect, and would make a studio's departure
  or a coaching relationship's end an awkward, hard-to-reason-about personal
  data question.
- **One session per assignment (no idempotency key):** rejected — members
  legitimately repeat programs, and a real mobile client needs a safe retry
  story for "did my start request actually go through?" that a hard
  uniqueness constraint on the assignment alone cannot provide.
- **Last-write-wins autosave:** rejected — silently discarding a concurrently
  saved set is a worse failure mode than surfacing a conflict the client can
  resolve.
- **Owner/admin bypass on result reads (matching the assignment-management
  precedent):** rejected specifically for *results*, even though it is used
  for assignment metadata — set-by-set training data is materially more
  sensitive, and Section 3/9 of this phase's mandate is explicit that
  administrative role must not imply a health-data read.
- **A general owner/admin operational session-list endpoint:** deferred, not
  rejected outright — it is plausible future value, but building it now
  without a concrete operational requirement risks exactly the kind of
  scope creep this phase's mandate explicitly warns against. Revisit only
  with a real requirement and its own explicit, metrics-free contract.
- **Recomputing session content from the live program on every read:**
  rejected — it would silently change historical sessions whenever a program
  or version changed, breaking the reproducibility guarantee this whole
  design exists to provide.

## Consequences

- Every coach-facing result read carries the same "one extra live lookup"
  cost Stage 1A and 1B.1 already accepted in exchange for correctness.
- A member's own session history survives role changes, coaching-relationship
  endings, and even the studio revoking their program access going forward —
  only the ability to *start new* sessions depends on an active assignment.
- Stage 1B.2B2 can build directly on this schema and API surface without a
  migration that changes ownership, snapshot, or isolation semantics — the
  same handoff guarantee Stage 1B.1's ADR gave Stage 1B.2.
