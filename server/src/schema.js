import { getPool, defaultDatabase } from './db.js';

const cache = new Map(); // database -> { tables, text, loadedAt }

export async function loadSchema(database = defaultDatabase(), force = false) {
  if (cache.has(database) && !force) return cache.get(database);
  const pool = getPool(database);
  const [tableRows] = await pool.query(
    `SELECT TABLE_NAME AS name, TABLE_ROWS AS \`rows\`, TABLE_TYPE AS type
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = ? AND TABLE_TYPE IN ('BASE TABLE', 'VIEW')
      ORDER BY TABLE_NAME`,
    [database],
  );
  const [colRows] = await pool.query(
    `SELECT TABLE_NAME AS tbl, COLUMN_NAME AS name, COLUMN_TYPE AS type, COLUMN_KEY AS \`key\`
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = ?
      ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [database],
  );
  const byTable = new Map(
    tableRows.map((t) => [t.name, { name: t.name, type: t.type === 'VIEW' ? 'view' : 'table', rows: t.type === 'VIEW' ? null : Number(t.rows ?? 0), columns: [], indexes: [] }]),
  );
  for (const c of colRows) byTable.get(c.tbl)?.columns.push({ name: c.name, type: c.type, key: c.key });
  // Secondary indexes (column lists in index order); optional, the schema still loads without them.
  try {
    const [idxRows] = await pool.query(
      `SELECT TABLE_NAME AS tbl, INDEX_NAME AS idx, COLUMN_NAME AS col
         FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ? AND INDEX_NAME <> 'PRIMARY'
        ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
      [database],
    );
    const byIndex = new Map();
    for (const r of idxRows) {
      const k = `${r.tbl}\u0000${r.idx}`;
      if (!byIndex.has(k)) byIndex.set(k, { tbl: r.tbl, cols: [] });
      byIndex.get(k).cols.push(r.col);
    }
    for (const { tbl, cols } of byIndex.values()) byTable.get(tbl)?.indexes.push(cols);
  } catch (err) {
    console.warn('index list unavailable:', err.message);
  }
  const tables = [...byTable.values()];
  const text = tables
    .map((t) => `${t.name} (${t.type === 'view' ? 'view' : `~${t.rows} rows`}): ` + t.columns.map((c) => `${c.name} ${c.type}${c.key === 'PRI' ? ' PK' : ''}`).join(', '))
    .join('\n');
  const entry = { database, tables, text, loadedAt: new Date().toISOString() };
  cache.set(database, entry);
  return entry;
}

export function clearSchemaCache() { cache.clear(); }

const FORBIDDEN = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|GRANT|REVOKE|LOCK|CALL|LOAD|SET|RENAME|HANDLER|USE)\b/i;

export async function runReadOnlySql(database, sql, { maxRows = 200, timeoutMs = 20000 } = {}) {
  const cleaned = String(sql).trim().replace(/;+\s*$/, '');
  if (cleaned.includes(';')) throw new Error('Only a single statement is allowed');
  if (!/^\s*(SELECT|WITH|SHOW|DESCRIBE|DESC|EXPLAIN)\b/i.test(cleaned)) throw new Error('Only read-only SELECT/SHOW/DESCRIBE queries are allowed');
  if (FORBIDDEN.test(cleaned)) throw new Error('Query contains a forbidden keyword');

  const conn = await getPool(database).getConnection();
  try {
    await conn.query(`SET SESSION MAX_EXECUTION_TIME = ${Math.floor(timeoutMs)}`);
    await conn.query('SET SESSION TRANSACTION READ ONLY');
    const [rows] = await conn.query(cleaned);
    const list = Array.isArray(rows) ? rows : [];
    return { rows: list.slice(0, maxRows), rowCount: list.length, truncated: list.length > maxRows, allRows: list.length > maxRows ? list.slice(0, 5000) : null };
  } finally {
    conn.release();
  }
}

// Compact rendering of a result for the model: CSV with trimmed cells, plus summary lines when rows were cut.
const CELL_MAX = 120;
const csvCell = (v) => {
  if (v == null) return '';
  let t = v instanceof Date ? v.toISOString().slice(0, 19).replace('T', ' ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (t.length > CELL_MAX) t = t.slice(0, CELL_MAX - 1) + '…';
  return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
};

export function renderResult(result, allRows) {
  const rows = result.rows;
  if (!rows.length) return 'No rows.';
  const cols = Object.keys(rows[0]);
  const lines = [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))];
  if (result.truncated && Array.isArray(allRows)) {
    const stats = cols.map((c) => {
      const nums = allRows.map((r) => (typeof r[c] === 'number' ? r[c] : Number(r[c]))).filter((n) => Number.isFinite(n));
      if (nums.length !== allRows.length || !nums.length) return null;
      const sum = nums.reduce((a, b) => a + b, 0);
      return `${c}: min ${Math.min(...nums)}, max ${Math.max(...nums)}, sum ${Number.isInteger(sum) ? sum : sum.toFixed(2)}`;
    }).filter(Boolean);
    lines.push('', `[${rows.length} of ${result.rowCount} rows shown. Totals over all ${result.rowCount} rows${stats.length ? ': ' + stats.join('; ') : ''}. Use GROUP BY or a tighter WHERE if you need the rest.]`);
  }
  return lines.join('\n');
}

// A query result as a Markdown table, printed to the user as-is (the model never retypes it).
const mdCell = (v) => {
  if (v == null) return '';
  let t = v instanceof Date ? v.toISOString().slice(0, 19).replace('T', ' ').replace(/ 00:00:00$/, '') : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (t.length > CELL_MAX) t = t.slice(0, CELL_MAX - 1) + '…';
  return t.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
};

export function renderMarkdownTable(rows, { title = '', total = rows.length } = {}) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const numeric = cols.map((c) => rows.every((r) => r[c] == null || typeof r[c] === 'number' || (typeof r[c] === 'string' && r[c].trim() !== '' && Number.isFinite(Number(r[c])))));
  const lines = [
    '| ' + cols.map(mdCell).join(' | ') + ' |',
    '| ' + cols.map((_, i) => (numeric[i] ? '---:' : '---')).join(' | ') + ' |',
    ...rows.map((r) => '| ' + cols.map((c) => mdCell(r[c])).join(' | ') + ' |'),
  ];
  const head = title ? `**${String(title).replace(/\s+/g, ' ').trim().slice(0, 120)}**\n\n` : '';
  const foot = total > rows.length ? `\n\n_Showing the first ${rows.length} of ${total} rows. Narrow the question to see the rest._` : '';
  return head + lines.join('\n') + foot;
}
