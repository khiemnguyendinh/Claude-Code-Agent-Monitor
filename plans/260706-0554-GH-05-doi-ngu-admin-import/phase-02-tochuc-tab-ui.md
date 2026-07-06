# Phase 2 — ToChucTab: personnel roster CRUD + org chart editor add/delete

## Context Links
- Overview: [plan.md](plan.md)
- Depends on: [phase-01-personnel-backend.md](phase-01-personnel-backend.md)
- Current file: `client/src/kad/pages/DoiNgu/ToChucTab.tsx` (197 lines, full content already read this session).

## Overview
- Priority: P0.
- Status: not started.
- Two independent additions to the same file: (a) a personnel roster panel with add/edit/archive + permission checkboxes, (b) add/delete buttons on the existing `OrgChartEditor` sub-component (currently edit-only, `ToChucTab.tsx:255-294`).

## Key Insights
- The org chart editor's save path (`ToChucTab.tsx:139-147`) already calls `kadApi.orgContext.updateOrgChart(nodes)`, which hits `PUT /api/kad/org-chart` -> `replaceOrgChart()` (`org-context.js:336-347`) — a **bulk replace** (delete removed rows, insert new ones, in one transaction). This means add/delete needs **zero new backend work** — purely client-side: "Add node" pushes a new row with a client-generated temp id (e.g. `newId()`-style random string prefixed so it's visually distinguishable pre-save, or just let the existing `normalizeNode` in `org-context.js:294-310` remap any id on save since it already does `idMap` remapping) and "Delete node" filters it out of the `nodes` array before save.
- Careful: `normalizeNode` remaps `parent_id` through `idMap` using the SAME index pass — if a node is deleted client-side that other nodes still reference as `parent_id`, decide UI behavior: either block delete while children exist (simplest, recommended) or cascade the parent_id of orphaned children to `null`/grandparent before save.
- The 2026-07-04 comment at `ToChucTab.tsx:7-11` explains a personnel *grid* was deliberately removed because it duplicated the peek-drawer click-through — the new roster panel is not that old grid; it's a genuinely new admin surface (add/edit/permissions/archive), so it doesn't reintroduce the thing that was removed. Keep it visually distinct from the read-only org-chart hub-and-spoke display above it.

## Requirements
1. New "Nhân sự số" panel (new section in `ToChucTab.tsx`, below or alongside the existing org chart display) listing all agents from `kadApi.agents.list()` (already fetched at line 32) filterable/visibly excluding `status='archived'` by default (with a toggle to reveal archived ones, read-only).
2. "Thêm nhân sự" button opens a form (modal or inline row) with fields: `display_name`, `agent_type` (select: sub/helper — never let UI create a second `main`), `engine` (select: claude/codex/antigravity), `role_description` (textarea), permission checkboxes (the fixed allow-list from phase 1), `parent_agent_id` (select from existing agents, for reporting-line context). Submits via `kadApi.agents.create(...)`.
3. "Sửa" on each roster row opens the same form pre-filled, submits via `kadApi.agents.update(id, ...)`.
4. "Xóa" on each roster row calls `kadApi.agents.archive(id)` after a confirm step (this is destructive-feeling even though it's a soft delete — use the existing `KadButton` "danger"/warning variant if one exists, check `primitives.tsx`). Disable/hide this action for `agent_type='main'` rows (matches phase 1's server-side guard — client-side hide is UX, server-side reject is the real guard).
5. `OrgChartEditor`: add an "Thêm node" button appending a blank row (`{id: <temp>, parent_id: null, name: "", node_type: "position", lead_name: null, mission: null, sort_order: nodes.length}`) and a per-row "Xóa" button removing that row from the `nodes` array — both operate on local state only until "Lưu" is clicked (existing save button, unchanged).
6. Delete-with-children guard: before removing a node, check `nodes.some(n => n.parent_id === targetId)` — if true, block with a toast ("Xóa node con trước") rather than silently orphaning.

## Architecture
- Keep the personnel panel and the org chart editor as two clearly separated sub-components within `ToChucTab.tsx` (or split into `PersonnelRoster.tsx` + keep `OrgChartEditor` where it is, if the file would exceed ~200 LOC after additions — check line count once drafted, per repo modularization convention).
- Reuse existing primitives (`KadButton`, `KadCard`, `KadInput`, `KadSkeleton` from `components/primitives.tsx`) and `useKadToast()` — do not introduce a new modal/dialog library; check what `components/` already offers for a modal (search for existing drawer/dialog patterns like `PeekDrawer`) before adding one.

## Related Code Files
- Modify: `client/src/kad/pages/DoiNgu/ToChucTab.tsx`.
- Possibly create: `client/src/kad/pages/DoiNgu/PersonnelRoster.tsx` (if split needed), `client/src/kad/components/PersonnelForm.tsx` (shared add/edit form component).
- Depends on client functions from phase 1: `kadApi.agents.create/update/archive` in `client/src/kad/api-client.ts`.

## Implementation Steps
1. Confirm phase 1's `api-client.ts` additions exist and match expected signatures.
2. Build the personnel roster list UI (read-only first, verify render against real seeded agents).
3. Add the create/edit form, wire submit handlers, verify optimistic or refetch-after-save behavior (check existing pattern elsewhere in this file — org chart editor refetches via `setNodes(saved)` after save; match that).
4. Add archive action + confirm step.
5. Add org-chart add/delete node buttons + the delete-with-children guard.
6. Manual verification in the running dev server (port 4820, `.claude/worktrees/kad-phase-05-learning`) — add a person, edit permissions, archive, add/delete an org node, reload page, confirm persistence.
7. `npm run test:client` — check whether `client/src/pages/__tests__/screens.snapshot.test.tsx` covers this route; if it snapshots `/doi-ngu`, regenerate baseline deliberately (`cd client && npx vitest run -u`) and review the diff, per repo `CLAUDE.md` testing policy — never blind-update.

## Todo List
- [ ] Personnel roster read-only list
- [ ] Add/edit form with permission checkboxes
- [ ] Archive action (main-agent hidden)
- [ ] Org chart add-node button
- [ ] Org chart delete-node button + children guard
- [ ] Manual browser verification
- [ ] `npm run test:client` green (snapshot reviewed if touched)

## Success Criteria
- Can add a new "Nhân sự số", assign permissions, see it appear in the roster and (if `agent_type='sub'`) in the hub-and-spoke chart above.
- Can archive a non-main agent; it disappears from the default roster view and from the chart.
- Can add and delete org chart nodes and have the change survive a page reload.
- No regression to the existing read-only hub-and-spoke visualization or the `WorkflowSection`.

## Risk Assessment
- Deleting an org-chart node that's referenced as a `parent_id` elsewhere and NOT guarding it would silently orphan children on the next `replaceOrgChart` call — must implement the guard in Requirements #6.
- Archiving an agent that has in-flight tasks assigned isn't blocked anywhere in this phase — acceptable for now (matches "soft delete keeps audit trail" decision) but worth a one-line note in the phase-2 completion report if it comes up.

## Security Considerations
- Client-side hiding of the "archive main agent" action is UX only — rely on phase 1's server-side rejection as the real control.

## Next Steps
- Phase 3 (JD & Van Hoa CRUD) and phase 4 (xlsx import) can start once this phase's roster CRUD is verified, since JD editing needs a real agent-update endpoint (delivered in phase 1, exercised here).
