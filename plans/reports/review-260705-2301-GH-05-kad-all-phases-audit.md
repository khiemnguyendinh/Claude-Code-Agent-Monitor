# KAD full-stack audit — phases 1 through 6.5 (6.6 not implemented)

Scope: `/code-review` + `/ck:security-scan` + `/ck:test` chain requested across ALL KAD phases (1, 2a, 2b, 2c, 3a, 3b, 3c, 4, 5, 6, 6.5, 6.6). Env note: repo root is a bare checkout with a stale/frozen snapshot — all real work done in `.claude/worktrees/kad-main-integration` (branch `kad/main`, the tip merging every phase through 6.5). `kad/main` has never been merged to `master` and has never been pushed to `origin` (33 commits ahead of `master`, no `origin/kad/main` ref) — this is 100% local WIP.

## Phase 6.6 — does not exist

No branch, no commit, nothing in `kad-verify.mjs`. Not reviewable. If planned, needs a plan file first.

## Already reviewed + fixed in prior sessions (not re-litigated)

- **Phase 1** — 23 confirmed defects, all fixed + re-verified (`kad-verify` 28/0, monitor 535/0). See `review-260704-2239-kad-phase1-adversarial-review.md`.
- **Phase 2a/2b/2c** — 14 fixed (6 backend, 8 frontend), 3 backend items deferred as product decisions (FK cascade policy, repo-wide error handler, WS-reconnect contract). See `audit-260705-1642-kad-phase2-audit-fix.md`.
- **Phase 3B** (workflow engine, QC gate B, auto-approve, sensitive flagging) — delivered + verified, S3 31/31. See `kad-p3b-260705-1640-workflow-engine.md`.

## New review this pass — Phase 3a, 3c, 4, 5, 6, 6.5

9 parallel adversarial reviewers (backend/frontend/mcp-reviewer subagents), each scoped to one phase's actual diff (`git show <commit>`), briefed on this codebase's established bug patterns from the phase 1/2/3B reports so severity judgments stay consistent. Two independent reviewers (backend + mcp-reviewer) converged on the same Phase 6 Critical finding from different angles — real adversarial confirmation, not duplication.

### Phase 3a (agent roster activation) — clean
Just flips 6 sub-agents `inactive→active` + adds prompt packs. No logic risk. No findings.

### Phase 3c (dependency DAG worker)
| # | Sev | Issue | Status |
|---|-----|-------|--------|
| 1 | Important | Manual dependency-release route (`dependencies.js`) mutated dep+task status with no transaction and no audit row, unlike the automated worker's identical operation — crash-window inconsistency + audit gap | **FIXED** — wrapped in `repo.tx()`, added matching `dependency_released` audit row |
| 2 | Minor | Worker's WS emit happens inside the tx; a future throwing emit would roll back a real release (self-healing today, no-op emit throws) | Not fixed — low priority, flagged |
| 3 | Minor | Cosmetic: released task keeps `activation:"dependency"` forever | Not fixed — cosmetic |
| 4 | Minor | `--s3-deps` verify leg never exercises the multi-dependency partial-release branch | Not fixed — test-coverage gap, flagged |

### Phase 4 (org onboarding wizard) — backend
| # | Sev | Issue | Status |
|---|-----|-------|--------|
| 1 | **Critical** | `completeWizard` resolved department by a **globally unique slug** with no org scoping. Completing the wizard a 2nd time (default slug `"rd"`) repointed and **wiped** a different org's department + agent roster | **FIXED** — scoped lookup to target org; auto-disambiguates slug on genuine cross-org collision |
| 2 | Important | `saveWizardDraft` always mints a new org, orphaning abandoned drafts | Not fixed — needs product decision (draft GC policy) |
| 3 | Important | `createDraftVersion` seeded a new org's draft from the **globally**-latest-approved context (cross-tenant data leak) | **FIXED** — scoped to target org |
| 4 | Important | `knowledge.js` routes (org-context/org-chart/templates) have **no org/department ownership checks** — any caller can read/write any org's data | Not fixed — large surface, needs a product decision on multi-org support (see unresolved questions) |
| 5 | Minor | `templates.usage()` / `listVersions()` unbounded queries | Not fixed |
| 6 | Minor | `templates.approve(id)` overloads id-meaning, no dept guard | Not fixed |

### Phase 4 — frontend
| # | Sev | Issue | Status |
|---|-----|-------|--------|
| 1 | Important | `ToChucTab.tsx` load has no `.catch` — failure renders as "empty org", not an error state (sibling tabs in same commit all got this right) | Not fixed |
| 2 | Minor | `OrgChartEditor` "Lưu" has no in-flight guard — double-click race | Not fixed |
| 3 | Important | Wizard never calls `GET /wizard/draft` on mount — "Lưu nháp" is saved server-side but a refresh always restarts the wizard from blank | Not fixed |
| 4 | Important | Zero tests anywhere under `client/src/kad` (506-line wizard + 4 rewritten tabs, all untested) | Not fixed — recommend before ship |

### Phase 5 (learning loop) — the phase this session's branch (`kad/phase-05-learning`) delivers
| # | Sev | Issue | Status |
|---|-----|-------|--------|
| 1 | **Critical** | `correction_category` from the LLM regularly fell outside the DB `CHECK` enum (the prompt's own examples were 3/4 invalid) → `createNote` threw → **every learning note was silently dropped**, the phase's headline feature was non-functional | **FIXED** — category validated/normalized with a safe fallback; prompt rewritten to the exact 8 allowed values |
| 2 | Important | `analyzeLearningNote` (a multi-minute `claude` subprocess) is fired directly from the HTTP handler, not through the durable job queue like every other long-running KAD action — a server restart mid-analysis loses it permanently | Not fixed — needs a `job-queue.js` kind, flagged as follow-up |
| 3 | Important | `adapter.run()` result's `error`/`authFail` is never checked before parsing — auth failures silently degrade to the same swallowed path as #1 | Not fixed (partially mitigated by #1's fallback normalization) |
| 4-6 | Minor | Non-unique `runId`, console-log-only failure visibility, no dept scoping on propose/approve (matches existing web-route precedent) | Not fixed |

### Phase 6 (connectors: WordPress + Facebook) — backend + MCP (2 independent reviewers, same finding)
| # | Sev | Issue | Status |
|---|-----|-------|--------|
| 1 | **Critical** | `POST /connector-publish` accepted **any** `approval_id` with no check that it belongs to the caller's task/department, and never re-checked `ensureAgentCanPublish` at execute time (only checked at draft time) — any authenticated agent could trigger a live cross-department publish by replaying an approved id | **FIXED** — `executeByApproval`/`executeAction` now assert task ownership + re-run the publish-permission check |
| 2 | Important | SSRF: WordPress `site_url` only required `https:`, hostname was never restricted (loopback/link-local/private ranges reachable, `health-check` route is unauthenticated) | **FIXED** — added a hostname blocklist (loopback/`.local`/RFC1918/link-local) |
| 3 | Minor | Schema/endpoint drift: MCP tool schema declares `content`, endpoint also silently accepts undeclared `body`/`content_to_publish` aliases; MCP layer does zero schema validation of its own | Not fixed |
| 4 | Minor | Crash-window: process death after WP POST succeeds but before `completed` write leaves an orphaned `executing` action (published-but-untracked) | Not fixed |
| 5 | Minor | New KAD-wide webhook egress: every `createNotification` now fans out to all enabled outbound webhook targets — behavior-change, not a leak, worth confirming intent | Not fixed — flagged |
| 6 | Minor | `sendConnectorError` can leak raw SQL/schema text for non-`ConnectorError` throws | Not fixed |
| — | — | `connectors.js` has **zero test coverage** despite being the highest-risk phase (publish gate, cooldown, secret handling, SSRF) | Not fixed — recommend before ship |

### Phase 6 — frontend (`KetNoi.tsx`)
Secret handling, fire-and-forget, and confirm-guard concerns explicitly checked and **clean** (all three requested focus areas ruled out with evidence). Real findings:
| # | Sev | Issue | Status |
|---|-----|-------|--------|
| 1 | Important | Load failure renders identically to "no connectors yet" (no `loadError` state, unlike `TuDongHoa.tsx`'s established pattern) | Not fixed |
| 2 | Minor | Clipboard-copy has no `.catch` — silent no-op on permission denial | Not fixed |
| 3 | Minor | Approval peek has no "open full page" case for the new `/phe-duyet/:id` route | Not fixed |

### Phase 6.5 (automation rule engine + scheduler) — backend
Adversarially checked and confirmed **clean**: guardrail failure-masking not reintroduced, `setEnabled` two-signal bug not reintroduced, migration `kad-004` is safe/forward-compatible, engine is fully synchronous (no true concurrency race), depth-limited loop guard correctly bounds cross-rule chains, malformed payloads fail permanently.
| # | Sev | Issue | Status |
|---|-----|-------|--------|
| 1 | Important | Skip outcomes (`skipped_maxfires`/`skipped_budget`/`skipped_cooldown`/`blocked_loop`) never advance `last_fired_at` → a permanently-skipped rule re-evaluates and re-records **every 2s tick forever** (notification/audit-row flood) | Not fixed — needs a design decision on what "occurrence consumed" means for a skip |
| 2 | Important | `evaluate_rules` enqueue on task-done had no `dedupKey` → two jobs could be in flight for the same task | **FIXED** — added per-task `dedupKey` |
| 3 | Minor | `cooldown_seconds: 0` (a valid, unvalidated input) disables metric edge-detection cooldown entirely | Not fixed |
| 4 | Minor | Budget gate: `daily_token_limit: 0` floods; `null` fails open (no protection) | Not fixed |
| 5 | Minor | No shape validation on `trigger_config`/`action_config` — bad `workflow_id` etc. silently no-ops at fire time | Not fixed |

### Phase 6.5 — frontend
| # | Sev | Issue | Status |
|---|-----|-------|--------|
| 1 | Important | Auto-task "Confirm & run" button (both `TraoDoiCongViec.tsx` and `TuDongHoa.tsx`) has no in-flight guard — rapid double-click can pass the server's synchronous duplicate-run check twice before the first run is recorded, spawning two agent runs for one task | Not fixed |
| 2 | Minor (cross-cutting) | `AutomationRuleForm`'s metric dropdown hardcodes `quality_pass_rate_7d`, which the Phase 6.5 server-side `evaluateMetricRules` switch doesn't recognize — likely a silent no-op rule | Not fixed — flagged for whoever owns the metric catalog |

Everything else in both frontend reviews (fire-and-forget pattern, `Promise.allSettled`, loading/error states, numeric-threshold validation) was explicitly checked against the Phase 2 precedent bugs and found correctly implemented — no regressions.

## Fixes applied this session (committed `a4ad335` on `kad/main`)

1. Phase 6: connector-publish cross-task/department authorization bypass (Critical)
2. Phase 6: SSRF — WordPress `site_url` hostname restriction (Important)
3. Phase 4: `completeWizard` cross-tenant department hijack (Critical)
4. Phase 4: `createDraftVersion` cross-tenant context-seed leak (Important)
5. Phase 5: learning-note category enum mismatch silently dropping every note (Critical)
6. Phase 3c: manual dependency-release route — transaction + audit parity with the worker (Important)
7. Phase 6.5: `evaluate_rules` enqueue dedupKey — closes the two-jobs-in-flight gap (Important)
8. `kad-verify.mjs`: stale MCP tool-count assertion (13 → 16), was giving a false pass/fail signal

All Critical and the cleanly-scoped Important findings fixed. Findings requiring a product decision (multi-org support scope, wizard-draft GC, skip-flood semantics, knowledge.js broad authorization redesign) were deliberately left as flagged recommendations, not guessed at.

## Security scan (`/ck:security-scan`)

- Secret/credential grep across all KAD server+client+scripts: **no hardcoded secrets found**. The one regex hit (`kad-verify.mjs`) is a test fixture literally named `"should-not-store"` asserting the rejection path — false positive.
- `eval`/`Function`/`exec` grep: only legitimate `child_process.spawn` (the `claude` CLI runner) and a benign regex `.exec()` — no injection surface.
- `dangerouslySetInnerHTML` in `KetNoi.tsx`: renders server/LLM-authored preview HTML; flagged by the Phase 6 frontend reviewer as a secondary, unconfirmed note (not proven exploitable, not new to this diff specifically) — worth a follow-up look, not fixed here.
- Dependency audit: root (10: 3 high/7 moderate — `ws`, `path-to-regexp`, `qs`/`express`/`body-parser`, `tar`, `uuid`), client (2 moderate — `react-router` open-redirect), mcp (8: `hono`, `fast-uri`, `ip-address`, `path-to-regexp`, `qs`). **None of these are KAD-introduced** — they're pre-existing transitive deps of the whole dashboard/MCP-SDK stack. `npm audit fix` is available but not run (could bump majors on shared, non-KAD infra — needs its own verification pass, out of scope for this KAD-focused review).

## Test verification (`/ck:test`), run in the correct `kad/main` worktree

- `node --test server/__tests__/*.test.js`: **544/544 pass** (was blocked by a Node ABI mismatch on the first attempt in the wrong directory — see below; also ran `npm rebuild better-sqlite3` to fix a second ABI flip after a pre-commit hook briefly ran under the other installed Node).
- `client`: **245/245 pass**, 0 snapshot diffs. Pre-existing nested-`<button>` DOM-nesting warning in `KanbanBoard`/`SegmentedProgress` predates this work, out of scope.
- `mcp:typecheck` + `mcp:build`: clean (after `npm install` in `mcp/` — this worktree's `node_modules` was missing `@types/node`, an environment gap, not a code issue).
- `kad-verify.mjs` (S1, live-engine leg, no flags): **61/61 pass** (was 60/61 before the tool-count fix). One leg (`S1.E2` Researcher web_search) is `BLOCKED: TAVILY_API_KEY not set` — a known, already-tracked environment gap, not a code defect.
- Deeper legs (`--s3`, `--s3-deps`, `--s4`, `--s5`, `--s6`, `--s6_5`) were **not** run this pass (each spawns multiple live Claude turns; cost/time). Recommend running at least once before any ship decision, especially `--s6`/`--s6_5` given the connector/automation fixes above.

### Environment note (important for future sessions)
The repo root (`/Users/macintoshhd/AI Agent/AI Agent Workspace/Claude-Code-Agent-Monitor`) is a **bare** repo with a stale, frozen on-disk snapshot — do not run tests, greps, or edits directly there. Always work inside the matching `.claude/worktrees/<branch>` directory. Also confirmed (again) the known two-Node-install ABI flip: whichever Node last ran `npm install`/`rebuild` on `better-sqlite3` wins; a pre-commit hook running under the "other" Node will fail server tests with `NODE_MODULE_VERSION` mismatches, or (new this session) break client tests via Node v25's experimental native `localStorage` clashing with jsdom. Fix is always `npm rebuild better-sqlite3` under whichever Node is actually on `PATH` by default, not switching `PATH` per-command.

## Ship readiness (`/ck:ship`) — NOT executed, needs your decision

`kad/main` has **never been merged to `master`** and **has no `origin/kad/main` — it has never been pushed**. This is 33 local-only commits of a large, still-WIP Vietnamese multi-agent R&D subsystem. Given that, and given several Important findings above are explicitly deferred pending product decisions (not oversights), I did not run the merge/push/PR steps of `/ck:ship`. Stopped here for your call:

1. Push `kad/main` (with this session's fix commit) to `origin` as a branch, no PR yet?
2. Open a PR from `kad/main` → `master` now, accepting the remaining Important/Minor items as tracked follow-ups?
3. Hold off entirely — keep iterating locally until more of the flagged items are resolved (particularly: knowledge.js multi-org authorization, wizard draft-resume, connector test coverage, skip-flood semantics)?

## Suggested next steps, in priority order

1. Decide the multi-org support question (Phase 4 finding #4) — it gates whether `knowledge.js`'s missing authorization is a live leak or dead code.
2. Move `analyzeLearningNote` onto the durable job queue (Phase 5 #2) — matches every other long-running KAD action's crash-safety contract.
3. Add test coverage for `connectors.js` (publish gate, cooldown, SSRF, secret handling) before this ships — currently the highest-risk file with zero tests.
4. Decide skip-flood semantics for the automation scheduler (Phase 6.5 #1) before enabling `max_fires`/budget limits in any real rule.
5. Wizard draft-resume fix (Phase 4 frontend #3) — currently loses a saved draft on every refresh.
6. Run the deeper `kad-verify.mjs` legs (`--s4`, `--s6`, `--s6_5`) at least once given the connector/automation code paths just changed.

## Unresolved questions
1. Is multi-org actually a supported deployment, or single-org by design? Determines urgency of Phase 4 finding #4.
2. Is `done → needs_changes → done` a real, expected task lifecycle? Determines whether Phase 6.5 finding #1 (skip-flood) needs a full fix now or can wait.
3. Is the new KAD-wide webhook egress from every `createNotification` (Phase 6 finding #5) intended, or an accidental coupling?
4. Push `kad/main` to `origin` now, or keep it fully local for now?
