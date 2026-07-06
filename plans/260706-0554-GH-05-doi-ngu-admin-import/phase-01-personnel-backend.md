# Phase 1 — Personnel CRUD backend + xlsx lib + goals/strategy persistence

## Context Links
- Overview: [plan.md](plan.md)
- Scout findings referenced below: `server/lib/kad/repo/catalog.js` (read-only, do not add mutations here — its own file header says so), `server/lib/kad/repo/org-context.js` (existing `replaceOrgChart` bulk-replace, already sufficient for org-chart add/delete — no change needed here), `server/migrations/kad-001-init.sql` (schema).
- Work context: `.claude/worktrees/kad-phase-05-learning` (branch `kad/phase-05-learning`).

## Overview
- Priority: P0 (everything else in this plan depends on it).
- Status: not started.
- Adds: (a) write API for `agent_profiles` (create/update/archive + permissions), (b) a real xlsx dependency for phases 4-5, (c) persistent storage for `/muc-tieu-chien-luoc` goals + strategy (currently pure React state, confirmed via `client/src/kad/store.tsx:249-255` — `setGoals`/`setStrategy` only, no API call, no localStorage — lost on every refresh).

## Key Insights
- `agent_profiles.status` CHECK already includes `'active','inactive','archived'` (`kad-001-init.sql:94`) — soft-delete needs **no schema change**, just set `status='archived'`.
- `agent_profiles.permissions` is already a JSON column (`kad-001-init.sql:89`) written today only by the setup wizard's `seedBlueprintWorkflowAgents` (`org-context.js:585-657`). No route currently updates it post-seed.
- `organization_profiles` (single row, MVP single-org per `catalog.js:83-96` comment) is the natural home for the strategy markdown blob — adding 2 nullable columns there is simpler than a new single-row table.
- "Mục tiêu lớn" (goals list with metric/current/target/due/status) has no existing table — needs a new one. Do not conflate with `organization_context_versions.data.strategy` (an unrelated free-text field already used by the org-context draft/approve flow) — these are two different concepts that happen to share the Vietnamese word "chiến lược".
- Existing pattern to copy for every new mutation: `audit({...})` call (see any function in `org-context.js`) and a `db.transaction(() => {...})()` wrapper for multi-statement writes.

## Requirements
1. `POST /api/kad/agents` — create a new `agent_profiles` row (human-added "Nhân sự số", `agent_type` likely defaults to `'sub'` or `'helper'`; validate `engine` against existing CHECK values `claude|codex|antigravity`).
2. `PUT /api/kad/agents/:id` — update editable fields: `display_name`, `role_description`, `permissions` (JSON), `skills` (JSON array), `connector_access`, `status` (active/inactive only via this route — archive is separate below), `parent_agent_id`.
3. `POST /api/kad/agents/:id/archive` — soft-delete: set `status='archived'`. Reject if agent is `agent_type='main'` (never archive the single main coordinator) with a clear error.
4. All three routes call `audit()` with `action: "agent_changed"` (new action string — check `server/lib/kad/repo/db.js`'s `audit()` for whether action strings are validated/enumerated anywhere before picking the name).
5. New migration `server/migrations/kad-004-goals-persistence.sql`:
   - `ALTER TABLE organization_profiles ADD COLUMN strategy_markdown TEXT;`
   - `ALTER TABLE organization_profiles ADD COLUMN strategy_updated_at TEXT;`
   - `CREATE TABLE IF NOT EXISTS strategic_goals (id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organization_profiles(id), title TEXT NOT NULL, metric TEXT, current_value REAL, target_value REAL, due_date TEXT, status TEXT, sort_order INTEGER DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`
6. New repo file `server/lib/kad/repo/strategic-goals.js`: `listGoals(org_id)`, `replaceGoals(org_id, goals[])` (bulk replace, mirrors `org-context.js`'s `replaceOrgChart` pattern — delete-all-then-reinsert inside one transaction, simplest correct approach for a small list with no external FK references pointing at individual goal rows), `getStrategy(org_id)`, `saveStrategy(org_id, markdown)`.
7. New routes (new file `server/routes/kad/goals.js`, mounted in `server/routes/kad/index.js`): `GET /api/kad/goals` (returns `{goals, strategy_markdown, strategy_updated_at}`), `PUT /api/kad/goals` (body `{goals, strategy_markdown}`, direct write — **no approval gate**, matches the existing UI comment in `store.tsx:245-248` that this is intentionally a direct-entry field for the department head, not a proposal).
8. Add `exceljs` to root `package.json` dependencies (not `xlsx`/SheetJS — weaker write support, past prototype-pollution CVE history in that package's regex-based parser). Confirm install succeeds and is reachable from `server/lib/kad/`.
9. New repo file `server/lib/kad/personnel.js` (or extend an existing agents-focused file if one exists by the time this phase starts — recheck, `catalog.js` is explicitly read-only per its own header comment) housing `createAgent`, `updateAgent`, `archiveAgent`.

## Architecture
- Routes mount point: extend `server/routes/kad/misc.js` (already owns `GET /agents`, `GET /agents/:id`) with the 3 new mutation routes, OR split into a dedicated `server/routes/kad/agents.js` if `misc.js` would exceed ~200 LOC after the change (repo's own modularization convention). Check current `misc.js` line count before deciding.
- `goals.js` route file follows the same thin-router-calls-repo pattern as every other `server/routes/kad/*.js` file — no SQL in routes.
- Permission keys to validate against on write: the same set already seeded in `org-context.js`'s `DEFAULT_ROSTER[].permissions` (`create_task, assign_task, create_helper, read_org_context, read_templates, web_search, request_approval, write_audit, publish_connector, modify_blueprint, modify_org_context`) — reject unknown keys so a typo in the client doesn't silently create a permission that's never checked anywhere.

## Related Code Files
- Create: `server/migrations/kad-004-goals-persistence.sql`, `server/lib/kad/repo/strategic-goals.js`, `server/lib/kad/personnel.js` (or equivalent), `server/routes/kad/goals.js`.
- Modify: `server/routes/kad/misc.js` or new `server/routes/kad/agents.js`, `server/routes/kad/index.js` (mount new router), root `package.json` (`exceljs` dependency), `client/src/kad/api-client.ts` (add `kadApi.agents.create/update/archive`, `kadApi.goals.get/save` — client wiring lands here even though the UI for it is phase 2/4, so later phases don't also need to touch api-client.ts for these calls).
- Read for context: `server/lib/kad/repo/org-context.js` (pattern reference), `server/lib/kad/repo/db.js` (`audit`, `newId`, `nowIso` helpers), `server/migrations/kad-001-init.sql` (full schema).

## Implementation Steps
1. Write migration `kad-004-goals-persistence.sql`, run server once to confirm `runKadMigrations` applies it cleanly (check `kad_migrations` table gets the new row).
2. Write `strategic-goals.js` repo functions + unit-level sanity via `npm run test:server` (add tests alongside).
3. Write `personnel.js` (or chosen location) with `createAgent`/`updateAgent`/`archiveAgent`, each validating input against the CHECK constraints from the schema (agent_type, engine, status) and the known permission-key set.
4. Wire routes, mount in `index.js`.
5. `npm install exceljs` at repo root, confirm `require("exceljs")` works from a throwaway script before building on it in later phases.
6. Extend `api-client.ts` with the new typed functions (`agents.create/update/archive`, `goals.get/save`).
7. Add/extend `server/__tests__/` coverage for every new route (happy path + one validation-rejection case each + the archive-blocks-main-agent case).
8. Run `npm run test:server` — must pass in full before phase 2 starts.

## Todo List
- [ ] Migration file + verified apply
- [ ] `strategic-goals.js` repo module
- [ ] `personnel.js` (or equivalent) repo module
- [ ] Routes wired + mounted
- [ ] `exceljs` installed and smoke-tested
- [ ] `api-client.ts` functions added
- [ ] Tests added, `npm run test:server` green

## Success Criteria
- `npm run test:server` passes with new tests included.
- Manually verified via curl/REPL: create agent -> update its permissions -> archive it -> `GET /api/kad/agents` shows `status='archived'` and it's excluded from `ToChucTab`'s active roster once phase 2 filters for it.
- `GET /api/kad/goals` returns empty state cleanly on a fresh DB (no goals yet) without erroring.

## Risk Assessment
- FK risk: `agent_profiles.parent_agent_id` self-references; archiving an agent that is another agent's parent should not cascade-archive children (no such behavior exists elsewhere in KAD) — just leave the child's `parent_agent_id` pointing at an archived row and let the UI filter/display "archived" state, matching how `template_library`/`department_blueprints` handle archived-but-still-referenced rows.
- `exceljs` is a real new dependency — confirm no license/security flag before adding (MIT, no known CVEs as of last check, but re-verify at implementation time).

## Security Considerations
- Validate `permissions` keys against the known allow-list server-side (never trust client-supplied keys verbatim into the JSON column — an unknown key isn't dangerous today since nothing reads it, but it's silent data corruption if a client typo goes uncaught).
- `PUT /api/kad/goals` has no approval gate by design (matches existing UX) — this means anyone who can hit `/api/kad/goals` can rewrite company goals directly. Confirm this route sits behind whatever auth/session boundary the rest of `/api/kad/*` already uses (check how other unauthenticated-by-design local-only routes are protected, if at all — this KAD module appears to be single-tenant-local, consistent with the rest of this dashboard's local-first posture per root `CLAUDE.md`).

## Next Steps
- Phase 2 (ToChucTab UI) and phase 4 (xlsx import) both depend on everything in this phase.
