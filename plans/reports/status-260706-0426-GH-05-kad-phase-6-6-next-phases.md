# KAD Phase 6.6 status + next-phase execution prompts

Env: bare repo root is frozen snapshot. Real state lives in `.claude/worktrees/kad-phase-06_6-lark-2way` (branch `kad/phase-06_6-lark-2way`). Node ABI: use `/opt/homebrew/bin/node` (ABI 141) — `/usr/local/bin/node` binding mismatches (ABI 137 required by that binary, installed module compiled for 141). See memory `kad-node-abi-mismatch`.

## Phase 6.6 — current state: code complete, NOT committed, NOT merged

Branch base: right after Phase 6.5 merge (`0b4cf25`). Branch is **1 commit behind `kad/main`** — missing `a4ad335` (the cross-tenant/auth-bypass/data-loss audit-fix commit from phase 1-6.5 review). Must merge/rebase that in before finalizing.

### What exists (uncommitted, 13 dirty files)
New:
- `server/lib/kad/lark-adapter.js` (545 loc) — core adapter: incoming message/event/action handling, owner-gate, card rendering.
- `server/lib/kad/lark-client.js` (87 loc) — fetch-only Lark Open Platform client (tenant token cache, send message/card). No SDK dependency.
- `server/routes/kad/lark.js` (51 loc) — `/api/kad/lark/{messages,events,card-action}`, token-gated, `url_verification` echo supported.
- `server/lib/kad/auth.js` (86 loc) — shared channel-actor resolution; owner-only gate via `KAD_LARK_OWNER_OPEN_ID`, timing-safe token compare (`timingSafeEqual`).
- `server/__tests__/kad-lark.test.js` (290 loc).
- `scripts/kad-lark-long-connection.mjs` (87 loc) — **stub**: exits 2 with a clear message if `@larksuiteoapi/node-sdk` isn't installed; deliberately not added to `package.json` (doc: "requires owner approval").
- `docs/KAD-LARK.md` — env vars, ingress routes, long-connection note. Untracked, not on any branch yet.

Modified:
- `server/routes/kad/{tasks,approvals,internal}.js`, `server/routes/kad/index.js`, `server/lib/kad/repo/tasks.js`, `scripts/kad-verify.mjs` (+195 loc, adds `S6.6` scenario). 249 insertions / 14 deletions total.
- New task fields `channel_context_ref`/`channel_chat_type` flow into audit `details` JSON only — **no DB column, no migration** (correct call, matches migration-safe-only rule).

### Verified this session
- `npm run test:server` (homebrew node): **551/551 pass**, 0 fail.
- `node scripts/kad-verify.mjs --s6_6`: **7/7 pass** (owner-token gate, non-owner 403+audit, task creation via Lark DM, card-action, webhook registry).
- No client files touched, no `mcp/` files touched, no new npm dependency added. `package.json` confirmed clean of `@larksuiteoapi/node-sdk`.
- Design: owner-only writes (`isOwnerOpenId`), non-owner actions 403 + `audit_log` row with `channel='lark'`, ingress token required on all three routes, `card-action`/`events` share the same gate.

### Not done
1. Nothing committed — 13 dirty files sitting in the worktree.
2. Branch behind `kad/main` by 1 commit (`a4ad335`).
3. Long-connection worker is inert until `@larksuiteoapi/node-sdk` gets explicit owner approval + `npm install` — until then, no real inbound Lark messages flow (adapter routes are ready, nothing calls them in production).
4. Not merged into `kad/main`, not pushed anywhere (matches rest of KAD: 33+ commits local-only).
5. `--s6` / `--s6_5` regression legs not re-run against this diff (routes/index.js and internal.js touched — worth confirming no regression).

## Next-phase execution prompts

Two ready-to-paste prompts. Run **A** first (closes out 6.6), then **B** (backlog carried over from the phase 1-6.5 audit — `review-260705-2301-GH-05-kad-all-phases-audit.md`). Both assume work happens in `.claude/worktrees/kad-phase-06_6-lark-2way` (A) then `kad/main`'s worktree (B), never the bare repo root, and `/opt/homebrew/bin/node` on PATH.

---

### Prompt A — Finish & merge Phase 6.6

```
Work context: /Users/macintoshhd/AI Agent/AI Agent Workspace/Claude-Code-Agent-Monitor/.claude/worktrees/kad-phase-06_6-lark-2way (branch kad/phase-06_6-lark-2way)
Reports: /Users/macintoshhd/AI Agent/AI Agent Workspace/Claude-Code-Agent-Monitor/plans/reports/
Do NOT operate in the bare repo root — it is a frozen snapshot.
Node: put /opt/homebrew/bin first on PATH before running any test/verify command (better-sqlite3 ABI 141). If you hit NODE_MODULE_VERSION errors, run `npm rebuild better-sqlite3` under whichever node is actually on PATH — do not hardcode a binary path into scripts.

1. Merge kad/main's tip (a4ad335, "fix(kad): close cross-tenant, auth-bypass and data-loss gaps found in phase 1-6.5 audit") into this branch. Resolve conflicts if any — none expected (disjoint files).
2. Commit the current working tree (13 dirty files: lark-adapter.js, lark-client.js, routes/kad/lark.js, auth.js, kad-lark.test.js, kad-lark-long-connection.mjs, docs/KAD-LARK.md, plus modified tasks.js/approvals.js/internal.js/index.js/repo/tasks.js/kad-verify.mjs). Conventional commit, e.g. "feat(kad): Phase 6.6 — Lark 2-way adapter (owner-gated, no SDK dependency)".
3. Run full verification: `npm run test:server` (expect 551+/551), `node scripts/kad-verify.mjs --s6_6` (expect 7/7), then regression legs `node scripts/kad-verify.mjs --s6` and `--s6_5` (routes/index.js + internal.js were touched — confirm no regression in connectors/automation).
4. Merge kad/phase-06_6-lark-2way into kad/main as a merge commit (matches existing repo pattern — see `git log --graph`, every phase is merged, not rebased/squashed).
5. Decision needed from the human owner, do not decide unilaterally: install `@larksuiteoapi/node-sdk` now to make scripts/kad-lark-long-connection.mjs actually work, or leave it as a documented stub for a later phase? If approved: npm install it, verify scripts/kad-lark-long-connection.mjs runs (needs real KAD_LARK_APP_ID/SECRET, out of scope to fully test without a real Lark app), re-run test:server. If deferred: leave as-is, confirm docs/KAD-LARK.md's wording still matches reality.
6. Confirm docs/KAD-LARK.md is accurate post-merge (env vars, routes, owner-gate behavior) and note any new env vars in the appropriate project doc per this repo's docs-markdown rule.

Report back: DONE / DONE_WITH_CONCERNS / BLOCKED with verify numbers and the SDK decision made.
```

---

### Prompt B — Phase 7: hardening backlog (carried over from phase 1–6.5 audit)

Source: `plans/reports/review-260705-2301-GH-05-kad-all-phases-audit.md`. These are the Important-severity items deliberately left unfixed pending product decisions or scoped follow-up work — not new scope.

```
Work context: /Users/macintoshhd/AI Agent/AI Agent Workspace/Claude-Code-Agent-Monitor/.claude/worktrees/kad-main-integration (branch kad/main, after Phase 6.6 is merged per Prompt A)
Reports: /Users/macintoshhd/AI Agent/AI Agent Workspace/Claude-Code-Agent-Monitor/plans/reports/
Do NOT operate in the bare repo root. Node: /opt/homebrew/bin first on PATH.

Two items need a human product decision BEFORE code — surface them first, don't guess:
- Multi-org support: is it an actual supported deployment mode, or single-org by design? Gates whether server/routes/kad/knowledge.js's missing org/department ownership checks are a live cross-tenant leak (fix now) or dead code (defer).
- Skip-flood semantics: for automation rules, is done → needs_changes → done a real expected task lifecycle? Determines whether a permanently-skipped automation rule (skipped_maxfires/skipped_budget/skipped_cooldown/blocked_loop never advancing last_fired_at) needs a hard fix now or can wait.

Once those two are answered, execute in this order:
1. If multi-org is real: add org/department ownership checks to server/routes/kad/knowledge.js (org-context/org-chart/templates routes currently allow any caller to read/write any org's data).
2. Move server/lib/kad/learning-loop.js's analyzeLearningNote off the synchronous HTTP handler (called directly from server/routes/kad/approvals.js) onto the durable job queue used by every other long-running KAD action — a server restart mid-analysis currently loses it permanently.
3. Add test coverage for server/routes/kad/connectors.js (publish gate, cooldown, SSRF hostname blocklist, secret handling) — currently zero coverage on the highest-risk file in the codebase (live cross-department publish + secrets).
4. If skip-flood is a real problem: fix the automation scheduler so skip outcomes advance last_fired_at (or an equivalent "occurrence consumed" signal) before enabling max_fires/budget limits on any real rule.
5. Fix client/src/kad wizard draft-resume: ToChucTab/wizard never calls GET /wizard/draft on mount, so a saved draft is silently lost on refresh.
6. Run node scripts/kad-verify.mjs --s4, --s6, --s6_5 at least once (not run in the last full audit pass) given connector/automation code paths changed since.

Minor/cosmetic items from the same audit (non-unique runId in learning-loop, console-log-only failure visibility, AutomationRuleForm's hardcoded metric_dropdown mismatch, dangerouslySetInnerHTML in KetNoi.tsx) are lower priority — pick up opportunistically, don't block on them.

Report back per item: DONE / DONE_WITH_CONCERNS / BLOCKED. Flag anything that surfaces a new product decision rather than guessing.
```

## Unresolved questions
1. `@larksuiteoapi/node-sdk` — approve now (Prompt A step 5) or defer to a later phase?
2. Multi-org support — real deployment mode or single-org by design? (blocks Prompt B step 1)
3. Skip-flood semantics — is `done → needs_changes → done` an expected lifecycle? (blocks Prompt B step 4)
4. Push `kad/main` to `origin` at any point in this sequence, or keep fully local for now? (carried over from prior audit, still unanswered)
