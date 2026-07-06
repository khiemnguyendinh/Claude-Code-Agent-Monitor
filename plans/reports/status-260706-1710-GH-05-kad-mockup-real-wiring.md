# KAD — wire mockup screens to real data (Tổng quan + notifications)

Goal: "make KAD work for real like the finalized mockup." Method: audit what's still mock-overlay
vs real `/api/kad/*`, then execute the honest wire-ups. Work done in the repo ROOT checkout
(branch `kad/phase-05-learning`), which holds the coherent feature WIP and is the session cwd.

## Gap analysis (3 parallel read-only audits)

- Backend is ~91% complete, **zero stubs**, all repos implemented. The gap is almost entirely
  **frontend still reading `mockData.ts`** where a real endpoint already exists.
- Store header was stale: `goals`/`notifications` were listed as mock but are (now) real.
- Store mock slices with a UI consumer: `notifications` (Topbar bell). `tasks`/`automationRules`
  store slices are **vestigial** (no renderer — real screens call `kadApi` directly).
- Tổng quan (landing page) had 4/7 blocks on mock: Projects, OpsMetrics, RecentArtifacts, Exceptions.

## Executed this session (all verified)

### Notifications real (Topbar bell, every screen)
- `api-client.ts`: `NotificationRow` + `toNotification` + `kadApi.notifications.{list,markRead}`.
- `store.tsx`: fetch on mount (dept-scoped), **live refetch on WS `kad.notification`**, real
  per-row `markRead` (optimistic + reconcile). Was purely in-memory `NOTIFICATIONS` mock.

### Tổng quan — 4 blocks now real
- **Dự án & hạng mục** ← `GET /tasks` (active tasks; honest task-level status/assignee/due; row
  opens real `/cong-viec/:id`; expand → task's real artifacts). Mock precomputed per-step
  pipelines real tasks don't carry, so not fabricated.
- **3 chỉ số vận hành** ← `GET /reports/metrics` (NEW).
- **Đã xong gần đây** ← `GET /artifacts` (approved/published, time-window filtered).
- **Exception** ← `GET /exceptions` (NEW). Removed the mock `window.alert` connector stub.
- Each block owns its fetch with loading/empty/error states (one failure degrades one card).

### Two NEW backend endpoints (subagent, no-fabrication rule, 13 dedicated tests)
- `GET /api/kad/exceptions` — real aggregation: failed runs, SLA-breached approvals, unread
  budget warnings, stuck delegations. **Omitted `connector_error`** (no code ever writes the
  connector tables — would be an eternal `[]` disguised as real).
- `GET /api/kad/reports/metrics` — 3 real 14-day series: tasks done (`tasks.completed_at`),
  run cost (`task_runs.tokens_used` priced via existing `cost.js`), QC pass-rate (approval
  approved-ratio, since `artifacts.quality_score` has no writer anywhere). Returns fewer/no
  cards rather than inventing a series.
- Files: `server/routes/kad/misc.js`, new `server/lib/kad/repo/reports.js`, repo barrel.

## Verification
- Client typecheck (`tsc --noEmit`): **clean**.
- Client tests: **245/245** (run under node v24 — v25's experimental native `localStorage`
  clashes with jsdom and fails ~11 unrelated Tabby/Dashboard tests; a pre-existing env issue,
  documented in the phase-1–6.5 audit).
- Server tests: **590/590** (node v25 / better-sqlite3 ABI 141), incl. the 13 new endpoint tests.
- KAD screens are not in `screens.snapshot.test.tsx` (monitor pages only) — no snapshot churn.

## Deliberately deferred (flagged, NOT fabricated — need a product/data-model decision)
- **Báo cáo (BaoCao.tsx)** full per-agent cost ledger + `GET /agents/:id/stats` — needs a real
  cost/throughput aggregation surface + decision on what the report shows.
- **Đội ngũ ▸ Mục tiêu tab** OKR/KPI (`OBJECTIVES`/`KPIS`) — no table; overlaps with real `goals`.
- **Đội ngũ ▸ Kiểm soát tab** approval-matrix + department-policies — audit already flagged there
  is no `department_policies` table (Phase 4 finding #4). Needs the multi-org / policy decision.
- Pre-existing **workflow-board WIP** (KanbanBoard workflow view + WorkflowRunCard/Peek + preview
  modal): coherent, typechecks, card→`workflow-run` peek is wired. Left as-is (not this session's).

## Unresolved questions / decisions for the owner
1. **Split-brain checkout**: `:4820` (launchd service) serves the *linked worktree*
   `.claude/worktrees/kad-phase-05-learning`; this session's work is in the *root* checkout of the
   same branch. Both are dirty & divergent. To see it live, reconcile (stop the launchd service and
   run root `npm run dev`, or sync). Not resolved unilaterally.
2. **Commit?** Left uncommitted per repo rule ("commit only when the user asks"), consistent with
   the branch's existing local WIP.
3. BaoCao / OKR-KPI / policies — build now or keep deferred pending the data-model decision?
