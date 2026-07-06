# Phase 6 — /hoc-lieu: upload external materials (incl. folder upload)

## Context Links
- Overview: [plan.md](plan.md)
- Depends on phase 5 only for the multer disk-storage pattern to copy (not its DB schema) — can start once phase 5's upload route exists as a reference, or in parallel if you're comfortable writing the pattern twice from `attachments-upload.js` directly.
- Files read in full this session: `client/src/kad/pages/HocLieu.tsx` (164 lines), `server/lib/kad/repo/artifacts.js` (function signatures).

## Overview
- Priority: P2 (last — least coupled to the rest of this plan).
- Status: not started.
- Good news found during scouting: **no schema change needed at all.** `artifacts` table already has `file_path TEXT` and `metadata JSON` columns (`kad-001-init.sql:199-215`), and `createArtifact()` (`server/lib/kad/repo/artifacts.js:10`) already accepts `file_path` as a parameter — this table was designed with disk-backed content in mind from day one, just never exposed to a human-facing upload route. `artifact_type` CHECK already includes `'other'`, which is exactly right for arbitrary uploaded materials.

## Key Insights
- `HocLieu.tsx`'s own file-header comment (`:1-11`) explicitly says folder/upload was deliberately deferred ("để dành cho spec riêng của màn này" — "left for this screen's own separate spec") — this phase is that spec.
- Current page only calls `kadApi.artifacts.list({})` (`:35`) — read-only. Existing routes are `GET /artifacts` and `GET /artifacts/:id` (`server/routes/kad/artifacts.js:11,15`) plus an agent-only `POST /internal/save-artifact` (JSON body, no multipart, `internal.js:299`) — there is currently **no human-facing create/upload route** for artifacts at all.
- Folder upload via `<input type="file" webkitdirectory multiple>` gives a `FileList` where each `File` carries `.webkitRelativePath` (e.g. `"MyFolder/sub/file.pdf"`) — use this to (a) preserve the folder structure on disk under a per-upload batch directory, and (b) store the relative path in `metadata` so the UI can show it even though the grid itself stays flat (one card per file — no need to build a folder-tree UI for this phase, matches existing card-grid pattern, avoids over-building).
- Every uploaded file becomes its own `artifacts` row with `artifact_type: 'other'`, `agent_id: null` (uploaded by a human, not an agent — confirm this column is nullable, not `NOT NULL`, before relying on this), `status` likely `'published'` (no draft/review workflow applies to an already-finished external file — confirm this against the `status` CHECK list `draft|review|approved|published|archived` and pick the one that reads correctly in the existing status chip labels), `metadata: {source: 'uploaded', original_name, relative_path, mime_type, batch_id, uploaded_by: 'human'}`.

## Requirements
1. New route `POST /api/kad/artifacts/upload` (multipart, `multer.diskStorage()`, mirrors phase 5's/`attachments-upload.js`'s security pattern) accepting one or more files (`multiple` on the client side covers both "pick files" and "pick a folder" — `webkitdirectory` is just an additional attribute on the same input type).
2. Server: for each uploaded file, write to disk under `data/kad-hoc-lieu/<batch-id>/<relative-path-or-basename>` (preserve `webkitRelativePath` if the client sends it as a field alongside each file — multer doesn't know about `webkitRelativePath` natively, so the client must send it explicitly per file, e.g. as a matching-indexed form field or JSON sidecar array), then call `createArtifact({artifact_type: 'other', title: <basename>, file_path, agent_id: null, status: 'published', metadata: {...}})`.
3. Client `HocLieu.tsx`: add an "Tải lên học liệu" button opening a hidden file input; a second "Tải lên thư mục" button opening a second hidden input with `webkitdirectory` set (browsers don't allow toggling this attribute dynamically in all cases — use two separate inputs rather than one input with a runtime-toggled attribute).
4. On selection, POST all files as one `FormData` multipart request (including each file's relative path as a parallel field) to the new route, show upload progress/toast, then `refresh()`/re-fetch the artifact list on success.
5. Visually distinguish uploaded materials from AI-generated ones in the grid — reuse the existing `StatusChip`/`ArtifactStatusChip` pattern (`HocLieu.tsx:110-111`) with one more chip driven by `metadata.source === 'uploaded'`, rather than adding a new visual system.
6. `ArtifactViewer.tsx` (peek detail view): for `metadata.source === 'uploaded'` artifacts, skip the markdown/version-diff UI (which assumes AI-generated markdown content) and show a simple file-type icon + "Tải xuống" link instead — mirrors phase 5's non-markdown viewer fallback for template library.

## Architecture
- Reuse phase 5's multer disk-storage security pattern (`path.basename` + control-char stripping, random-token prefix per file, size/count caps) rather than re-deriving it — if phase 5 already extracted a shared helper, import it; if not, copy the pattern inline and note the duplication for later extraction (don't block this phase on refactoring phase 5).
- One route handles both "loose files" and "a folder" — the client distinguishes intent via which button was clicked (which `<input>` was used), but the server-side handling is identical either way (a flat list of files + optional relative paths).

## Related Code Files
- Create: `server/routes/kad/artifacts-upload.js` (multer instance + route, name mirrors `attachments-upload.js`).
- Modify: `server/routes/kad/index.js` (mount), `client/src/kad/pages/HocLieu.tsx` (upload buttons + two hidden inputs + FormData POST), `client/src/kad/components/ArtifactViewer.tsx` (non-markdown fallback view), `client/src/kad/api-client.ts` (add `artifacts.upload(files, relativePaths?)` mirroring the existing `attachments.upload` FormData pattern at `:1080`).

## Implementation Steps
1. Confirm `agent_id` and `status` column nullability/CHECK values against `kad-001-init.sql` before writing the create call (don't guess).
2. Build the multer upload route + disk write (preserving relative path when present).
3. Wire `createArtifact` call per file with the metadata shape above.
4. Add `artifacts.upload` to `api-client.ts`.
5. Build the two upload buttons + hidden inputs in `HocLieu.tsx`, wire FormData POST + refresh-on-success.
6. Add the "uploaded" chip to the grid card.
7. Update `ArtifactViewer.tsx`'s non-markdown fallback.
8. Manual verification: upload a handful of loose files (mixed types: .pdf, .docx, .png) and upload an entire folder with subfolders — confirm every file appears as its own card, folder structure is preserved on disk, download round-trips byte-identical.
9. `npm run test:server` (add tests: multi-file upload, folder-with-relative-path upload, oversized/too-many-files rejection) and `npm run test:client`.

## Todo List
- [ ] Confirm `agent_id`/`status` nullability against schema
- [ ] Multer upload route + disk write (relative path preserved)
- [ ] `createArtifact` wired per file
- [ ] `api-client.ts` `artifacts.upload`
- [ ] `HocLieu.tsx` two upload buttons (files, folder)
- [ ] "Uploaded" chip on grid cards
- [ ] `ArtifactViewer.tsx` non-markdown fallback
- [ ] Manual verification (loose files + real folder, byte-identical download)
- [ ] `npm run test:server` + `npm run test:client` green

## Success Criteria
- Uploading a mix of loose files of different types all appear correctly in the grid, downloadable and byte-identical.
- Uploading a folder with nested subfolders results in one artifact per file, each with its correct relative path recorded, and disk layout mirrors the original folder structure.
- No regression to existing AI-generated artifact display, filtering, or peek-drawer behavior.

## Risk Assessment
- Browser support for `webkitdirectory` is Chromium/Firefox/Safari-good but the attribute is technically non-standard — acceptable given this is a local-first internal tool (matches the rest of this dashboard's target environment), but worth a one-line note in the UI if the browser doesn't support it (feature-detect and hide the folder button if `webkitdirectory` isn't supported, rather than showing a broken control).
- Large folder uploads (hundreds of files) — apply the same file-count/size caps as `attachments-upload.js`, and consider a lower per-request file-count ceiling with a clear error message rather than an unbounded multipart request.

## Security Considerations
- Same disk-write security posture as phase 5 and `attachments-upload.js`: sanitize every filename component (including each path segment of a preserved relative path — a malicious folder name like `"../../etc"` must not escape the batch directory), cap total upload size, validate file count.

## Next Steps
- None — last phase in this plan. After all 6 phases land, do a final end-to-end pass across `/doi-ngu`, `/hoc-lieu`, `/muc-tieu-chien-luoc` and re-run both `npm run test:server` and `npm run test:client` once more together (catches any cross-phase interaction the per-phase runs missed).
