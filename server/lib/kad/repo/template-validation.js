/**
 * @file server/lib/kad/repo/template-validation.js — Thư viện mẫu input
 * validation, split out of templates.js (persistence) to keep each file
 * under the repo's ~200 LOC guideline. Two upload paths:
 *   - .md as a JSON body (`content` inline, original path).
 *   - .docx/.pdf/.xlsx as a disk-backed upload (Phase 5, `file_path` set by
 *     server/routes/kad/templates-upload.js before this ever validates it).
 */

const TEMPLATE_TYPES = new Set([
  "program_framework",
  "syllabus",
  "lesson_plan",
  "slide_outline",
  "video_script",
  "quality_rubric",
  "facebook_post",
  "wordpress_post",
  "business_analysis",
  "custom",
]);

const MAX_TEMPLATE_BYTES = 256 * 1024;

// Content stays a short placeholder in the `content` column for these; real
// bytes live on disk at `file_path` (mirrors how `artifacts` already pairs
// `content` + `file_path`).
const BINARY_FORMATS = {
  ".docx": {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    maxBytes: 10 * 1024 * 1024,
  },
  ".pdf": { mime: "application/pdf", maxBytes: 20 * 1024 * 1024 },
  ".xlsx": {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    maxBytes: 10 * 1024 * 1024,
  },
};

function bytes(s) {
  return Buffer.byteLength(String(s || ""), "utf8");
}

function extname(fileName) {
  const s = String(fileName || "").toLowerCase();
  const i = s.lastIndexOf(".");
  return i === -1 ? "" : s.slice(i);
}

function validateTemplateInput(input) {
  const type = input.template_type || "custom";
  if (!TEMPLATE_TYPES.has(type)) throw new Error("invalid template_type");
  const name = String(
    input.name || input.file_name || input.original_file_name || "Template mới"
  ).slice(0, 200);
  const purpose = input.purpose ? String(input.purpose).slice(0, 500) : null;
  const change_summary = input.change_summary ? String(input.change_summary).slice(0, 1000) : null;

  // Binary upload path (docx/pdf/xlsx, Phase 5) — real bytes already written to
  // disk by templates-upload.js; this just validates+records the reference.
  if (input.file_path) {
    const ext = extname(input.original_file_name);
    const format = BINARY_FORMATS[ext];
    if (!format)
      throw new Error(
        `unsupported file format: "${ext || "(none)"}" (accepted: .md, .docx, .pdf, .xlsx)`
      );
    if (Number(input.file_size) > format.maxBytes) {
      throw new Error(`${ext} template must be <=${Math.floor(format.maxBytes / (1024 * 1024))}MB`);
    }
    return {
      type,
      name,
      purpose,
      change_summary,
      content: `[binary: ${input.original_file_name}]`,
      file_path: input.file_path,
      mime_type: format.mime,
      original_file_name: input.original_file_name,
    };
  }

  // Original .md text path — unchanged behavior.
  const content = String(input.content || "");
  if (!content.trim()) throw new Error("content is required");
  if (bytes(content) > MAX_TEMPLATE_BYTES) throw new Error("template .md must be <=256KB");
  if (input.file_name && !String(input.file_name).toLowerCase().endsWith(".md")) {
    throw new Error("only .md template uploads are accepted");
  }
  return {
    type,
    name,
    purpose,
    change_summary,
    content,
    file_path: null,
    mime_type: null,
    original_file_name: null,
  };
}

module.exports = { TEMPLATE_TYPES, MAX_TEMPLATE_BYTES, BINARY_FORMATS, validateTemplateInput };
