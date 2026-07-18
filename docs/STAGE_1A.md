# Stage 1A: Studio, tenant and role foundation

## Purpose

Stage 1A turns FitTrack's identity layer into a B2B2C-ready foundation while
preserving the existing personal application. It introduces studios,
memberships, role-based authorization, secure invitations and a minimal audit
trail. It does not introduce studio-owned training plans or expose personal
training data to a studio.

The implementation branch starts from the fully integrated and green Stage 0C
main commit:

```text
1f651fb6a083784df66f5a62e25702c736d99672
```

Architecture rationale is recorded in
[`adr/001-studio-tenancy-and-rbac.md`](adr/001-studio-tenancy-and-rbac.md).

## Implementation plan

1. Add migration 005 for studios, memberships, invitations and audit events;
   extend the schema contract and Migration Doctor coverage.
2. Add central studio-context resolution, permission policies, exact payload
   validation and transaction-safe services.
3. Expose the versioned studio, membership, invitation and audit API.
4. Add a client workspace model, accessible context switcher and bounded studio
   administration views.
5. Add unit, database, API, negative tenant-isolation, component, Chromium and
   Axe gates; retain all personal-area regression tests.
6. Update deployment and backup/restore guidance, then verify local and remote
   CI on the exact feature-branch head.

## Context model

```text
global user
├── personal context (default; existing training data)
└── zero or more active studio memberships
    ├── owner
    ├── admin
    ├── trainer
    └── member
```

The browser may remember one preferred public studio ID. It never persists a
role as authority. Memberships and roles are reloaded from the API, and an
invalid preference falls back to the personal context.

## Data model

Migration `005_studio_tenancy_and_rbac` is additive and creates four tables.

### `studios`

Stores a non-sequential public UUID, normalized unique slug, active/suspended
status, locale, timezone, weight unit, creator and timestamps. Numeric keys stay
internal.

### `studio_memberships`

Joins one global user to one studio with exactly one row per pair. Roles are
`owner`, `admin`, `trainer` and `member`; lifecycle states are `invited`,
`active`, `suspended` and `left`. Stage 1A changes lifecycle state instead of
deleting membership history.

### `studio_invitations`

Stores the normalized email, invited role, SHA-256 token digest, lifecycle,
expiry and actor/acceptance timestamps. It never stores the bearer token.

### `studio_audit_events`

Stores append-only critical studio events with an actor, safe target metadata
and allowlisted JSON details. It contains no passwords, bearer tokens, request
bodies or training/health data.

No Stage 1A migration modifies `exercises`, `workouts`, `workout_exercises` or
`progress_entries` and no existing row receives a studio ID.

## Tenant resolution

Tenant endpoints use `/api/v1/studios/:studioId/...`, where `:studioId` is the
public studio UUID. Central middleware resolves the studio and the authenticated
user's current database membership together. It requires both studio and
membership to be active before attaching the tenant context.

Unknown and foreign studio IDs share the same not-found behavior. Suspended or
left memberships cannot use ordinary studio routes. Client roles, user IDs and
body-supplied studio IDs are not trusted.

## Role matrix

| Capability | Owner | Admin | Trainer | Member |
| --- | --- | --- | --- | --- |
| Read studio basics | yes | yes | yes | yes |
| Read own membership | yes | yes | yes | yes |
| Edit allowed basic settings | yes | yes | no | no |
| List/manage trainer/member memberships | yes | yes | no | no |
| Invite trainer/member | yes | yes | no | no |
| Invite admin | yes | no | no | no |
| Appoint/manage owner | yes | no | no | no |
| Read audit events | yes | yes | no | no |

Additional invariants:

- every studio retains at least one active owner;
- the last active owner cannot be demoted, suspended or marked left;
- an admin cannot change an owner;
- an actor cannot self-promote;
- membership and invitation mutations are tenant-filtered and transactional;
- trainers and members receive no Stage 1A management capability.

## API surface

```text
POST   /api/v1/studios
GET    /api/v1/studios
GET    /api/v1/studios/:studioId
PATCH  /api/v1/studios/:studioId

GET    /api/v1/studios/:studioId/memberships
GET    /api/v1/studios/:studioId/memberships/me
PATCH  /api/v1/studios/:studioId/memberships/:membershipId

POST   /api/v1/studios/:studioId/invitations
GET    /api/v1/studios/:studioId/invitations
DELETE /api/v1/studios/:studioId/invitations/:invitationId
POST   /api/v1/invitations/:token/accept

GET    /api/v1/studios/:studioId/audit-events
```

All endpoints keep the existing request-ID and error envelope. List endpoints
use bounded pagination. Mutating payloads reject unknown fields to prevent mass
assignment.

## Invitation lifecycle and delivery

1. An authorized owner/admin submits a normalized email and permitted role.
2. The service generates 32 random bytes and stores only its SHA-256 digest.
3. The invitation and `invitation.created` audit event are committed atomically.
4. A development/test delivery adapter can expose the acceptance URL once. It is
   never logged, audited or persisted by the client.
5. An authenticated account with the invited email accepts before expiry.
6. Membership creation/reactivation, one-time token consumption and audit happen
   in one transaction.

Revoked, expired and consumed tokens cannot be replayed. Production without a
configured delivery provider fails visibly and does not pretend that a message
was sent. A production provider remains a pilot prerequisite.

## Frontend foundation

The workspace switcher always contains a client-only `Personal` option followed
by the user's freshly authorized studios. Personal remains the initial context.
Studio pages cover creation, basic information/settings, memberships and
invitations. Navigation actions are hidden by role for usability, while every API
request is independently authorized by the backend.

A 403 response displays an access state and does not clear the global login. A
401 retains the existing secure session-expiry behavior. Invitation bearer tokens
are not stored in local storage or normal application state after acceptance.

## Security and privacy rules

- public UUIDs reduce enumeration but never replace membership checks;
- all nested queries include the resolved internal studio key;
- role/status is read from the database on each protected request;
- owner and invitation races use database locks and conditional writes;
- exact payload schemas prevent user/studio/role mass assignment;
- audit details are allowlisted and length bounded;
- studio APIs expose no personal exercise, workout or progress data;
- normal logging captures route templates, never invitation URLs or bodies;
- left-member visibility and invitation retention are bounded operational concerns
  documented for the pilot, not an unlimited data-sharing grant.

## Verification strategy

Release gates include:

- policy, slug, UUID, token hashing, validation and audit unit tests;
- empty and existing Stage 0C database migration tests plus Doctor verification;
- API integration and rollback tests;
- two-studio negative isolation tests for reads and mutations;
- invitation expiry, revocation, replay and email-binding tests;
- last-owner and admin/owner boundary tests;
- personal registration/training API regressions;
- workspace, role navigation, invitation and 403 component tests;
- Chromium owner/trainer/member/foreign-user flow and Axe smokes;
- production build and backend/frontend security audits.

Exact final counts, commit SHAs and remote workflow links are recorded in the
feature pull request after verification.

## Explicit limitations

Stage 1A does not include training-program construction/versioning, workout
assignment, coach feedback, check-ins, studio analytics, risk scoring, booking,
payments, contracts, access control, community, wearables, AI, native apps,
custom domains, full white label, complex locations, microservices or Kubernetes.

The next possible phase is Stage 1B, the coach/member training flow. It must not
start without explicit approval.
