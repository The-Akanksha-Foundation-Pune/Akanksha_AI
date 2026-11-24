// Decides, from a query result alone, whether it can be drawn and how. Runs server-side; costs no tokens.
const MAX_ROWS = 60;
const MAX_SERIES = 4;
const ID_RE = /(^|_)(id|code|uuid|key|phone|pincode|zip)$/i;

const isDateLike = (v) => v instanceof Date || (typeof v === 'string' && /^\d{4}-\d{2}(-\d{2})?/.test(v));
const toNum = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)) && !/^\d{4}-\d{2}/.test(v) ? Number(v) : null);
const toLabel = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? '(null)' : String(v));

export function suggestChart(allRows) {
  if (!Array.isArray(allRows) || !allRows.length) return null;
  const cols = Object.keys(allRows[0] || {});
  if (cols.length < 2) return null;

  const kind = {};
  for (const c of cols) {
    const vals = allRows.map((r) => r[c]).filter((v) => v != null);
    if (!vals.length) { kind[c] = 'empty'; continue; }
    if (vals.every(isDateLike)) kind[c] = 'date';
    else if (vals.every((v) => toNum(v) != null)) kind[c] = ID_RE.test(c) ? 'id' : 'number';
    else kind[c] = 'text';
  }

  const x = cols.find((c) => kind[c] === 'date') || cols.find((c) => kind[c] === 'text') || cols.find((c) => kind[c] === 'id');
  if (!x) return null;
  const rows = allRows.filter((r) => r[x] != null); // a NULL label has no place on an axis; the text answer still mentions it
  if (rows.length < 2 || rows.length > MAX_ROWS) return null;
  const ys = cols.filter((c) => c !== x && kind[c] === 'number').slice(0, MAX_SERIES);
  if (!ys.length) return null;

  const labels = rows.map((r) => toLabel(r[x]));
  if (new Set(labels).size !== labels.length) return null; // x must identify a row

  const data = rows.map((r) => [toLabel(r[x]), ...ys.map((c) => toNum(r[c]) ?? 0)]);
  // Skip results that carry no shape worth drawing: every value identical (a DISTINCT listing), or free-text labels.
  const informative = ys.some((_, i) => new Set(data.map((d) => d[i + 1])).size > 1);
  const medianLen = labels.map((l) => l.length).sort((a, b) => a - b)[Math.floor(labels.length / 2)];
  if (!informative || medianLen > 40) return null;
  const type = kind[x] === 'date' ? 'line' : rows.length > 8 ? 'hbar' : 'bar';
  return { type, x, y: ys, data };
}
