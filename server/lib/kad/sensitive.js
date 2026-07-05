/**
 * @file server/lib/kad/sensitive.js — sensitive-content keyword scanner (spec 01
 * §4.3 layer 2). Deterministic, server-side: the Main Agent's "scan before
 * presenting" realized as code the engine runs on the agent's behalf (an agent
 * can't be trusted to gate itself — same rationale as approval-blocking living
 * server-side, spec 04 §2). Precise on the DIMENSIONS the spec names — money,
 * percentages, real people, brand claims — while deliberately NOT firing on the
 * structural numbers a normal framework/syllabus carries ("8 buổi", "6 module",
 * "45 phút", "1920x1080"), which would false-block every legitimate artifact.
 *
 * 3 dimensions (spec 01 §4.3): metrics / people / brand. Returns the FIRST
 * matched dimension as the subtype (metrics > people > brand).
 */

// metrics — currency amounts + percentages + KPI-tied figures. Percentages and
// currency are the spec's own examples ("số tiền, %"); neither matches a bare
// count like "8 buổi", so structural numbers stay clean.
const PCT = /\d+(?:[.,]\d+)?\s*%/;
const CURRENCY =
  /(?:\d[\d.,]*\s*(?:₫|đồng|VND|USD|\$|triệu|tỷ|nghìn\s*đồng|k\/tháng)|(?:\$|USD|VND)\s*\d)/i;
// A number sitting next to a business-metric word (revenue/growth/KPI/conversion…).
const METRIC_WORD =
  /(?:doanh\s*thu|lợi\s*nhuận|tăng\s*trưởng|chuyển\s*đổi|conversion|ROI|KPI|CTR|CPC|CPM|thị\s*phần|market\s*share)\D{0,20}\d/i;

// people — a personal title + a real multi-token proper name (≥2 capitalized
// words). Requiring the full name avoids firing on "anh Khiêm" boilerplate that
// legitimately names the responsible human in org context.
const PERSON =
  /\b(?:anh|chị|ông|bà|cô|thầy|Mr|Ms|Mrs|Dr)\.?\s+[A-ZÀ-Ỹ][a-zà-ỹ]+\s+[A-ZÀ-Ỹ][a-zà-ỹ]+/;

// brand — hype / superlative claims the Kstudy brand voice explicitly forbids
// (seed org context: "Cấm ngôn từ phóng đại: '100%', 'số 1', 'duy nhất'").
const BRAND =
  /(?:\bsố\s*1\b|#1|\bduy\s*nhất\b|\btốt\s*nhất\b|\bhàng\s*đầu\b|\b100\s*%\b|cam\s*kết\s*(?:\d|hoàn|chắc)|\bvô\s*địch\b|\bđỉnh\s*cao\b)/i;

/**
 * Scan text across the 3 sensitivity dimensions.
 * @param {string} text
 * @returns {{sensitive:boolean, subtype:('metrics'|'people'|'brand'|null), hits:string[], dimensions:{metrics:boolean,people:boolean,brand:boolean}}}
 */
function scan(text) {
  const s = String(text || "");
  const hits = [];
  const dims = { metrics: false, people: false, brand: false };

  for (const re of [PCT, CURRENCY, METRIC_WORD]) {
    const m = s.match(re);
    if (m) {
      dims.metrics = true;
      hits.push(`metrics: "${m[0].trim().slice(0, 40)}"`);
      break;
    }
  }
  const person = s.match(PERSON);
  if (person) {
    dims.people = true;
    hits.push(`people: "${person[0].trim().slice(0, 40)}"`);
  }
  const brand = s.match(BRAND);
  if (brand) {
    dims.brand = true;
    hits.push(`brand: "${brand[0].trim().slice(0, 40)}"`);
  }

  // Priority order for the single approval subtype.
  const subtype = dims.metrics ? "metrics" : dims.people ? "people" : dims.brand ? "brand" : null;
  return { sensitive: !!subtype, subtype, hits, dimensions: dims };
}

module.exports = { scan };
