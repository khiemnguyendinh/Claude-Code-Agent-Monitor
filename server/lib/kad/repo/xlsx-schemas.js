/**
 * @file server/lib/kad/repo/xlsx-schemas.js — single-file .xlsx import/export
 * schema definitions shared by template generation and upload parsing
 * (server/routes/kad/import-xlsx.js). One source of truth per `kind` so the
 * downloaded template always matches what the parser expects.
 *
 * Two sheet shapes:
 *   - "kv": 2 columns (Truong/Gia_tri), one row per field — a flat form.
 *   - "table": N named columns, one row per record — a list (goals, core
 *     values, skills).
 */
const ExcelJS = require("exceljs");

const SCHEMAS = {
  "muc-tieu": {
    label: "Mục tiêu & chiến lược",
    sheets: [
      {
        name: "ChienLuoc",
        type: "kv",
        fields: [
          {
            key: "chien_luoc",
            label: "Chiến lược & định hướng",
            example: "Trọng tâm quý này: ...",
          },
        ],
      },
      {
        name: "MucTieu",
        type: "table",
        columns: [
          { key: "title", label: "Ten_muc_tieu", example: "Ra mắt Khóa AI Marketing K3" },
          { key: "metric", label: "Chi_so_do", example: "Học liệu hoàn thành" },
          { key: "current", label: "Hien_tai", example: 3 },
          { key: "target", label: "Muc_tieu", example: 7 },
          { key: "due", label: "Moc_thoi_gian", example: "30/09" },
        ],
      },
    ],
  },
  "van-hoa": {
    label: "Văn hóa & Nguyên tắc",
    sheets: [
      {
        name: "VanHoa",
        type: "kv",
        fields: [
          { key: "su_menh", label: "Sứ mệnh", example: "..." },
          { key: "tam_nhin", label: "Tầm nhìn", example: "..." },
          { key: "nguyen_tac", label: "Nguyên tắc làm việc", example: "..." },
          { key: "ky_luat", label: "Kỷ luật công việc", example: "..." },
          { key: "chien_luoc_muc_tieu", label: "Chien_luoc_Goals", example: "..." },
          { key: "chien_luoc_uu_tien", label: "Chien_luoc_Priorities", example: "..." },
          { key: "chien_luoc_rang_buoc", label: "Chien_luoc_Constraints", example: "..." },
          { key: "chien_luoc_lo_trinh", label: "Chien_luoc_Roadmap", example: "..." },
        ],
      },
      {
        name: "GiaTriCotLoi",
        type: "table",
        columns: [{ key: "value", label: "Gia_tri", example: "Chính trực" }],
      },
    ],
  },
  "jd-ky-nang": {
    label: "JD & Kỹ năng",
    sheets: [
      {
        name: "JD",
        type: "kv",
        fields: [
          { key: "mo_ta_cong_viec", label: "Mo_ta_cong_viec", example: "# JD\n## Nhiệm vụ\n..." },
        ],
      },
      {
        name: "KyNang",
        type: "table",
        columns: [{ key: "skill", label: "Ky_nang", example: "seo" }],
      },
    ],
  },
};

function getSchema(kind) {
  const schema = SCHEMAS[kind];
  if (!schema) throw new Error(`unknown import kind: ${kind}`);
  return schema;
}

/** Build a downloadable template workbook — headers + one filled example row per sheet. */
function buildTemplateWorkbook(kind) {
  const schema = getSchema(kind);
  const wb = new ExcelJS.Workbook();
  for (const sheetDef of schema.sheets) {
    const ws = wb.addWorksheet(sheetDef.name);
    if (sheetDef.type === "kv") {
      ws.addRow(["Truong", "Gia_tri"]);
      for (const f of sheetDef.fields) ws.addRow([f.label, f.example ?? ""]);
    } else {
      ws.addRow(sheetDef.columns.map((c) => c.label));
      ws.addRow(sheetDef.columns.map((c) => c.example ?? ""));
    }
    ws.columns.forEach((col) => {
      col.width = 32;
    });
  }
  return wb;
}

function cellText(cell) {
  if (cell == null) return "";
  if (typeof cell === "object" && "text" in cell) return String(cell.text ?? "");
  if (typeof cell === "object" && "result" in cell) return String(cell.result ?? "");
  return String(cell);
}

/**
 * Parse an uploaded workbook against `kind`'s schema.
 * @returns {{kv: Record<string,string>, tables: Record<string, Array<Record<string,string>>>}}
 */
function parseWorkbook(kind, buffer) {
  const schema = getSchema(kind);
  const wb = new ExcelJS.Workbook();
  return wb.xlsx.load(buffer).then(() => {
    const kv = {};
    const tables = {};
    for (const sheetDef of schema.sheets) {
      const ws = wb.getWorksheet(sheetDef.name);
      if (!ws)
        throw new Error(
          `missing sheet "${sheetDef.name}" (expected in the ${schema.label} template)`
        );
      if (sheetDef.type === "kv") {
        const byLabel = new Map(sheetDef.fields.map((f) => [f.label.trim().toLowerCase(), f.key]));
        ws.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return; // header
          const label = cellText(row.getCell(1).value).trim().toLowerCase();
          const key = byLabel.get(label);
          if (key) kv[key] = cellText(row.getCell(2).value);
        });
      } else {
        const headerRow = ws.getRow(1);
        const colIndexByKey = {};
        sheetDef.columns.forEach((c) => {
          for (let i = 1; i <= headerRow.cellCount; i++) {
            if (
              cellText(headerRow.getCell(i).value).trim().toLowerCase() === c.label.toLowerCase()
            ) {
              colIndexByKey[c.key] = i;
            }
          }
        });
        const missing = sheetDef.columns.filter((c) => !colIndexByKey[c.key]);
        if (missing.length) {
          throw new Error(
            `sheet "${sheetDef.name}": missing column(s) ${missing.map((c) => c.label).join(", ")}`
          );
        }
        const rows = [];
        ws.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return;
          const record = {};
          let hasValue = false;
          for (const c of sheetDef.columns) {
            const v = cellText(row.getCell(colIndexByKey[c.key]).value).trim();
            if (v) hasValue = true;
            record[c.key] = v;
          }
          if (hasValue) rows.push(record);
        });
        tables[sheetDef.name] = rows;
      }
    }
    return { kv, tables };
  });
}

module.exports = { SCHEMAS, getSchema, buildTemplateWorkbook, parseWorkbook };
