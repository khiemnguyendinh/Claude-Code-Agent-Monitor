# Phase 3 — JDKyNangTab real edit + VanHoaTab structured CRUD

## Context Links
- Overview: [plan.md](plan.md)
- Depends on: [phase-01-personnel-backend.md](phase-01-personnel-backend.md) (needs `kadApi.agents.update`).
- Files fully read this session: `client/src/kad/pages/DoiNgu/JDKyNangTab.tsx` (185 lines), `client/src/kad/pages/DoiNgu/VanHoaTab.tsx` (314 lines).

## Overview
- Priority: P1.
- Status: not started.
- Two files, two different gaps — this is **not symmetric**, read Key Insights before implementing either.

## Key Insights
### JDKyNangTab — genuinely fake today
- "Đề xuất sửa" (`JDKyNangTab.tsx:120-122`) does not edit JD text at all — it calls `proposeBlueprint(...)` which patches `last_ui_proposal` metadata onto the blueprint and never touches `agent.role_description`. Same for "Thêm kỹ năng" (`:133-135`) and the per-template "Bật" checkbox (`:149-158`, `checked` is **hardcoded `true`**, `readOnly`, click just fires another fake `proposeBlueprint`). All three buttons currently produce a toast and a no-op blueprint proposal — cosmetic only.
- The "Kỹ năng (prompt pack & templates)" section is actually showing **template read-access**, gated by a single blanket boolean `agent.permissions.read_templates` (`visibleTemplates = agent?.permissions.readTemplates ? templates : []`, line 51) — not a real per-template ACL and not the `agent_profiles.skills` JSON column (which is seeded as literally `'[]'` and never read anywhere in this file). Don't build a new per-template ACL join table for this (YAGNI) — the existing blanket boolean is what phase 2's permission checkboxes already expose.
- Correct scope: (a) make JD text actually editable via a real form -> `kadApi.agents.update(agent.id, {role_description})`, (b) repurpose "Kỹ năng" to mean the actual `agent.skills` string array (add/remove tag chips) via the same update call, (c) leave the templates list as **read-only reference info** (it already reflects the real `read_templates` permission, which phase 2 makes editable elsewhere) — don't reintroduce a fake toggle here.

### VanHoaTab — mostly real already, one concrete bug + one UX gap
- The draft -> approve flow (`SectionBlock`, `:236-314`) is real: "Gửi duyệt thay đổi" calls `kadApi.orgContext.createDraft(...)`, and "Duyệt bản nháp" calls `kadApi.orgContext.approve(...)` (`:192-208`) — this already is a working add/edit path for every section, including "Giá trị cốt lõi" (edited as newline-per-value in the same textarea, split back into an array by `nextData`'s `gia-tri` branch, `:107-114`). So "sửa" already works for every section, and "thêm/xóa" of an individual core value already works too (add/remove a line) — just via a crude textarea, not a dedicated add/remove UI.
- **Real bug**: `strategyText()` (`:40-48`) concatenates all 4 strategy sub-fields (goals/priorities/constraints/roadmap) with markdown headers into one displayed blob, but `nextData()`'s fallback branch (`:117`) always saves the **entire edited blob** — headers and all — into just `strategy.priorities`, silently dropping `goals`/`constraints`/`roadmap` and duplicating literal `"## Goals\n"` etc. text into the `priorities` field. Every edit to the "Chiến lược & Ưu tiên quý" section today corrupts this data. Must fix as part of this phase regardless of the broader ask.
- Scope: (a) fix the strategy section — split it into 4 separate labeled textareas (or 4 separate `SectionBlock`-style mini-sections) each patching its own `strategy.<field>`, removing the string-concat/split hack entirely, (b) upgrade "Giá trị cốt lõi" from raw-textarea-lines to an explicit add-chip/edit-chip/delete-chip UI (directly answers "thêm/sửa/xóa", better UX than "add a line").

## Requirements
1. `JDKyNangTab.tsx`: replace the JD "Đề xuất sửa" button with an inline edit mode (mirror `VanHoaTab`'s `SectionBlock` edit-toggle pattern for consistency) that calls `kadApi.agents.update(agent.id, {role_description: draft})`, then `refresh()`.
2. `JDKyNangTab.tsx`: replace "Kỹ năng" section with add/remove chip UI operating on `agent.skills` (string array), calling `kadApi.agents.update(agent.id, {skills: nextSkills})`.
3. `JDKyNangTab.tsx`: remove the fake per-template checkbox onClick (keep the checkbox as pure read-only display of `read_templates`, no click handler) — do not reintroduce a fake write path here.
4. `VanHoaTab.tsx`: fix `nextData`'s `chien-luoc` case — split the strategy section into 4 fields, each with its own `nextData` branch (`strategy.goals`, `strategy.priorities`, `strategy.constraints`, `strategy.roadmap`), matching the existing `createDraft` + approve flow per field (or per the whole strategy block — decide whether goals/priorities/constraints/roadmap each get their own "Đề xuất sửa" or share one, simplest is one edit surface with 4 labeled textareas submitted together as one draft).
5. `VanHoaTab.tsx`: "Giá trị cốt lõi" — add explicit "+ Thêm giá trị" (append empty chip, focus it) and a delete "x" per chip, still funneling through the same `createDraft` on submit (no new API needed, this is purely a UI upgrade over the existing newline-array roundtrip).
6. Preserve the existing draft/pending-approval banner behavior (`pendingChange`, `:261-265`) for every section touched.

## Architecture
- No new backend routes needed for this phase — `kadApi.agents.update` comes from phase 1, `kadApi.orgContext.createDraft`/`approve` already exist and are reused as-is.
- Match the existing edit-toggle UX pattern already established in `VanHoaTab.tsx`'s `SectionBlock` when building `JDKyNangTab.tsx`'s new edit UI, so the two tabs feel consistent.

## Related Code Files
- Modify: `client/src/kad/pages/DoiNgu/JDKyNangTab.tsx`, `client/src/kad/pages/DoiNgu/VanHoaTab.tsx`.
- No new files expected unless `VanHoaTab.tsx` exceeds ~200 LOC after the strategy-section split (314 lines already before changes — check post-change line count, extract `SectionBlock` + the new strategy-fields sub-component into a separate file if needed).

## Implementation Steps
1. `JDKyNangTab.tsx`: build the JD inline-edit form, wire to `kadApi.agents.update`, verify against a real agent in the running dev server.
2. `JDKyNangTab.tsx`: build skills chip add/remove UI, wire to the same update call.
3. `JDKyNangTab.tsx`: strip the fake onClick from the template checkbox.
4. `VanHoaTab.tsx`: split `strategyText`/`nextData`'s strategy handling into 4 real fields; verify by editing each field and confirming `organization_context_versions.data.strategy` in the DB (or via `GET /api/kad/org-context/current` after approval) has all 4 fields intact, not concatenated.
5. `VanHoaTab.tsx`: build the core-values chip add/edit/delete UI.
6. Manual verification in the running dev server for both tabs, all CRUD paths.
7. `npm run test:client`, review any snapshot diff for `/doi-ngu` deliberately (never blind-update).

## Todo List
- [ ] JD real edit form wired to `agents.update`
- [ ] Skills chip add/remove wired to `agents.update`
- [ ] Fake template checkbox onClick removed
- [ ] Strategy section split into 4 real fields (bug fixed)
- [ ] Core values chip add/edit/delete UI
- [ ] Manual browser verification both tabs
- [ ] `npm run test:client` green

## Success Criteria
- Editing an agent's JD and saving actually changes `agent_profiles.role_description` in the DB (verify via `GET /api/kad/agents/:id`).
- Adding/removing a skill chip persists in `agent_profiles.skills`.
- Editing any one of goals/priorities/constraints/roadmap no longer clobbers the other three.
- Adding/removing a core value via the new chip UI produces the same `core_values` array shape as before (no format regression for anything else reading `data.core_values`).

## Risk Assessment
- The strategy-field fix changes what `createDraft` payloads look like for that section — check nothing else (e.g. any MCP-facing prompt renderer reading `org_context.data.strategy`) assumes the old buggy shape. Grep for `strategy.priorities` usage outside this file before finalizing.

## Security Considerations
- None new — reuses existing draft/approve and `agents.update` write paths from earlier phases; no new input surface beyond what phase 1 already validates server-side.

## Next Steps
- Phase 4 (xlsx import) wires into these same edit surfaces (JD, skills, org-context fields) — having real CRUD here first means the importer can reuse these exact update calls instead of inventing a parallel write path.
