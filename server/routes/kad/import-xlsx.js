/**
 * @file server/routes/kad/import-xlsx.js — single-file .xlsx import + template
 * download for Mục tiêu chiến lược, Văn hóa & Nguyên tắc, JD & Kỹ năng
 * (source-request items 3 and 7). Parsing/generation lives in
 * repo/xlsx-schemas.js; this file is just routing + mapping the generic
 * {kv, tables} shape onto each area's existing write path — none of these
 * bypass an existing approval gate (Văn hóa still goes through
 * createDraftVersion, same as a manual "Đề xuất sửa").
 */
const express = require("express");
const repo = require("../../lib/kad/repo");
const { buildTemplateWorkbook, parseWorkbook } = require("../../lib/kad/repo/xlsx-schemas");

const router = express.Router();
const err = (res, code, message, status = 400) =>
  res.status(status).json({ error: { code, message } });

const MAX_IMPORT_BYTES = 5 * 1024 * 1024; // 5 MB — plenty for a metadata spreadsheet

function getUploader() {
  let multer;
  try {
    multer = require("multer");
  } catch {
    return null;
  }
  return multer({
    storage: multer.memoryStorage(),
    limits: { files: 1, fileSize: MAX_IMPORT_BYTES },
  });
}
const uploader = getUploader();

function requireUpload(req, res, next) {
  if (!uploader) return err(res, "ENOUPLOADER", "file upload is unavailable on this server", 503);
  uploader.single("file")(req, res, (e) => {
    if (e) return err(res, "EBADUPLOAD", e.message || "upload failed", 400);
    if (!req.file) return err(res, "ENOFILE", 'no file uploaded (field name must be "file")', 400);
    next();
  });
}

router.get("/import-templates/:kind", async (req, res) => {
  try {
    const wb = buildTemplateWorkbook(req.params.kind);
    const buf = await wb.xlsx.writeBuffer();
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${req.params.kind}-template.xlsx"`);
    res.send(Buffer.from(buf));
  } catch (e) {
    err(res, "EBADKIND", e instanceof Error ? e.message : "could not build template", 400);
  }
});

router.post("/goals/import", requireUpload, async (req, res) => {
  try {
    const { kv, tables } = await parseWorkbook("muc-tieu", req.file.buffer);
    const goals = (tables.MucTieu || []).map((r) => ({
      title: r.title,
      metric: r.metric,
      current_value: Number(r.current) || 0,
      target_value: Number(r.target) || 0,
      due_date: r.due || null,
    }));
    const org_id = req.body.org_id;
    const savedGoals = repo.strategicGoals.replaceGoals(org_id, goals);
    const strategy =
      kv.chien_luoc !== undefined
        ? repo.strategicGoals.saveStrategy(org_id, kv.chien_luoc)
        : repo.strategicGoals.getStrategy(org_id);
    res.json({ goals: savedGoals, ...strategy });
  } catch (e) {
    err(res, "EBADIMPORT", e instanceof Error ? e.message : "import failed", 400);
  }
});

router.post("/org-context/import", requireUpload, async (req, res) => {
  try {
    const { kv, tables } = await parseWorkbook("van-hoa", req.file.buffer);
    const current = repo.orgContext.getCurrent();
    if (!current)
      return err(
        res,
        "ENOCONTEXT",
        "no org context to import into yet — complete setup first",
        400
      );
    const coreValues = (tables.GiaTriCotLoi || []).map((r) => r.value).filter(Boolean);
    const patch = {
      ...(kv.su_menh !== undefined ? { mission: kv.su_menh } : {}),
      ...(kv.tam_nhin !== undefined ? { vision: kv.tam_nhin } : {}),
      ...(coreValues.length ? { core_values: coreValues } : {}),
      brand: {
        ...current.data.brand,
        ...(kv.nguyen_tac !== undefined ? { voice: kv.nguyen_tac } : {}),
        ...(kv.ky_luat !== undefined ? { guideline: kv.ky_luat } : {}),
      },
      strategy: {
        ...current.data.strategy,
        ...(kv.chien_luoc_muc_tieu !== undefined ? { goals: kv.chien_luoc_muc_tieu } : {}),
        ...(kv.chien_luoc_uu_tien !== undefined ? { priorities: kv.chien_luoc_uu_tien } : {}),
        ...(kv.chien_luoc_rang_buoc !== undefined ? { constraints: kv.chien_luoc_rang_buoc } : {}),
        ...(kv.chien_luoc_lo_trinh !== undefined ? { roadmap: kv.chien_luoc_lo_trinh } : {}),
      },
    };
    const draft = repo.orgContext.createDraftVersion({
      org_id: current.org_id,
      data: patch,
      change_summary: "Nhập từ file .xlsx",
    });
    res.json(draft);
  } catch (e) {
    err(res, "EBADIMPORT", e instanceof Error ? e.message : "import failed", 400);
  }
});

router.post("/agents/:id/import", requireUpload, async (req, res) => {
  try {
    const { kv, tables } = await parseWorkbook("jd-ky-nang", req.file.buffer);
    const patch = {};
    if (kv.mo_ta_cong_viec !== undefined) patch.role_description = kv.mo_ta_cong_viec;
    if (tables.KyNang) patch.skills = tables.KyNang.map((r) => r.skill).filter(Boolean);
    const agent = repo.personnel.updateAgent(req.params.id, patch);
    if (!agent) return err(res, "ENOTFOUND", "agent not found", 404);
    res.json(agent);
  } catch (e) {
    err(res, "EBADIMPORT", e instanceof Error ? e.message : "import failed", 400);
  }
});

module.exports = router;
