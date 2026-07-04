# KAD v2 Phase 1 — Adversarial review disposition

Source: workflow `kad-phase1-review` (34 agents, 6 dimensions → find → adversarial verify). 28 raw → 23 CONFIRMED. Below: disposition each. All FIXED items re-verified (`kad-verify` 28/0, monitor 535/0).

## Fixed (real defects)

| # | File:line | Defect | Fix |
|---|-----------|--------|-----|
| 1 | orchestrator turn-end | `createdApproval` used pending-presence → misclassify 'completed' if human decides between count & latestPending reads (deadlock) | Classify by approval COUNT DELTA (`approvalsAfter>approvalsBefore`), not pending presence |
| 2 | orchestrator resume dedup | `resume:${task}` shared by approval-decided + delegation-done → 1 dropped | Resume turn declares state summary NGUỒN SỰ THẬT; single coalesced resume re-derives all from DB → no lost wakeup (comment + message hardened) |
| 3 | orchestrator run/task atomicity | createRun + task→doing + audit split → crash leaves 'pending' run vs 'doing' task | createRun+updateRun(running)+updateTask+audit in ONE tx |
| 4 | orchestrator waiting_approval/completed/failed | updateRun + audit not same tx (spec 03 §3) | Wrapped each branch in tx |
| 5 | orchestrator writeMcpConfig | KAD_INTERNAL_TOKEN plaintext on disk, never cleaned (credential leak) | File 0600 + dir 0700 + `cleanupRunDir()` in finally after every turn + boot sweep in reconcile |
| 6 | orchestrator reconcileRuns | orphan run→failed but task left stuck 'doing' | Also reset stuck 'doing' task → waiting_human + audit; sweep leftover run dirs |
| 7 | internal.js delegation-result | no run-context validation (cross-task peek) | ctx() + ownership check (delegation.task_id===ctx.task.id) |
| 8 | internal.js ctx() | agent not re-checked active / same-dept | ctx() rejects non-active agent + cross-dept id |
| 9 | internal-auth.js | token compared with === (timing) | `crypto.timingSafeEqual` constant-time |
| 10 | guardrails.trip | notification outside try → failure masks park | notification/emit wrapped try/catch after durable park+audit |
| 11 | runs.updateRun | waiting_approval (turn terminal) didn't set completed_at | added to completed_at branch |
| 12 | tasks.createTask | dead ternary actor_type (both branches 'human') | simplified to 'human' + comment |
| 13 | jobs.enqueue | dedup UNIQUE race could crash | try/catch → return existing winner |
| 14 | job-queue handlers | malformed payload → retry storm | PermanentJobError for missing ids → immediate fail |
| 15 | claude-cli watchdog | SIGKILL abrupt | SIGTERM→(5s)→SIGKILL + comment: watchdog ≠ budget breaker, safe under turn-based |

## Won't-fix (intended / not a defect) — with rationale

- **FK not enforced (migration):** intended MVP — monitor also runs FK off; FK clauses are documentation. Repo layer wraps access; Postgres swap later. Documented in `migrate.js`.
- **max_delegations_per_task counts all statuses (delegations.countByTask):** intended LIFETIME runaway breaker, not concurrent count; retries reuse same row (no inflation). Default 8 ≥ full pipeline (7 delegations).
- **web-search sends API key to Tavily:** that IS the provider's auth mechanism; key in env is standard. Per-agent rate-limit deferred (not Phase 1).
- **"guardrail check() + createRun race" / "enqueue dedup race" (multi-thread reasoning):** false under Node single-thread + synchronous better-sqlite3 — no `await` between check and insert, so no interleaving. Added defensive tx/try-catch anyway (items 3, 13) for belt-and-braces.
- **internal token no persistent log:** ephemeral per-process secret by design (regenerated each boot); logging it would be worse.

## Verification after fixes
- `node scripts/kad-verify.mjs` S1: **28/28 infra PASS** (added crash-recovery task-reset assert). Engine legs still BLOCKED (auth).
- monitor `--test`: **535/535 PASS**.

## Unresolved questions
- Auth credential for live claude spawn (task #11) — gates engine legs + spike + demo. Need `claude login` or `ANTHROPIC_API_KEY` (+ `TAVILY_API_KEY` for web search).
