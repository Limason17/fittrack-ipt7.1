# ADR 001: Studio tenancy and RBAC foundation

- Status: Accepted
- Date: 2026-07-18
- Stage: 1A

## Context

FitTrack started as a personal training application. Its authenticated resources are
owned by one global user and the existing JWT identifies that user only. Stage 1A
adds studios, studio memberships, invitations, roles and auditability without
turning existing personal workouts or progress data into studio data.

The foundation must support a global account belonging to zero, one or several
studios, potentially with a different role in each studio. Authorization must stay
correct immediately after a role or membership status changes and must not depend
on client state.

## Decision

### Global users remain the identity boundary

`users` remains the single account and authentication source. A user does not need
a studio to register, sign in or use the personal FitTrack area. Studio membership
is represented separately in `studio_memberships`.

This avoids duplicate credentials, ambiguous account recovery and account merging.
It also permits one user to be an owner in one studio, a trainer in another and a
member in a third.

### Personal data is not a tenant

The personal area is an explicit application context, not a synthetic studio.
Migration 005 adds studio tables only. It does not add `studio_id` to, backfill or
otherwise reassign existing exercises, workouts, workout exercises or progress
entries.

Stage 1A studio routes expose studio administration data only. Sharing or assigning
training data is deliberately deferred to a later stage with its own consent and
authorization model.

### Studio context is explicit in the route

Tenant-scoped endpoints use the public route form:

```text
/api/v1/studios/:studioId/...
```

`:studioId` is a non-sequential public UUID, while numeric primary keys remain an
internal database detail. The backend resolves that UUID and the authenticated
user's membership together. An unknown studio and a studio belonging only to
another tenant produce the same external not-found result.

There is no hidden global `currentStudioId` in the backend. The frontend's selected
workspace is only a navigation preference and never proof of access.

### Membership and role are loaded for every protected request

The JWT continues to identify only the global user. Studio roles are not embedded
as authoritative claims because an eight-hour token could otherwise retain a role
after suspension or demotion.

Central tenant middleware loads the studio and current membership from the
database, requires an active studio and membership, and attaches the validated
context to the request. Permission policies consume only that validated context.
Client-provided user IDs, studio IDs in request bodies and role strings are ignored
or rejected.

### Permissions are centralized and default-deny

The fixed Stage 1A roles are `owner`, `admin`, `trainer` and `member`. Permission
decisions live in one policy module rather than route-local string comparisons.

- Owners can update basic settings, invite admins/trainers/members, manage roles
  and membership status, appoint additional owners and read audit events.
- Admins can update their allowed basic settings and manage only trainers and
  members. They cannot appoint, suspend, demote or remove an owner.
- Trainers and members can read the studio and their own membership. Stage 1A does
  not grant them administrative mutation permissions.

UI visibility mirrors these rules for usability, but server policies are the
security boundary.

### Owner and invitation mutations are serialized

Studio creation, membership changes, invitation creation/revocation/acceptance and
their audit events use database transactions. Mutations that can affect owners lock
the studio and relevant membership rows before evaluating the invariant that every
studio has at least one active owner.

An actor cannot promote their own membership. An admin cannot mutate an owner. The
last active owner cannot be suspended, marked as left or demoted, including under
concurrent requests.

### Invitations store only token hashes

Invitation bearer tokens contain 32 cryptographically random bytes encoded with
base64url. Only a SHA-256 digest is stored. Tokens expire, can be revoked and are
consumed atomically once. Acceptance requires an authenticated global account with
the normalized invited email address.

Normal logs, audit details and database rows never contain the bearer token. A
test/development delivery adapter may return the acceptance link once to a local
caller. Production must fail visibly when no real delivery provider is configured;
it must not claim that mail was sent.

### Audit records are append-only application events

Critical studio mutations create a `studio_audit_events` row in the same
transaction. Event types and sanitized detail fields are allowlisted. Passwords,
tokens, request bodies and health/training data are forbidden. There are no update
or delete APIs for audit events.

### Membership history is retained

Normal membership removal is represented by status `left`; suspension uses
`suspended`. Rows are not physically deleted through Stage 1A APIs. This preserves
the one-membership-per-user/studio invariant and an auditable lifecycle while
allowing an explicitly invited former member to rejoin.

## Cross-tenant controls

The design uses several independent controls:

1. non-sequential public resource IDs;
2. tenant resolution by studio UUID plus authenticated user membership;
3. tenant predicates on every nested resource query;
4. centralized permission policies;
5. foreign keys, unique constraints and value checks;
6. transaction locks for owner and invitation races;
7. negative integration and browser tests using at least two studios and users.

Public UUIDs reduce guessability but are not treated as authorization. A leaked or
guessed UUID still fails the membership check.

## Existing accounts and compatibility

Existing users automatically remain personal-only users with zero memberships.
Registration, login and all existing `/api/users`, `/api/exercises`, `/api/workouts`
and `/api/progress` behavior remain valid. Creating or accepting a studio
membership is an explicit later action and does not expose personal training data.

## Alternatives rejected

- **A studio ID or role in the JWT:** rejected because role/status changes would be
  stale until token expiry and multi-studio roles do not fit one claim.
- **A client-controlled studio header:** rejected as the primary contract because
  tenant context should be visible in resource URLs and easier to audit.
- **One account per studio:** rejected because it duplicates identity and prevents
  safe multi-studio membership.
- **A personal studio for every user:** rejected because it invents tenancy and
  risks silently sharing or migrating personal data.
- **Adding `studio_id` to training tables in Stage 1A:** rejected until the later
  coach/member training flow defines ownership, consent and subject access.
- **Storing invitation tokens for retry:** rejected because database disclosure
  would turn every pending invitation into a usable bearer credential.

## Consequences

- Tenant-scoped reads add a membership lookup, favoring correctness over premature
  caching. Caching may be introduced later only with reliable invalidation.
- A production invitation provider remains a deployment prerequisite for a real
  pilot.
- Stage 1A can administer studios and memberships but cannot yet see, assign or
  coach member workouts.
- Complex locations, billing, contracts, analytics, white label, native apps and
  all Stage 1B training flows remain explicitly out of scope.
