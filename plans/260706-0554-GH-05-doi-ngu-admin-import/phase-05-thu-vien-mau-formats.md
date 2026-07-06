# Phase 5 — Thư viện mẫu: accept .docx/.pdf/.xlsx (currently .md only)

## Context Links
- Overview: [plan.md](plan.md)
- No dependency on phases 1-4 (touches a disjoint tab/data model) — can run in parallel with phases 2-4, right after this plan is agreed.
- Files read in full this session: `client/src/kad/pages/DoiNgu/ThuVienMauTab.tsx` (172 lines), `server/lib/kad/repo/templates.js` (partial, key functions), `server/migrations/kad-001-init.sql` (`template_versions` schema), `server/routes/kad/attachments-upload.js` (multer pattern to reuse).

## Overview
- Priority: P1.
- Status: not started.
- Not just "loosen the file-extension check" — the current design stores upload content as **UTF-8 text in a `TEXT NOT NULL` DB column** (`onFile` in `ThuVienMauTab.tsx:39-43` does `await file.text()`; `templates.js`'s `validateTemplateInput` enforces `.md` + <=256KB text). `.docx`/`.xlsx` are zip-based binary containers and `.pdf` is binary — reading them as UTF-8 text corrupts them. This phase changes the storage mechanism, not just the accept-list.

## Key Insights
- `template_versions.content TEXT NOT NULL` (`kad-001-init.sql:278-290`) has no sibling `file_path` column, unlike `artifacts` (which already has both `content` and `file_path`, `kad-001-init.sql:199-215` — that table was designed with binary-capable storage in mind from the start; `template_versions` wasn't).
- Reuse the exact disk-storage security pattern from `server/routes/kad/attachments-upload.js` (`diskStorage`, `path.basename` + control-char stripping on filename, random-token prefix to avoid collisions, size caps) rather than inventing a new one.
- The template viewer (`ThuVienMauTab.tsx:162`, `<MarkdownLite content={...} />`) only makes sense for `.md` content. Non-markdown uploads need a different display: file type icon + name + a "Tải xuống" link, no inline render attempt.
- `validateTemplateInput` (`templates.js`) currently rejects anything not ending in `.md` and enforces a 256KB text-size cap — both need to become format-aware (per-format size cap makes sense too: docx/xlsx can reasonably be a few MB, still shouldn't be unbounded).

## Requirements
1. Migration `server/migrations/kad-005-template-file-storage.sql`: `ALTER TABLE template_versions ADD COLUMN file_path TEXT; ALTER TABLE template_versions ADD COLUMN mime_type TEXT; ALTER TABLE template_versions ADD COLUMN original_file_name TEXT;` — additive only, `content` stays `NOT NULL` (for non-text formats, store a short placeholder string like `"[binary: <filename>]"` there so existing readers that assume `content` is always populated don't break; the real bytes live at `file_path`).
2. New route `POST /api/kad/templates/upload` (multipart, replacing/augmenting the current JSON-body `POST /api/kad/templates` path for binary formats — keep the existing JSON path working for `.md` uploads to avoid a breaking change to `templates.createDraft`'s current callers) using `multer.diskStorage()` mirroring `attachments-upload.js`'s destination/filename functions, writing under a new `data/kad-templates/` directory (resolve via the same workspace-root-style guard used for task attachments, or a fixed app-data directory if templates aren't per-task/per-workspace — confirm which is more consistent with how this dashboard's `data/` directory is already organized before picking the path).
3. Extend `validateTemplateInput`/`createDraft` in `templates.js` to accept an allow-list of extensions (`.md`, `.docx`, `.pdf`, `.xlsx`) with per-type size caps (keep `.md` at 256KB; recommend 10MB for `.docx`/`.xlsx`, 20MB for `.pdf` — adjust to whatever's consistent with `attachments-upload.js`'s existing 25MB cap) and set `file_path`/`mime_type`/`original_file_name` instead of raw content for non-`.md` types.
4. `GET /api/kad/templates/:id/versions/:versionId/download` (or similar) — streams the stored file back with correct `Content-Type` and `Content-Disposition`, for both the viewer's download link and (reused in phase 6 if it needs a similar download path).
5. Client `ThuVienMauTab.tsx`: change `accept=".md"` (`:114`) to `accept=".md,.docx,.pdf,.xlsx"`; `onFile` must branch — `.md` keeps the existing `file.text()` + JSON POST path (no behavior change for the common case), other formats go through `FormData` + the new multipart upload route.
6. Viewer (`:162`): render `<MarkdownLite>` only when `selected.latest_version?.mime_type` is markdown/absent (backward-compat with existing `.md` templates that have no `mime_type` set); otherwise show a file-type badge + "Tải xuống" link hitting the download route.

## Architecture
- Keep `templates.js`'s existing `createDraft`/`approve`/`getTemplate` functions as the single write/read path — the new multipart route should still funnel through (an extended) `createDraft`, not a parallel function, so versioning/approval semantics stay identical between `.md` and binary uploads.
- Storage location: check whether this dashboard already has an established "app data directory" convention (e.g. how the SQLite file itself or any other on-disk artifact is placed) before inventing `data/kad-templates/` — match existing convention if one exists.

## Related Code Files
- Create: `server/migrations/kad-005-template-file-storage.sql`, `server/routes/kad/templates-upload.js` (multer instance + upload route, mirroring `attachments-upload.js`'s `getUploader()` pattern), a download route (can live in the existing `knowledge.js` alongside other template routes, or the new upload file).
- Modify: `server/lib/kad/repo/templates.js` (extend `validateTemplateInput`, `createDraft`), `server/routes/kad/index.js` (mount), `client/src/kad/pages/DoiNgu/ThuVienMauTab.tsx` (accept-list, branching upload, non-markdown viewer path), `client/src/kad/api-client.ts` (add a FormData-posting `templates.uploadFile` alongside the existing `templates.createDraft`, mirroring the established `attachments.upload` pattern at `api-client.ts:1080`).

## Implementation Steps
1. Migration + verify apply.
2. Extend `templates.js` validation + `createDraft` for the 4 formats and per-type size caps.
3. Build the multer upload route (disk storage, security pattern copied from `attachments-upload.js`), wire to `createDraft`.
4. Build the download route.
5. Update `ThuVienMauTab.tsx`: accept-list, upload branching, non-markdown viewer fallback.
6. Add `templates.uploadFile` to `api-client.ts`.
7. Manual verification: upload one file of each of the 4 formats, confirm each appears in the template list, `.md` still renders inline, others show download link and download correctly (byte-identical to what was uploaded — diff the downloaded file against the original).
8. `npm run test:server` (add tests: reject unsupported extension, reject oversized file per type, `.md` path unchanged) and `npm run test:client`.

## Todo List
- [ ] Migration applied
- [ ] `templates.js` validation extended (4 formats, per-type caps)
- [ ] Multipart upload route (disk storage, security pattern matched)
- [ ] Download route
- [ ] `ThuVienMauTab.tsx` accept-list + branching + non-md viewer
- [ ] `api-client.ts` `templates.uploadFile`
- [ ] Manual byte-identical round-trip verified for all 4 formats
- [ ] `npm run test:server` + `npm run test:client` green

## Success Criteria
- `.md` upload behavior is unchanged (no regression) — same JSON path, same inline render.
- `.docx`/`.pdf`/`.xlsx` upload, appear in the list, download byte-identical to the source file.
- Oversized or wrong-extension files are rejected with a clear error, not a corrupted silent success.

## Risk Assessment
- Existing rows created before this migration have `file_path`/`mime_type` NULL — viewer logic must treat NULL `mime_type` as "assume markdown" (matches every row that exists today) to avoid breaking display of pre-existing templates.
- Disk storage introduces a new directory that needs to exist / be creatable at server startup — mirror however `attachments-upload.js`'s `resolveTaskDir` (or the app's general data-dir bootstrap) already handles first-run directory creation.

## Security Considerations
- Same as `attachments-upload.js`'s documented rationale: `path.basename` + control-char stripping on filename, random-token prefix, path resolution through a workspace-root-style guard (never trust a client-supplied path segment directly into `fs` calls).
- Validate actual file content type where feasible (e.g. `exceljs` can be used to sanity-open an `.xlsx` upload as a cheap "is this really a valid xlsx" check; a magic-byte check for `.pdf`/`.docx` is a reasonable lighter-weight alternative) rather than trusting only the client-supplied extension/MIME header.

## Next Steps
- Phase 6 (Học liệu upload) reuses this phase's multer disk-storage pattern for a similar (but not identical — different table, different data model) upload need.
