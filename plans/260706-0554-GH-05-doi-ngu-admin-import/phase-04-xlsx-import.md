# Phase 4 — Single-file .xlsx import + downloadable template (3 surfaces)

## Context Links
- Overview: [plan.md](plan.md)
- Depends on: [phase-01-personnel-backend.md](phase-01-personnel-backend.md) (goals persistence, `exceljs`), [phase-02-tochuc-tab-ui.md](phase-02-tochuc-tab-ui.md), [phase-03-jd-van-hoa-crud.md](phase-03-jd-van-hoa-crud.md) (real update endpoints an importer can call instead of inventing a parallel write path).
- Covers source-request items 3 and 7 (they're the same underlying feature for Mục tiêu, applied to 3 different data shapes).
- File read this session in full: `client/src/kad/pages/MucTieuChienLuoc.tsx` (228 lines).

## Overview
- Priority: P1.
- Status: not started.
- One shared import/export mechanism, three schema mappings: Mục tiêu chiến lược (goals+strategy), Văn hóa & Nguyên tắc (org context fields), JD & Kỹ năng (per-agent JD+skills).

## Key Insights
- `MucTieuChienLuoc.tsx` currently reads/writes via `useKadStore()`'s `goals`/`strategy`/`saveGoalsAndStrategy` (`:49`, `:89`) — **pure in-memory, no API call at all**. Since phase 1 adds real DB persistence + `GET/PUT /api/kad/goals`, this phase must ALSO migrate this component off the store and onto the API (fetch on mount, save via `kadApi.goals.save`) — otherwise xlsx import would write to a backend the page itself never reads from. This migration is folded into this phase rather than phase 1, since it's naturally exercised here.
- Keep `exceljs` parsing/generation **entirely server-side**. Client only does a file input + `fetch(..., {method: "POST", body: formData})` for upload, and a plain link/`fetch`+blob-download for the template — this avoids bundling `exceljs` (large) into the client build.
- Template downloads and uploads should go through the **same field mapping** defined once per surface (single source of truth for column/sheet names), so the generated template always matches what the parser expects — do not hand-write the template layout and the parser separately from two different files without sharing a schema constant.
- For Văn hóa: an import must still create a **draft** via `createDraftVersion` (existing approval gate) — it must NOT bypass approval. For Mục tiêu/goals: direct write, matching the existing no-approval-gate design already established in phase 1. For JD & Kỹ năng: direct write via `kadApi.agents.update` (agent profile edits have no approval gate anywhere in KAD today — matches phase 3).

## Requirements
1. **Schema definitions** (new shared file, server-side): one object per surface listing sheet name + column headers + how each maps to the existing repo write function's input shape.
   - `muc-tieu`: sheet "ChienLuoc" (2 columns: `Truong` / `Gia_tri`, one row `strategy_markdown`), sheet "MucTieu" (columns: `Ten_muc_tieu`, `Chi_so_do`, `Hien_tai`, `Muc_tieu`, `Moc_thoi_gian` — one row per goal, maps to `strategic-goals.replaceGoals` input).
   - `van-hoa`: sheet "VanHoa" (2 columns `Truong`/`Gia_tri`, one row per field: `su_menh`, `tam_nhin`, `nguyen_tac`, `ky_luat`, `chien_luoc_muc_tieu`, `chien_luoc_uu_tien`, `chien_luoc_rang_buoc`, `chien_luoc_lo_trinh`), sheet "GiaTriCotLoi" (1 column, one core value per row).
   - `jd-ky-nang`: sheet "JD" (2 columns `Truong`/`Gia_tri`, one row `mo_ta_cong_viec`), sheet "KyNang" (1 column, one skill per row). Import applies to whichever agent is currently selected in the tab (`selectedId` in `JDKyNangTab.tsx`) — this is a per-agent import, not a bulk roster import (that's phase 2's roster CRUD instead).
2. **Template generation** — `GET /api/kad/import-templates/:kind.xlsx` (`kind` ∈ `muc-tieu|van-hoa|jd-ky-nang`) builds the workbook from the schema definitions with header row + one example row, returns `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` and a sane `Content-Disposition: attachment; filename=...`.
3. **Import parsing** — `POST /api/kad/{goals,org-context,agents/:id}/import` (multipart, single `.xlsx` file, `multer.memoryStorage()` — small file, no need to touch disk): parse with `exceljs`, validate against the schema (missing sheet, missing required column, wrong data type -> structured 400 error naming the exact sheet/cell), map to the existing repo function's input shape, call it (`strategic-goals.replaceGoals`+`saveStrategy`, `org-context.createDraftVersion`, `personnel.updateAgent`).
4. **Client UI** — each of the 3 tabs/pages gets: a "Tải mẫu" link (`<a href="/api/kad/import-templates/....xlsx" download>`) and an "Nhập từ file" button opening a file picker restricted to `.xlsx` (`accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"`), posting via `FormData`, showing a toast with the structured error message on failure (surface the exact "sheet X, column Y" validation error from step 3, don't swallow it into a generic "import failed").
5. `MucTieuChienLuoc.tsx`: migrate from `useKadStore()` goals/strategy to `kadApi.goals.get()`/`kadApi.goals.save()` (loading/error states matching the pattern already used in `JDKyNangTab.tsx`/`VanHoaTab.tsx` — `KadSkeleton`/`KadErrorBlock`).

## Architecture
- New server file `server/lib/kad/xlsx-import.js` (or `server/lib/kad/repo/xlsx-schemas.js` for the schema constants + a separate `server/routes/kad/import-xlsx.js` for the routes) — keep schema-definition, generation, and parsing each in one clearly named module rather than inlining exceljs calls directly in route handlers (200-LOC modularization convention).
- Reuse `multer` (already a dependency) with `memoryStorage()` for these routes specifically — different from `attachments-upload.js`'s `diskStorage()`, since these files are parsed once and discarded, not kept as artifacts.
- Client: one small shared helper (e.g. `client/src/kad/components/XlsxImportButton.tsx`) parametrized by `kind` + `onImported` callback, used in all 3 places, rather than copy-pasting the file-input/FormData boilerplate three times.

## Related Code Files
- Create: `server/lib/kad/repo/xlsx-schemas.js`, `server/lib/kad/xlsx-import.js`, `server/routes/kad/import-xlsx.js`, `client/src/kad/components/XlsxImportButton.tsx`.
- Modify: `server/routes/kad/index.js` (mount), `client/src/kad/pages/MucTieuChienLuoc.tsx` (store -> API migration + import button), `client/src/kad/pages/DoiNgu/VanHoaTab.tsx` (import button), `client/src/kad/pages/DoiNgu/JDKyNangTab.tsx` (import button), `client/src/kad/api-client.ts` (add `goals.get/save` if not already added in phase 1, plus nothing else needed since import posts raw FormData directly, not through the typed JSON client — check existing `attachments.upload` in `api-client.ts:1080` for the established FormData-posting pattern and mirror it).

## Implementation Steps
1. Confirm `exceljs` is installed and working (phase 1 already smoke-tested it).
2. Write `xlsx-schemas.js` — the 3 schema definitions, shared by both generation and parsing.
3. Write template generation route, verify by downloading each of the 3 files and opening in a spreadsheet app — confirm headers match the schema exactly.
4. Write import parsing + validation, with unit tests covering: happy path per surface, missing sheet, missing column, wrong data type in a numeric cell (goals current/target).
5. Wire the 3 repo calls (goals replace+save, org-context draft, agent update) behind the parsed-and-validated data.
6. Build `XlsxImportButton.tsx`, wire into all 3 client surfaces.
7. Migrate `MucTieuChienLuoc.tsx` off the store onto the API.
8. Manual verification: download each template, fill in real data, re-upload, confirm the target surface reflects it (goals appear on Tổng quan per the existing card wiring, Văn hóa creates a pending draft, JD/skills update immediately on the selected agent).
9. `npm run test:server` and `npm run test:client` both green; review any snapshot diff touching `/muc-tieu-chien-luoc` deliberately.

## Todo List
- [ ] Shared xlsx schema definitions
- [ ] Template generation route (3 kinds)
- [ ] Import parsing + validation route (3 kinds) + tests
- [ ] Client `XlsxImportButton` component
- [ ] Wired into Mục tiêu chiến lược, Văn hóa, JD & Kỹ năng
- [ ] `MucTieuChienLuoc.tsx` migrated off store onto real API
- [ ] `npm run test:server` + `npm run test:client` green

## Success Criteria
- Downloading a template and re-uploading it unmodified round-trips cleanly (no data loss, no validation error) for all 3 surfaces.
- A malformed file (wrong sheet name, missing required column) produces a specific, actionable error toast, not a generic failure or a silent no-op.
- Goals/strategy entered via import survive a page reload (proves the phase-1 persistence + phase-4 store migration both work together).
- Văn hóa import creates a draft requiring approval, exactly like the manual "Đề xuất sửa" path — does not bypass the gate.

## Risk Assessment
- `exceljs` parsing untrusted uploaded files: cap file size (mirror `attachments-upload.js`'s constants, e.g. 5-10 MB is generous for a metadata spreadsheet) and cap sheet/row counts before iterating, to avoid a pathological file causing excessive memory use.
- Column-name matching should be case/whitespace-tolerant (trim, case-insensitive header match) since a human will hand-edit these files in Excel/Numbers/Google Sheets and may not preserve exact casing.

## Security Considerations
- Validate `Content-Type`/file extension of the upload server-side (don't trust the client's `accept` attribute alone) before attempting to parse.
- `exceljs` reads only cell values here (no formula evaluation of untrusted macros/external references needed) — do not enable any workbook feature beyond plain cell-value reads.

## Next Steps
- Phase 5 (Thư viện mẫu formats) and phase 6 (Học liệu upload) are independent of this phase and can proceed in parallel once phase 1 is done.
