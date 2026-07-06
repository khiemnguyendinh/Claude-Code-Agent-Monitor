# KAD DoiNgu admin + import features — overview

Work context (ALL implementation happens here, NOT in the main checkout):
`/Users/macintoshhd/AI Agent/AI Agent Workspace/Claude-Code-Agent-Monitor/.claude/worktrees/kad-phase-05-learning` (branch `kad/phase-05-learning`). Confirmed via `lsof`+`ps` this is the directory actually served by the running dev server on port 4820 — it is ground truth for what the user sees at `/doi-ngu`, `/hoc-lieu`, `/muc-tieu-chien-luoc`. Node: use whichever node is on PATH; if better-sqlite3 ABI errors, `npm rebuild better-sqlite3` — don't hardcode a binary.

Do NOT confuse with the main repo checkout at the repo root — it has a large uncommitted, unrelated deletion pile (stale/mid-refactor) and is NOT what's running. Ignore it for this work.

## Source request (verbatim intent, Vietnamese)
1. `/doi-ngu` Tab Tổ chức: no add/edit/delete/permission-assignment for Nhân sự số (digital personnel = `agent_profiles`).
2. Org chart editor: no add/delete of nodes (edit-only currently).
3. Tabs Mục tiêu / JD & Kỹ năng / Văn hóa & Nguyên tắc: need single-file import (all fields) + downloadable template link.
4. JD & Kỹ năng / Văn hóa & Nguyên tắc: no add/edit/delete.
5. Tab Thư viện mẫu: only accepts `.md`, need to broaden formats.
6. `/hoc-lieu`: read-only KAD-generated materials only; need upload (incl. folder upload).
7. `/muc-tieu-chien-luoc`: need single-file import + template link.

## Decisions locked in (user-confirmed, 260706)
- Phased sequential delivery, verify each phase before moving on.
- Single-file import format: **.xlsx**.
- Thư viện mẫu new formats: **.docx, .pdf, .xlsx** (in addition to existing `.md`).
- Org chart editor: **form CRUD, tree auto-redraws** — no drag-drop graph library.
- Mục tiêu chiến lược (goals+strategy) currently pure React state, no DB, lost on refresh — **add real DB persistence** as part of this work (not deferred).
- Personnel delete = **soft delete** (`status='archived'`), matches existing template/blueprint convention — never hard-delete (FK risk from tasks/artifacts referencing `agent_id`).

## Phases
| # | File | Scope | Depends on |
|---|------|-------|-----------|
| 1 | [phase-01-personnel-backend.md](phase-01-personnel-backend.md) | `agent_profiles` CRUD (create/update/archive) + permissions write route; xlsx lib choice; `muc_tieu` goals/strategy DB table + routes | none |
| 2 | [phase-02-tochuc-tab-ui.md](phase-02-tochuc-tab-ui.md) | ToChucTab: personnel roster panel (add/edit/archive + permission checkboxes) + org chart editor add/delete node | 1 |
| 3 | [phase-03-jd-van-hoa-crud.md](phase-03-jd-van-hoa-crud.md) | JDKyNangTab real edit form (replace toast stub) + skill add/remove; VanHoaTab structured list CRUD (core values / competitors / swot items, not just blob edit) | 1 |
| 4 | [phase-04-xlsx-import.md](phase-04-xlsx-import.md) | Shared xlsx import/export util + template download; wire into Mục tiêu chiến lược, Văn hóa, JD & Kỹ năng | 1, 2, 3 |
| 5 | [phase-05-thu-vien-mau-formats.md](phase-05-thu-vien-mau-formats.md) | Thư viện mẫu: accept .docx/.pdf/.xlsx, switch storage from inline text to disk (multer), keep .md path working | none (parallel-safe with 2-4) |
| 6 | [phase-06-hoc-lieu-upload.md](phase-06-hoc-lieu-upload.md) | `/hoc-lieu`: upload arbitrary materials incl. folder upload (webkitdirectory) | 5 (reuses disk-upload pattern) |

Phases 1-4 are sequential (each needs the prior). Phase 5 can run in parallel with 2-4 (touches different files). Phase 6 depends on phase 5's disk-storage pattern only, not its DB schema.

## Cross-cutting notes
- All new mutation routes must add `audit()` calls matching existing KAD convention (see `server/lib/kad/repo/org-context.js` for the pattern).
- Preserve draft→approve workflow wherever one already exists (Văn hóa, blueprint) — imports/edits feed into it, they don't bypass it. Only Mục tiêu chiến lược and personnel roster write directly (they have no existing approval gate).
- Run `npm run test:server` after each backend-touching phase; `npm run test:client` after each frontend-touching phase (per repo `CLAUDE.md`).
- Every phase that adds a DB column/table must be migration-safe (see `server/lib/kad/migrate.js` pattern) — additive only, no destructive schema changes.

## Unresolved questions
1. XLSX parsing/generation library: recommend `exceljs` (read+write, actively maintained) over `xlsx`/SheetJS (write support weaker, past prototype-pollution CVE history) — confirm before phase 1 starts, or default to this pick.
2. Thư viện mẫu storage: recommend switching from inline DB `content` text column to disk-based storage via multer (same pattern as `attachments-upload.js`), since docx/pdf/xlsx are binary and don't belong in a TEXT column as raw bytes — confirm before phase 5, or default to this pick.
3. Học liệu upload: recommend a `source_type` column on `artifacts` (`'generated' | 'uploaded'`) rather than a new table, to keep one browse/view surface — confirm before phase 6, or default to this pick.
