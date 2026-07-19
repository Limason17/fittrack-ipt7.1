# ADR 002: Coach-member training ownership (Stage 1B.1)

- Status: Accepted
- Date: 2026-07-19
- Stage: 1B.1

## Context

Stage 1A gave FitTrack studio tenancy, roles and RBAC, but studios still had
no training content of their own: `exercises`, `workouts` and
`progress_entries` remain exclusively personal, per-user tables with no
tenant column. Stage 1B introduces studio-owned training programs that
trainers build and assign to members they coach. Stage 1B.1 is the backend
and data-model foundation only; no program builder or workout-execution UI
ships in this phase.

The central risk this ADR addresses: without an explicit, revocable
coach-member link, "trainer" would become a studio-wide read grant over
every member's training data. That is stricter than intended and would also
make Stage 1B.2 (coach dashboards, workout execution) harder to scope
correctly later.

## Decision

### Studio training programs belong to the studio, not to the trainer who authored them

`studio_training_programs` carries `studio_id` and `created_by_user_id`
(provenance only). Any active owner, admin or trainer may create, edit
(while in draft) and publish any program in their own studio — the same way
a shared studio asset (like the member list) is administered by the whole
management/coaching group, not fenced off per author. A per-trainer
ownership model was considered and rejected (see Alternatives): it would
require a second authorization axis ("is this my program?") on top of the
coaching-relationship axis, without a corresponding requirement in this
phase, and would block one trainer from covering for another using a
shared program.

### Trainer-member coaching is an explicit, revocable relationship

`studio_coaching_relationships` links one `coach_membership_id` to one
`member_membership_id` inside one studio, with a `status` of `active` or
`ended`. A trainer may only act on a member (assign a program, read that
member's studio assignments) through a currently `active` relationship
they are the coach of. Owners and admins manage these relationships;
trainers cannot create their own (this is enforced identically to how
Stage 1A's `membershipChangeDecision` prevents self-promotion — the actor
authorized to grant an association can never be the association's own
beneficiary).

This is deliberately independent of Stage 1A's membership role. A studio
membership answers "what can this person do in general"; a coaching
relationship answers "which specific member has this specific trainer
agreed to work with." Collapsing them (e.g. "any trainer may act on any
member") would make Stage 1B's core promise — coaches only see the
training data of members who were explicitly placed with them — impossible
to enforce.

### A trainer may see a member's studio training data only through an active coaching relationship

Every read or write a trainer performs against a specific member's
coaching-scoped data (their assignments, and in Stage 1B.2 their logged
sessions) re-checks, in the same query, that:

1. the trainer's own membership is `active` in that studio;
2. the target's membership is `active` and has role `member`;
3. a `studio_coaching_relationships` row for that exact coach/member pair
   has `status = 'active'`.

All three are loaded fresh from the database on every request, never
cached and never trusted from a client-supplied value — the same rule
Stage 1A already applies to role and membership status.

### Personal and studio training data stay in separate, unlinked tables

Stage 1B.1 adds no column, foreign key or join between the Stage-1B tables
and `exercises`, `workouts`, `workout_exercises` or `progress_entries`.
`studio_training_program_exercises` stores an
`exercise_name_snapshot` (plain text) instead of referencing
`exercises.id`. This is a deliberate repeat of Stage 1A's "personal data is
not a tenant" decision: a studio must never be able to enumerate, join
against or accidentally expose a member's personal exercise catalog, and a
member's personal training history must never be reachable by walking a
foreign key from studio content. A studio program that wants a "Bench
Press" day just says so; it does not, and structurally cannot, point at
anyone's personal `exercises` row.

### Program versions become immutable at publish; assignments bind to one version

A program has draft, published and retired versions
(`studio_training_program_versions`). Only a `draft` version's days and
exercises may be edited. Publishing is one atomic transaction: it locks the
version row, verifies it is still `draft`, verifies `version_number`
uniqueness for the program, and flips it to `published` with a
`published_at` timestamp. Once published, the version's days and exercises
are read-only for the lifetime of the row — the service layer rejects any
mutation against a non-draft version before it touches the database, and
there is intentionally no "unpublish" transition.

`studio_program_assignments.program_version_id` points at one specific
version, not at the program. Creating a new version of a program never
touches existing assignments: they keep pointing at the version they were
assigned under. This gives every member a stable, reproducible view of
"what I was actually assigned on this date" even as a studio iterates on
its program library, and it is why assignment creation requires the target
version's `status = 'published'` — a draft is not yet a stable thing to
commit a member to, and a `retired` version is intentionally still
assignable-view-only for members who already have it (their existing
assignment keeps working) but is excluded from new assignments.

### Access ends immediately when a coaching relationship or membership ends

Ending a coaching relationship (`status = 'ended'`, `ended_at` set) removes
the trainer's access to that member's assignments and coaching-scoped data
on the very next request — there is no grace period and no cached
membership snapshot to invalidate, because access is recomputed from the
database every time (see above). The same is true if either party's studio
membership becomes `suspended` or `left`: the tenant-context middleware
already refuses to attach a studio context for a non-active membership, so
every Stage 1B endpoint is unreachable for that account before any Stage
1B-specific check even runs.

Ending a relationship does not delete or cancel that trainer's existing
program assignments for the member; those keep their own independent
`status` (`active`/`completed`/`cancelled`) and their own audit trail. A
coaching relationship answers "who may act now," not "what happened
historically."

### History is retained, never overwritten

Coaching relationships are never deleted, only transitioned to `ended`
(mirroring Stage 1A's membership `left`/`suspended` pattern). Program
versions are never deleted or mutated after publish; a studio that wants to
change a program creates a new version. Assignments keep their original
`program_version_id` forever. This means a studio's and a member's training
history stays fully reconstructable months or years later, exactly as
Stage 1A already guarantees for membership and invitation history.

### What a trainer must never see

A trainer, even with an active coaching relationship, never gains: another
member's data (no relationship covers them); another trainer's coaching
list; any personal `exercises`, `workouts` or `progress_entries` row,
regardless of studio membership; another studio's programs or members
(ordinary tenant isolation); or the ability to grant themselves a coaching
relationship, change their own studio role, or manage owner/admin
memberships (all already forbidden by Stage 1A's policy and left
unchanged).

## Cross-tenant and cross-relationship controls

1. non-sequential public UUIDs on every new table, exactly as Stage 1A;
2. every Stage 1B query is tenant-filtered on the resolved internal
   `studio_id`, never on the public studio UUID directly;
3. every coach-facing query additionally filters on a live, active
   `studio_coaching_relationships` row — a second, independent predicate on
   top of tenant isolation;
4. role and membership/relationship status are loaded from the database on
   every protected request, never taken from a JWT claim or request body;
5. row locks (`FOR UPDATE`) on the coaching relationship, the program
   version and the target membership during creation, publishing and
   assignment, so concurrent requests cannot create two active
   relationships for the same pair, publish the same version twice, or
   assign against a relationship that is being ended in the same instant;
6. negative two-studio, two-trainer isolation tests are mandatory release
   gates, matching Stage 1A's precedent.

## Alternatives rejected

- **Per-trainer program ownership** (a program belongs to the trainer who
  created it, others need explicit sharing): rejected for this phase — no
  requirement calls for it, and it would need its own permission axis on
  top of the coaching-relationship model without a corresponding user
  story yet. Revisit only if a real multi-trainer content-ownership need
  appears.
- **Implicit coaching from role alone** ("any trainer may act on any
  member"): rejected — this is exactly the over-broad access Stage 1B.1
  exists to prevent; it would also make per-member consent/assignment
  impossible to reason about.
- **Foreign key from studio program exercises to personal `exercises`**:
  rejected for the same reason Stage 1A rejected adding `studio_id` to
  personal tables — it would create exactly the accidental-sharing path
  personal data must never have. A denormalized snapshot costs a small
  amount of duplication and buys a hard structural guarantee.
- **Mutable published versions ("just let a trainer fix a typo")**:
  rejected — mutability after publish would silently change what every
  existing assignment means retroactively, breaking the "reproducible
  historical assignment" guarantee. The correct fix is a new version.
- **Cascading assignment cancellation when a coaching relationship ends**:
  rejected as an automatic side effect — ending a relationship is about
  future access, not a judgment that in-progress training should stop.
  Owner/admin can cancel a specific assignment explicitly if that is
  actually intended.

## Consequences

- Every coach-facing read/write carries one extra join/lookup (the active
  coaching relationship) beyond Stage 1A's membership check. This is the
  same "favor correctness over premature caching" trade-off Stage 1A's ADR
  already accepted for tenant reads.
- Reassigning a member to a different trainer requires an explicit
  owner/admin action (end one relationship, start another); there is no
  automatic transfer.
- Stage 1B.1 intentionally ships without a way for a member to browse the
  studio's general program catalog — only their own assignments. A
  dedicated member-facing catalog view, if wanted, is a Stage 1B.2
  decision with its own consent question.
- Stage 1B.2 (workout execution, set-by-set logging, coach feedback,
  check-ins) is unblocked to build directly on this schema without a
  migration that changes ownership or isolation semantics.
