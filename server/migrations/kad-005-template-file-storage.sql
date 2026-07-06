-- KAD Phase — Đội ngũ admin. Thư viện mẫu: broaden accepted upload formats
-- beyond .md (docx/pdf/xlsx are binary, don't belong in the existing `content`
-- TEXT column as raw bytes). Additive: `content` stays NOT NULL (a short
-- placeholder string for binary uploads); the real bytes live on disk at
-- `file_path`, mirroring how `artifacts` already pairs `content`+`file_path`.
ALTER TABLE template_versions ADD COLUMN file_path TEXT;
ALTER TABLE template_versions ADD COLUMN mime_type TEXT;
ALTER TABLE template_versions ADD COLUMN original_file_name TEXT;
