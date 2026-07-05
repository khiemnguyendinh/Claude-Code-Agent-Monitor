# KAD Phase 3B — Workflow Engine + QC Gate B + Auto-Approval + Sensitive L2

Branch: `kad/phase-03b-workflow` (from Phase-2 tip incl. P3B-prep — NOT stale kad/main).
Owner: single session (only session touching workflow/engine in Wave 2).
Scope: phase-03 items 2,3,4,5,8. NOT item 1 rich prompt-packs (P3A), 9 DAG (P3C), 10 eval.

## Design (server-enforced gates, agent stays conductor)

Engine = server-side coordinator. Main Agent still delegates via `kad_create_delegation`;
engine CONSTRAINS + SEQUENCES + auto-decides at the internal-API tool boundaries.
All new gates scope to **workflow-bound tasks** (`tasks.workflow_id` set) → S1/S2 freeform
tasks keep old behavior; the DoD course task carries `workflow_id=wf-rd-standard-flow`.

FK enforcement is ON (db.js:127) — every approval/artifact insert must have valid referents.

### New files
- `server/lib/kad/sensitive.js` — deterministic keyword scanner → `{sensitive, subtype, hits}`.
  metrics (currency/%/KPI, avoids bare "8 buổi"), people (title+Name), brand (claim terms).
- `server/lib/kad/workflow-engine.js` — step resolve/advance (`syncStep`), QC-gate predicate
  (`requiresFullQR`), auto-approval decision (`autoApprovalFor`), order gate (`assertStepOrder`),
  and `onArtifactSaved` orchestration used by internal.js.

### Behaviors
1. **Workflow step** — `syncStep(task)` derives step from state (plan→research→framework→
   syllabus→materials→handoff) + persists `tasks.workflow_step`, emits `kad.workflow.step`.
   Called after artifact save + approval decide + report decide.
2. **QC gate B** — full QR required iff artifact_type ∈ blueprint.gates.quality_required_for
   (program_framework, syllabus) OR sensitive. Enforced at `kad_request_approval`(artifact) +
   `kad_present_report`: block (EQRREQUIRED) unless a passing `quality_report` (parent=artifact,
   verdict ĐẠT) exists. Internal steps (lesson/slide/video) → light QC, no full QR run.
   quality_report never re-reviewed.
3. **Auto-approval** (§4.2, check real parent approval in DB, record reviewer='system'):
   - slide_outline: auto iff approved `syllabus` artifact exists → decision_reason='auto: parent approved (syllabus)'
   - video_script: auto iff approved `lesson_plan` artifact exists → 'auto: parent approved (lesson_plan)'
   - research_report/lesson_plan/other internal → internal_auto (always)
   - framework/syllabus/handoff → NEVER auto (human)
   - condition NOT met (slide before syllabus approved) → NOT auto → stays draft (human).
4. **Sensitive L2** — server scan on every workflow artifact save; QR flags (layer1) merge.
   Trigger → `sensitive_content` approval + subtype (pending, human) → blocks.
5. **kad_flag_sensitivity** — new MCP tool + internal endpoint (reviewer only): writes
   `metadata.sensitivity_flags` onto target artifact (layer 1).

### Modified
- `internal.js`: save-artifact hook, request-approval QC gate, create-delegation order gate,
  present-report QC gate, + POST /flag-sensitivity.
- `orchestrator.js`: turn classification counts only reviewer!='system' new approvals
  (system auto-approvals never park); mcpToolsFor adds kad_flag_sensitivity for reviewer.
- `approvals.js` route + `tasks.js` report/decide: call `workflowEngine.syncStep`.
- `mcp/kad-tools-server.mjs`: register kad_flag_sensitivity.
- `scripts/kad-seed.mjs`: 6 agents already active (prep). No further change needed.
- `scripts/kad-verify.mjs`: S3 (INFRA legs deterministic via internal API; ENGINE leg BLOCKED on 401).

## DoD
- S3 INFRA: full course drives step machine + QC gate + auto-approve records (system,
  correct decision_reason) + 1 sensitive artifact blocked. Assert real SQL.
- ENGINE leg reported BLOCKED (no standalone `claude` credential — env auth 401).

## Deviations / open questions
- Branched from Phase-2 tip, not kad/main (Phase 2c + prep unmerged to kad/main).
- Sub-agent activation (seed) overlaps P3A's "activate 6 agents"; rich prompt packs left to P3A.
- Live full-course demo blocked by `claude` 401 (env). INFRA legs prove engine code for real.
