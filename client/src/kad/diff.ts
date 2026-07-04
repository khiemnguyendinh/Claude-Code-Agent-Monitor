/**
 * Minimal line-level diff (LCS-based) for the artifact version compare view
 * — 05-man-trao-doi-cong-viec.md §3 ("So sánh" toggle).
 */

export interface DiffLine {
  text: string;
  type: "same" | "added" | "removed";
}

function buildLcsTable(a: string[], b: string[]): number[][] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i];
    const nextRow = dp[i + 1];
    if (!row || !nextRow) continue;
    for (let j = m - 1; j >= 0; j--) {
      const diag = nextRow[j + 1] ?? 0;
      const down = nextRow[j] ?? 0;
      const right = row[j + 1] ?? 0;
      row[j] = a[i] === b[j] ? diag + 1 : Math.max(down, right);
    }
  }
  return dp;
}

export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const dp = buildLcsTable(a, b);
  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const ai = a[i];
    const bj = b[j];
    if (ai === undefined || bj === undefined) break;
    if (ai === bj) {
      result.push({ text: ai, type: "same" });
      i++;
      j++;
      continue;
    }
    const down = dp[i + 1]?.[j] ?? 0;
    const right = dp[i]?.[j + 1] ?? 0;
    if (down >= right) {
      result.push({ text: ai, type: "removed" });
      i++;
    } else {
      result.push({ text: bj, type: "added" });
      j++;
    }
  }
  while (i < a.length) {
    const ai = a[i];
    if (ai !== undefined) result.push({ text: ai, type: "removed" });
    i++;
  }
  while (j < b.length) {
    const bj = b[j];
    if (bj !== undefined) result.push({ text: bj, type: "added" });
    j++;
  }
  return result;
}
