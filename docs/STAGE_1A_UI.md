# Stage 1A UI foundation

## Purpose

This is a visual and structural redesign of the existing Stage 1A frontend. It
does not add, remove or alter any product feature, API contract, permission
rule or data model. Personal training features (exercises, workouts,
progress) keep their existing behavior; only their visual language changed to
match the new design system.

## Design tokens

Central tokens live in `frontend/src/assets/main.css` (`:root`). Existing
token names (`--bg`, `--surface`, `--text`, `--accent`, `--warning`, `--radius`,
`--shadow-sm`, ...) were kept and re-themed in place so every existing
component automatically adopts the new palette without a markup rewrite.
New tokens were added for what the app previously lacked:

- `--danger` / `--danger-soft` / `--danger-border` — true red, now used for
  actual errors and destructive actions. `--warning` previously doubled as
  the error color; it is now a distinct amber used for "needs attention"
  states (e.g. suspended membership).
- `--success`, `--info` and their `-soft`/`-border` pairs — a complete
  semantic set for the four states used across studio/member/invitation
  status (active/success, invited or pending/info, suspended/warning,
  left or revoked/neutral).
- `--radius-sm` / `--radius` / `--radius-lg` / `--radius-full` and
  `--shadow-xs` / `--shadow-sm` / `--shadow-md` — a small consistent scale,
  replacing ad hoc `8px`, `12px` and one-off shadow values found across the
  previous per-view `<style>` blocks.
- `--space-1` … `--space-12`, `--text-xs` … `--text-xl`, `--focus-ring`,
  `--transition-fast` / `--transition` — used by new shared components.
- `--shell-sidebar-width` / `--shell-header-height` — the new app shell
  layout.

`frontend/src/assets/base.css` (an unused Vue-scaffold leftover, never
imported) was removed.

## Shared component library

New components live in `frontend/src/components/ui/` and
`frontend/src/components/layout/`, following the project's existing
lightweight pattern (small Vue SFCs plus shared CSS classes in `main.css`,
not a new UI framework):

- **Layout**: `AppSidebar.vue`, `AppHeader.vue` — the app shell (see below).
- **Badge.vue** — single implementation for role/status/neutral badges,
  replacing three near-duplicate "pill" implementations. Tone mapping lives
  in `utils/studioBadges.js`.
- **Modal.vue** / **ConfirmDialog.vue** — reuse the existing
  `useModalFocus` composable (already used by the exercise-picker dialog) for
  focus trapping, Escape-to-close and return-focus. Used for membership
  role/status changes and invitation revocation, which previously applied
  immediately with no confirmation step.
- **ToastHost.vue** + `utils/toast.js` — a small toast queue for
  save-confirmation feedback, used alongside (not instead of) existing inline
  `message-success`/`message-error` text.
- **Pagination.vue**, **EmptyState.vue**, **PageHeader.vue**, **Tabs.vue**,
  **Dropdown.vue** — extracted from patterns that were previously
  copy-pasted per view (page header block, pagination controls, empty-state
  markup).
- A CSS-only responsive **table pattern** (`.table-wrap.table-stack`) was
  added to `main.css`: a real `<table>` on desktop, and a `data-label`-driven
  stacked-card layout below 720px with zero extra JavaScript. Used for the
  member list, invitation list and audit log, replacing a CSS-grid
  "list-row" pattern that could not express real table semantics.

## Navigation and workspace model

The previous single top navbar (which, in a studio context, crammed 7 nav
links, the workspace switcher, three preference toggles and the user menu
into one row, plus a duplicate in-page tab bar for studio subpages) is
replaced by:

- **`AppSidebar.vue`** — a persistent left sidebar on desktop (≥1024px),
  an off-canvas drawer below that breakpoint. Contains the workspace switcher
  at the top, a "Persönlich" navigation group (always present), and a
  "Studio" group (only rendered when a studio is active), each item gated by
  the same role checks the old navbar used
  (`canManageActiveStudio`/`canViewActiveStudioMembers`). The in-page studio
  tab bar (`StudioSubnav.vue`) is removed; its links now live in the sidebar,
  removing the duplicate navigation.
- **`AppHeader.vue`** — a slim top bar with the mobile menu toggle, the
  language/weight/distance-unit toggles, and an account menu (profile link,
  logout). The account menu is new; the personal-preference toggles keep
  their previous one-click interaction (kept as compact always-visible
  buttons, not hidden behind an extra click, since existing E2E coverage
  and the personal training views depend on quick access to them).
- The mobile drawer reuses the same focus-trap/Escape/return-focus behavior
  as the app's dialogs, and the toggle button carries `aria-expanded`,
  `aria-controls` and a dynamic label, matching the pattern used everywhere
  a role/status can be announced.

## New pages

- **`/profile`** (`ProfileView.vue`) — surfaces the account info and the
  existing language/weight-unit/distance-unit preferences (previously only
  reachable via the header toggles) as a dedicated settings page with an
  account tab and a preferences tab. No new backend calls; it reuses the
  existing `/users/language`, `/users/weight-unit`, `/users/distance-unit`
  endpoints already wired in `utils/i18n.js` / `utils/units.js`.
- **`/studios/:studioId/audit`** (`StudioAuditView.vue`) — a read-only audit
  log view for owners/admins, consuming the existing (previously
  frontend-unused) `GET /api/v1/studios/:studioId/audit-events` endpoint via
  a new `listAuditEvents` function in `utils/studioApi.js`. No backend or
  permission change; the route is gated the same way the existing invitations
  page is (`studioRoles: ['owner', 'admin']`).

## States and feedback

Studio views now use consistent skeleton loading blocks instead of plain
"Laden…" text, the shared `EmptyState` component instead of ad hoc empty
markup, and `ConfirmDialog` before role changes, membership status changes
and invitation revocation — each dialog explains the specific consequence
(e.g. "X verliert sofort den Zugriff auf dieses Studio") rather than a
generic "Are you sure?". Rows a manager cannot edit (e.g. an admin viewing an
owner's membership) now show a plain-language reason
("Nur Eigentümer:innen können diese Mitgliedschaft verwalten.") instead of a
disabled, unexplained control.

## Accessibility

- Fixed: an icon-only dropdown trigger (the account menu) had no accessible
  name (`Dropdown.vue` now falls back to the `label` prop as `aria-label`
  when a custom trigger slot is used).
- Fixed: `--text-muted` on `--surface-soft` measured 4.3:1 contrast (below
  WCAG AA's 4.5:1) at the small bold label size used for detail labels;
  darkened to `#565c63`.
- Fixed: an empty-state heading held a full sentence as its `<h3>`; split
  into a short heading (`studios.emptyTitle`) and a separate description,
  which is also better content design for a heading.
- The mobile navigation drawer gained proper focus management (see above),
  which it previously lacked entirely as a new addition of this redesign.

All fixes were found by running the existing Axe/Chromium E2E gate against
the new UI, not by inspection alone.

## What did not change

Database schema, migration 005, tenant resolution, the RBAC policy module,
invitation token handling, the audit event model, and all existing API
contracts are untouched. `git diff` for this branch touches only files under
`frontend/` (plus this documentation).
