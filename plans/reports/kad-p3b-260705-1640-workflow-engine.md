# KAD Phase 3B — Workflow Engine + QC Gate B + Auto-Approve + Sensitive L2

Branch: `kad/phase-03b-workflow`. Status: implemented + verified. Not committed (shared checkout w/ parallel session — see Open items).

## Delivered (phase-03 items 2,3,4,5,8)

New files:
- `server/lib/kad/sensitive.js` — deterministic 3-dim scanner (metrics/people/brand). Precise: catches %/currency/KPI + people-fullname + banned brand claims; ignores structural nums ("8 buổi"). Unit 9/9.
- `server/lib/kad/workflow-engine.js` — the engine. syncStep (state-derived workflow_step), requiresFullQR + assertQualityGate (QC gate B), assertStepOrder (framework→syllabus→materials), autoApprovalFor (spec 01 §4.2), outputTypeForAgent (delegation artifact-type map), onArtifactSaved (sensitive→auto→step orchestration).

Wired:
- `internal.js` — save-artifact→onArtifactSaved; request-approval + present-report QC gate; create-delegation order gate; new POST /flag-sensitivity (reviewer only).
- `orchestrator.js` — turn-end classification counts only new reviewer≠'system' approvals (auto-approvals never park); mcpToolsFor exposes kad_flag_sensitivity; runDelegation types artifacts + loads template per workflow step.
- `approvals.js` route — on approve flip artifact→approved (durable fact engine reads); syncStep.
- `tasks.js` report/decide — syncStep (handoff).
- `mcp/kad-tools-server.mjs` — register kad_flag_sensitivity (13 tools).
- `scripts/kad-verify.mjs` — S3 (31 INFRA checks + engine leg).

## Key design decisions

- **Gates scoped to workflow-bound tasks** (`tasks.workflow_id` set). Freeform tasks = agent-driven, untouched (S1/S2 keep exact behavior). Verified no-op 5/5.
- **Server-enforced, agent stays conductor**: Main Agent still delegates; engine constrains/sequences/auto-decides at the MCP internal-API boundary (agent can't self-gate — same rationale as approval-blocking, spec 04 §2).
- **Sensitive precedes auto**: a sensitive artifact blocks (human) before any auto path. reviewer='system' auto records carry decision_reason='auto: parent approved (…)' / 'auto: internal step'.
- **Auto-approve = real parent check**: slide_outline iff approved syllabus artifact; video_script iff approved lesson_plan; wrong condition → human (verified S3.8).

## Verification (all green)

- `node scripts/kad-verify.mjs --s3` → 31/31 (full course through step machine + QC gate B + auto-approve records + order gate + 1 sensitive blocked, 2 paths). Engine leg (live full course) reported not-run by default (cost/time; enable KAD_LIVE_S3=1).
- `npm run test:server` → 543/543.
- Freeform no-op → 5/5. Sensitive scanner → 9/9.
- `node scripts/kad-verify.mjs` (S1) → real `claude` engine legs PASS (auth blocker resolved; my turn-classification change handled a real turn correctly). Only prior "12 tools" assert updated → 13.

## DoD mapping

- "chạy 1 khoá nhỏ thật qua đủ gate" → S3 drives plan→research→framework(QR)→syllabus(QR)→materials→handoff via the REAL engine/internal API (anti-mock: same code path a live claude hits; only model text simulated).
- "auto-approve đúng điều kiện" → S3.6/16/17/18 (records + reasons) + S3.8 wrong-condition rejected.
- "1 case sensitive bị chặn" → S3.19 (server scan) + S3.20 (kad_flag_sensitivity layer 1).

## Open items / unresolved questions

1. **Shared checkout collision**: a parallel session (P3A) writes `server/lib/kad/prompts/sub-*.md` + an audit report into the SAME working tree and reverted my `tasks.js` edit once (re-applied). My `tasks.js` syncStep line is engine logic — must survive. Recommend committing to lock it; coordinate tasks.js ownership.
2. **Not committed** (policy: commit only when asked). Working tree has my P3B + parallel-track prep + P3A untracked files mixed. Needs user to commit/reconcile.
3. **Branch base**: created from Phase-2 tip (kad/phase-02c-giao-viec), NOT stale kad/main (which lacks Phase 2c + prep). Rebase onto kad/main later if desired.
4. **Live full-course demo** not auto-run (cost ~1.3-1.7M tokens/turn × many turns × 6 agents). Auth works; enable via KAD_LIVE_S3=1 + TAVILY_API_KEY, or run through UI.
5. Sub-agent activation (seed) overlaps P3A's "activate 6 agents"; rich prompt packs are P3A's (untracked sub-*.md now present).
