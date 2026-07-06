# KAD Phase 2a/2b/2c audit + fix — before Phase 3

Scope: full diff introduced by phase 2 wiring (commit `2e354d5`..`fa5d6be` — Trao doi cong viec, Tong quan, Giao viec, Tu dong hoa + real attachments). Zero automated tests existed for any of `server/lib/kad`, `server/routes/kad`, `client/src/kad` before this pass.

## Method
1. `npm run test:server` (543 tests, node v24/`/usr/local/bin/node` — v25 has an ABI mismatch with the compiled better-sqlite3 binary right now) + `test:client` (245 tests) + `tsc -b --noEmit`. All green before and after — build/compile was never broken, so the real risk was runtime logic bugs with no test coverage to catch them.
2. Two adversarial code reviews (backend-reviewer over `server/lib/kad`+`server/routes/kad`, frontend-reviewer over `client/src/kad`), each with repro/line-level evidence, not style nits.
3. Fixed every concrete, no-product-decision-needed bug found. Left product-decision items as open questions (below) rather than guessing.

## Backend — 9 found, 6 fixed, 3 deferred (open questions)

| # | Issue | Fix |
|---|---|---|
| 1 | `PATCH /tasks/:id` — invalid `status`/`priority` hit the DB's `CHECK` constraint raw → uncaught 500 with a stack trace, not the API's normal `{error:{code,message}}` shape | `server/routes/kad/tasks.js` — validate against the same enum as the schema, 400 `EBADSTATUS`/`EBADPRIORITY` |
| 2 | `POST /tasks/:id/dependencies` with a nonexistent `depends_on_task_id` hit the FK constraint raw → uncaught 500 | same route — 404 `ENODEPTASK` if the referenced task doesn't exist |
| 3 | No self/cycle guard — a task could depend on itself or close A→B→A, permanently unblockable (nothing evaluates a cycle's condition true) | `server/lib/kad/repo/task-dependencies.js` — new `wouldCreateCycle()` (BFS over `waiting` edges), wired into the route as 400 `ECYCLE` |
| 4 | `report/decide` iterated `report.artifacts` with no fallback → `TypeError` if a report message ever lacked the array | `tasks.js` — `report.artifacts || []` (defensive; not reachable via the current writer, but free to close) |
| 5 | `automation_rules.setEnabled` only flipped `enabled`, never `status` — two disagreeing "is this rule live" signals for the not-yet-built evaluator | `server/lib/kad/repo/automation-rules.js` — `status` now tracks `enabled` (`active`/`paused`), never touches `archived` |
| 6 | `attachments.js` DELETE unconditionally called `fs.unlinkSync` on `storage_path`, including names-only rows whose path is a fabricated relative string never resolved through the workspace root — could theoretically unlink an unrelated file at the server's CWD | Only unlink when the row has real bytes (`mime`/`size` set — i.e. came from a real upload, not a names-only declare) |
| — | `migrate.js` doc comment claimed FKs are "documentation only" — false; the shared connection runs with `foreign_keys=ON`, every FK is a live RESTRICT constraint | Comment corrected (this is why #1/#2 were reachable at all) |
| 7 (deferred) | No `ON DELETE` clause anywhere on task-referencing FKs (dependencies/attachments/rule_fires) — a future task-delete/purge route will hit RESTRICT and can't cleanly remove a task with children | No delete route exists yet, so nothing breaks today. **Needs a product decision**: cascade the children or block+require manual cleanup first. |
| 8 (deferred) | Global error handler: an uncaught SqliteError anywhere still 500s with a raw stack trace (I only closed the two known holes with explicit validation, not a catch-all) | Deliberately skipped — a repo-wide error handler touches shared `server/index.js` infra beyond this audit's scope; flagging as a possible follow-up, not doing it opportunistically |
| 9 | Zero test coverage | Added `server/__tests__/kad-tasks-validation.test.js` — 8 tests locking in #1–3 and #5 (real HTTP requests against a fixture org/department, not mocks) |

## Frontend — 8 found, 8 fixed

| # | Issue | Fix |
|---|---|---|
| 1 | `TraoDoiCongViec.tsx` `handleDockedSend` cleared the draft + attachment chips *before* the send request, so a failed send silently lost the typed message and the reference to already-uploaded files | Snapshot draft/attachments before clearing; restore both on failure |
| 2 | `PeekContent.tsx` `ApprovalPeek.submit` showed a success toast and closed the drawer regardless of whether `decideApproval` actually succeeded (it was fire-and-forget) | `decideApproval` (store.tsx) now returns a rejecting `Promise` on failure instead of swallowing the error; `submit` awaits it, only toasts success/closes on success, shows the real error otherwise. Added a submitting-guard on all 3 buttons to stop double-submit. |
| 3 | `TongQuan.tsx` batch-approve fired N uncoordinated requests, cleared the selection regardless of outcome, no feedback on partial failure | `Promise.allSettled`, aggregate success/fail-count toast, disabled while in flight. Also had to fix the single quick-approve button (same file) since it stopped being fire-and-forget-safe once `decideApproval` started rethrowing. |
| 4 | `TuDongHoa.tsx` initial `Promise.all([...]).finally(...)` had no `.catch` — a load failure rendered the exact same empty-state copy as "genuinely nothing here" | Added `loadError` state + a visible retry banner, distinct from the real empty states |
| 5 | `TraoDoiCongViec.tsx` `stopAndSteer` set `isRunning=false` optimistically even when the cancel request failed — user could send new instructions while the original run was still live server-side | Only clears `isRunning` when the cancel actually succeeds |
| 6 | Missed WS events during a connection drop (laptop sleep, flaky wifi) were never replayed — task view could get stuck showing "đang viết…" forever after a reconnect | Subscribe to `onKadWsConnectionChange`; on reconnect (not the first connect) re-fetch task + timeline to reconcile |
| 7 | `kad.artifact.created` handler's `kadApi.artifacts.get(...)` had no `.catch` — a transient failure silently dropped that artifact from the timeline with an unhandled rejection | Added `.catch` + console.warn, matching the pattern used elsewhere in the same file |
| 8 | `AutomationRuleForm.tsx` let an empty/non-numeric threshold submit (`Number("")` coerces to `0`, which is finite) — created a rule with a nonsensical, effectively-dead condition | Explicit empty-string + `Number.isFinite` check before submit |

## Verification
- `node --test server/__tests__/*.test.js` (via `/usr/local/bin/node`): **543/543 pass** (535 pre-existing + 8 new).
- `cd client && npx vitest run`: **245/245 pass**, no snapshot changes.
- `cd client && npx tsc -b --noEmit`: clean, 0 errors.
- Live-browser check was attempted (`preview_start`) but blocked by a pre-existing environment condition unrelated to this change: another dashboard instance is already running against the same DB on this machine (dev script's own warning: "another dashboard is already running on :4820 ... shares this database"), and the preview tool's port-forward pointed at a port nothing was bound to after the dev script auto-bumped around the conflict. Did not attempt to kill the other process. Confidence for the UI fixes rests on: code review against the exact reviewer-cited failure scenarios, passing structural snapshot tests for the touched pages, and clean typecheck — not an actual click-through.

## Not fixed / out of scope
- `client/src/kad/pending-uploads.ts` — reviewer found no confirmed bug (an edge case: tab closed between stash and mount, expected given the in-memory design).
- The pre-existing nested `<button>` inside `<button>` in `client/src/pages/KanbanBoard.tsx`'s `ProjectProgressStrip` (shows as a React DOM-nesting warning in the snapshot test) predates phase 2a/2b/2c — it's not part of this diff, left untouched.

## Unresolved questions
1. RESTRICT vs CASCADE for task-referencing FKs (dependencies/attachments/rule_fires) once a task-delete route exists — needs a product decision before Phase 3 adds one.
2. Should a repo-wide Express error handler be added (converts any uncaught SqliteError to a structured 4xx/5xx) as defense-in-depth beyond the specific validations added here? Deliberately not done opportunistically.
3. Is WS-reconnect reconciliation (frontend fix #6) the intended contract, or was it meant to be deferred to a later phase? No spec reference found either way; implemented it since the alternative (task view stuck forever) seemed clearly worse.
