// Admin module: usage, quality and the learned-query approval queue. Read-only summaries over the AI database.
import { Router } from 'express';
import { appPool, allSettings, getNumberSetting } from '../../appDb.js';
import { requireRole, requireSuperAdmin } from '../auth/index.js';
import { loadSchema } from '../../schema.js';
import { listDatabases } from '../../db.js';
import { scopeFor } from '../../access.js';

const router = Router();
router.use(requireRole('admin'));

// GET /api/modules/admin/summary?days=30
router.get('/summary', async (req, res) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  const pool = appPool();
  try {
    const [daily] = await pool.query(
      `SELECT DATE_FORMAT(day, '%Y-%m-%d') AS day, SUM(requests) AS requests, SUM(conversations) AS conversations,
              SUM(input_tokens + cache_read_tokens + cache_write_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
              SUM(thinking_tokens) AS thinking_tokens, ROUND(SUM(cost_usd), 4) AS cost_usd
         FROM v_daily_usage WHERE day >= CURDATE() - INTERVAL ? DAY GROUP BY day ORDER BY day`, [days]);
    const [byModel] = await pool.query(
      `SELECT r.model, COUNT(*) AS requests, COUNT(DISTINCT r.message_id) AS answers, ROUND(SUM(r.cost_usd), 4) AS cost_usd,
              ROUND(SUM(r.cost_usd) / NULLIF(COUNT(DISTINCT r.message_id), 0), 4) AS cost_per_answer, ROUND(AVG(r.latency_ms)) AS avg_latency_ms
         FROM api_requests r WHERE r.created_at >= CURDATE() - INTERVAL ? DAY GROUP BY r.model ORDER BY cost_usd DESC`, [days]);
    const [byUser] = await pool.query(
      `SELECT COALESCE(u.email, '(not signed in)') AS user, COUNT(*) AS requests, COUNT(DISTINCT r.conversation_id) AS conversations,
              SUM(r.input_tokens + r.cache_read_tokens + r.cache_write_tokens) AS input_tokens, SUM(r.output_tokens) AS output_tokens,
              ROUND(SUM(r.cost_usd), 4) AS cost_usd, MAX(r.created_at) AS last_request
         FROM api_requests r LEFT JOIN users u ON u.id = r.user_id
        WHERE r.created_at >= CURDATE() - INTERVAL ? DAY GROUP BY u.email ORDER BY cost_usd DESC`, [days]);
    const [[totals]] = await pool.query(
      `SELECT COUNT(*) AS requests, COUNT(DISTINCT conversation_id) AS conversations, COUNT(DISTINCT message_id) AS answers,
              ROUND(SUM(cost_usd), 4) AS cost_usd, ROUND(AVG(latency_ms)) AS avg_latency_ms,
              ROUND(100 * SUM(cache_read_tokens) / NULLIF(SUM(input_tokens + cache_read_tokens + cache_write_tokens), 0), 1) AS cache_hit_pct
         FROM api_requests WHERE created_at >= CURDATE() - INTERVAL ? DAY`, [days]);
    const [[fb]] = await pool.query(
      `SELECT COUNT(*) AS total, SUM(rating = 1) AS up, SUM(rating = -1) AS down FROM feedback WHERE created_at >= CURDATE() - INTERVAL ? DAY`, [days]);
    const [slowest] = await pool.query(
      `SELECT s.id, s.database_name, s.sql_text, s.row_count, s.duration_ms, s.created_at, u.email
         FROM sql_runs s LEFT JOIN users u ON u.id = s.user_id
        WHERE s.created_at >= CURDATE() - INTERVAL ? DAY AND s.error IS NULL ORDER BY s.duration_ms DESC LIMIT 10`, [days]);
    const [failed] = await pool.query(
      `SELECT s.id, s.database_name, s.sql_text, s.error, s.created_at, u.email
         FROM sql_runs s LEFT JOIN users u ON u.id = s.user_id
        WHERE s.created_at >= CURDATE() - INTERVAL ? DAY AND s.error IS NOT NULL ORDER BY s.created_at DESC LIMIT 10`, [days]);
    const [[sqlTotals]] = await pool.query(
      `SELECT COUNT(*) AS runs, SUM(error IS NOT NULL) AS failed, ROUND(AVG(duration_ms)) AS avg_ms FROM sql_runs WHERE created_at >= CURDATE() - INTERVAL ? DAY`, [days]);
    const [queue] = await pool.query(
      `SELECT l.id, l.database_name, l.question, l.sql_text, l.tables_used, l.status, l.use_count, l.created_at, u.email
         FROM learned_queries l LEFT JOIN users u ON u.id = l.created_by
        ORDER BY FIELD(l.status, 'pending', 'approved', 'rejected'), l.created_at DESC LIMIT 100`);
    // Alerts for today (IST day boundary approximated by server date)
    const [[today]] = await pool.query(
      `SELECT (SELECT ROUND(COALESCE(SUM(cost_usd),0),4) FROM api_requests WHERE created_at >= CURDATE()) AS cost,
              (SELECT COUNT(*) FROM sql_runs WHERE created_at >= CURDATE() AND error IS NOT NULL) AS failed,
              (SELECT COUNT(*) FROM feedback WHERE created_at >= CURDATE() AND rating = -1) AS down`);
    const limits = { cost: await getNumberSetting('alerts.daily_cost_usd', 5), failed: await getNumberSetting('alerts.failed_queries', 10), down: await getNumberSetting('alerts.thumbs_down', 3) };
    const alerts = [];
    if (limits.cost > 0 && Number(today.cost) >= limits.cost) alerts.push({ level: 'warn', text: `Spend today is $${Number(today.cost).toFixed(2)}, over the $${limits.cost} alert level.` });
    if (limits.failed > 0 && Number(today.failed) >= limits.failed) alerts.push({ level: 'warn', text: `${today.failed} queries failed today (alert level ${limits.failed}). Check the failed queries list.` });
    if (limits.down > 0 && Number(today.down) >= limits.down) alerts.push({ level: 'bad', text: `${today.down} answers were thumbed down today (alert level ${limits.down}).` });
    res.json({ days, totals, feedback: { total: Number(fb.total) || 0, up: Number(fb.up) || 0, down: Number(fb.down) || 0 }, sql: sqlTotals, daily, byModel, byUser, slowest, failed, queue, alerts, today });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Settings an admin may edit from the page, grouped for the UI. Everything else in app_settings stays code-managed.
// kind: number | boolean ('1'/'0') | select (options)
const EDITABLE = [
  // Prompt limits
  { key: 'quota.admin.per_day', group: 'Prompt limits', role: 'admin', field: 'per_day', label: 'Admin · per day', kind: 'number', def: 0, help: '0 = unlimited' },
  { key: 'quota.admin.per_hour', group: 'Prompt limits', role: 'admin', field: 'per_hour', label: 'Admin · per hour', kind: 'number', def: 0, help: '0 = unlimited' },
  { key: 'quota.analyst.per_day', group: 'Prompt limits', role: 'analyst', field: 'per_day', label: 'Analyst · per day', kind: 'number', def: 100 },
  { key: 'quota.analyst.per_hour', group: 'Prompt limits', role: 'analyst', field: 'per_hour', label: 'Analyst · per hour', kind: 'number', def: 30 },
  { key: 'quota.viewer.per_day', group: 'Prompt limits', role: 'viewer', field: 'per_day', label: 'Viewer · per day', kind: 'number', def: 30 },
  { key: 'quota.viewer.per_hour', group: 'Prompt limits', role: 'viewer', field: 'per_hour', label: 'Viewer · per hour', kind: 'number', def: 10 },
  // Credits
  { key: 'credits.analyst.usd', group: 'Credits', label: 'Analyst · starting credit (USD)', kind: 'number', def: 5, min: 0, max: 10000, help: 'Dollars an analyst gets on their first prompt. The model cost of each prompt is taken from it; at zero they cannot ask until a super admin adds more in the Users table. 0 = no credit limit for analysts. Changing this does not change people who already have their credit.' },
  { key: 'credits.viewer.usd', group: 'Credits', label: 'Viewer · starting credit (USD)', kind: 'number', def: 2, min: 0, max: 10000, help: 'Same for viewers. Admins never have a credit limit.' },
  { key: 'credits.monthly_refill', group: 'Credits', label: 'Refill every month', kind: 'boolean', def: 0, help: 'On: on the 1st of each month (India time) anyone whose credit is below their role\'s starting amount is brought back up to it. Credit above that amount is kept; unused credit does not stack. Off: credit is one-time, plus whatever a super admin adds.' },
  // Model
  { key: 'router.enabled', group: 'Model', label: 'Pick the model per question', kind: 'boolean', def: 1, help: 'Haiku reads each question and labels it lookup, aggregate or analysis. Each label has its own model below, so cheap questions stay cheap and hard ones get the strongest model.' },
  { key: 'router.lookup_model', group: 'Model', label: 'Lookups (find rows, describe a table, simple counts)', kind: 'select', options: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'], def: 'claude-haiku-5-5' },
  { key: 'router.aggregate_model', group: 'Model', label: 'Aggregates (group, sum, compare, a join or two)', kind: 'select', options: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'], def: 'claude-sonnet-5-5' },
  { key: 'router.analysis_model', group: 'Model', label: 'Analysis (multi-step, several joins, why questions)', kind: 'select', options: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'], def: 'claude-opus-5-5' },
  { key: 'max_tokens', group: 'Model', label: 'Longest answer (tokens)', kind: 'number', def: 16000, min: 500, max: 64000, help: 'Caps how long one answer can be, thinking included. 16000 fits a table of roughly 300 rows; an answer that hits the cap shows a Continue button.' },
  { key: 'default_effort', group: 'Model', label: 'Thinking effort when routing is off', kind: 'select', options: ['low', 'medium', 'high', 'xhigh', 'max'], def: 'medium', help: 'Used only when the per-question picker above is off. With routing on, lookups and aggregates run at low effort and analysis at medium.' },
  { key: 'max_tool_rounds', group: 'Model', label: 'Queries per answer', kind: 'number', def: 8, min: 1, max: 20, help: 'How many SQL queries Claude may run for one answer before it must reply.' },
  { key: 'table.max_rows', group: 'Model', label: 'Rows in a printed table', kind: 'number', def: 1000, min: 50, max: 5000, help: 'When Claude asks the app to print a query result as a table under the answer, at most this many rows are shown. These rows cost no tokens.' },
  { key: 'max_rows_per_query', group: 'Model', label: 'Rows per query', kind: 'number', def: 50, min: 10, max: 1000, help: 'Rows returned to Claude from each query as CSV. Bigger results are cut and totals appended. Fewer rows means fewer tokens.' },
  { key: 'history_turns', group: 'Model', label: 'Conversation memory', kind: 'number', def: 10, min: 1, max: 50, help: 'How many past question/answer pairs are sent with each new question.' },
  // Answers
  { key: 'answers.cache_hours', group: 'Answers', label: 'Reuse an identical answer for (hours)', kind: 'number', def: 24, min: 0, max: 168, help: 'If the same person asks the exact same question on the same database within this window, the earlier answer is shown again at no cost. 0 turns it off.' },
  { key: 'charts.enabled', group: 'Answers', label: 'Charts in answers', kind: 'boolean', def: 0, help: 'Draw a chart under an answer when a query result has a label column and numbers. Costs no tokens.' },
  // Alerts
  { key: 'alerts.daily_cost_usd', group: 'Alerts', label: 'Daily spend alert (USD)', kind: 'number', def: 5, min: 0, max: 1000, help: 'The Admin page shows a warning when today\'s spend passes this. 0 turns it off.' },
  { key: 'alerts.failed_queries', group: 'Alerts', label: 'Failed queries per day alert', kind: 'number', def: 10, min: 0, max: 1000 },
  { key: 'alerts.thumbs_down', group: 'Alerts', label: 'Thumbs down per day alert', kind: 'number', def: 3, min: 0, max: 1000 },
  // Learning
  { key: 'learned.auto_approve', group: 'Learning', label: 'Thumbs up approves at once', kind: 'boolean', def: 1, help: 'On: a thumbs up makes the question and SQL usable as an example immediately. Off: it waits in the approval queue below.' },
  { key: 'learned.max_examples', group: 'Learning', label: 'Examples per question', kind: 'number', def: 3, min: 0, max: 10, help: 'How many confirmed past questions Claude is shown for a similar new question.' },
];
const GROUPS = ['Prompt limits', 'Credits', 'Model', 'Answers', 'Learning', 'Alerts'];

function normalise(def, raw) {
  if (def.kind === 'boolean') return raw === true || raw === 1 || raw === '1' || raw === 'true' ? '1' : '0';
  if (def.kind === 'select') return def.options.includes(String(raw)) ? String(raw) : null;
  let n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return null;
  if (def.min != null) n = Math.max(def.min, n);
  if (def.max != null) n = Math.min(def.max, n);
  return String(Math.max(0, n));
}

const withValues = (map) => ({ groups: GROUPS, settings: EDITABLE.map((e) => ({ ...e, value: map.get(e.key) ?? String(e.def) })) });

router.get('/settings', async (req, res) => {
  res.json(withValues(await allSettings(true)));
});

// POST /api/modules/admin/settings  { values: { key: value, ... } }
router.post('/settings', async (req, res) => {
  const values = req.body?.values || {};
  const bad = Object.keys(values).filter((k) => !EDITABLE.some((e) => e.key === k));
  if (bad.length) return res.status(400).json({ error: `Not editable: ${bad.join(', ')}` });
  try {
    for (const [key, raw] of Object.entries(values)) {
      const def = EDITABLE.find((e) => e.key === key);
      const value = normalise(def, raw);
      if (value == null) return res.status(400).json({ error: `Invalid value for ${def.label}` });
      await appPool().query(
        'INSERT INTO app_settings (setting_key, setting_value, description, updated_by) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)',
        [key, value, def.label, req.user.id],
      );
    }
    res.json({ ok: true, ...withValues(await allSettings(true)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Which tables the model may query, per database ----
// GET /api/modules/admin/scope?db=NAME -> every table with included flag
router.get('/scope', async (req, res) => {
  try {
    const { databases } = await listDatabases();
    const db = String(req.query.db || databases[0]?.name || '');
    if (!databases.some((d) => d.name === db)) return res.status(400).json({ error: 'Unknown database' });
    const schema = await loadSchema(db, req.query.refresh === '1');
    const scope = await scopeFor(db);
    res.json({
      database: db,
      databases: databases.map((d) => d.name),
      mode: scope ? 'selected' : 'all',
      tables: schema.tables.map((t) => ({ name: t.name, type: t.type, rows: t.rows, columns: t.columns.length, included: scope ? scope.has(t.name) : true, unknown: scope ? !scope.has(t.name) && false : false })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/modules/admin/scope { database, tables: [names] | null }   null = all tables
router.post('/scope', requireSuperAdmin, async (req, res) => {
  const { database, tables } = req.body || {};
  try {
    const { databases } = await listDatabases();
    if (!databases.some((d) => d.name === database)) return res.status(400).json({ error: 'Unknown database' });
    const key = `scope.${database}`;
    if (tables == null) {
      await appPool().query('DELETE FROM app_settings WHERE setting_key = ?', [key]);
    } else {
      if (!Array.isArray(tables)) return res.status(400).json({ error: 'tables must be an array or null' });
      const schema = await loadSchema(database);
      const known = new Set(schema.tables.map((t) => t.name));
      const list = [...new Set(tables.map(String).filter((t) => known.has(t)))];
      await appPool().query(
        'INSERT INTO app_settings (setting_key, setting_value, description, updated_by) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)',
        [key, JSON.stringify(list), `Tables the model may query in ${database}`, req.user.id],
      );
    }
    await allSettings(true);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Who asked what (super admins only; user request, 25 Nov 2026) ----
// Every question and answer is stored per person in `messages`. These two routes are the only place the app
// shows one person's questions to someone else, so they are limited to super admins, read-only, and the
// "What can I ask?" guide tells staff that their questions can be reviewed. Private messages between
// colleagues (people module) are not included.
const QUESTIONS_PAGE = 50;
const QUESTION_OF = `(SELECT q.content FROM messages q
                       WHERE q.conversation_id = a.conversation_id AND q.role = 'user' AND q.created_at <= a.created_at
                       ORDER BY q.created_at DESC LIMIT 1)`;

// GET /api/modules/admin/questions?days=7&user=<id>&q=<text>&offset=0
router.get('/questions', requireSuperAdmin, async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 365);
  const userId = Number(req.query.user) || 0;
  const search = String(req.query.q || '').trim().slice(0, 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  try {
    const pool = appPool();
    const where = ["a.role = 'assistant'", 'a.created_at >= NOW() - INTERVAL ? DAY'];
    const params = [days];
    if (userId) { where.push('c.user_id = ?'); params.push(userId); }
    const having = search ? 'HAVING question LIKE ?' : '';
    if (search) params.push(`%${search.replace(/[\\%_]/g, '\\$&')}%`);
    const [rows] = await pool.query(
      `SELECT a.id, a.status, a.created_at, c.database_name, u.id AS user_id, u.email, u.name,
              ${QUESTION_OF} AS question,
              LEFT(a.content, 220) AS preview,
              (SELECT SUBSTRING_INDEX(GROUP_CONCAT(r.model ORDER BY r.id DESC), ',', 1) FROM api_requests r WHERE r.message_id = a.id) AS model,
              (SELECT SUBSTRING_INDEX(GROUP_CONCAT(COALESCE(r.effort, '') ORDER BY r.id DESC), ',', 1) FROM api_requests r WHERE r.message_id = a.id) AS effort,
              (SELECT SUM(r.cost_usd) FROM api_requests r WHERE r.message_id = a.id) AS cost_usd,
              (SELECT COUNT(*) FROM sql_runs s WHERE s.message_id = a.id) AS queries,
              (SELECT f.rating FROM feedback f WHERE f.message_id = a.id ORDER BY f.id DESC LIMIT 1) AS rating
         FROM messages a
         JOIN conversations c ON c.id = a.conversation_id
         JOIN users u ON u.id = c.user_id
        WHERE ${where.join(' AND ')}
        ${having}
        ORDER BY a.created_at DESC
        LIMIT ${QUESTIONS_PAGE + 1} OFFSET ?`,
      [...params, offset],
    );
    const [people] = await pool.query(
      `SELECT u.id, u.email, u.name, COUNT(*) AS answers
         FROM messages a JOIN conversations c ON c.id = a.conversation_id JOIN users u ON u.id = c.user_id
        WHERE a.role = 'assistant' AND a.created_at >= NOW() - INTERVAL ? DAY
        GROUP BY u.id, u.email, u.name ORDER BY COALESCE(u.name, u.email)`,
      [days],
    );
    res.json({
      days, offset, pageSize: QUESTIONS_PAGE, more: rows.length > QUESTIONS_PAGE,
      people,
      questions: rows.slice(0, QUESTIONS_PAGE).map((r) => ({ ...r, cost_usd: r.cost_usd == null ? null : Number(r.cost_usd) })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/modules/admin/questions/:id -> the whole question and answer, with the queries that were run
router.get('/questions/:id', requireSuperAdmin, async (req, res) => {
  try {
    const pool = appPool();
    const [[a]] = await pool.query(
      `SELECT a.id, a.content, a.status, a.error, a.created_at, c.database_name, c.title, u.email, u.name,
              ${QUESTION_OF} AS question
         FROM messages a JOIN conversations c ON c.id = a.conversation_id JOIN users u ON u.id = c.user_id
        WHERE a.id = ? AND a.role = 'assistant'`,
      [String(req.params.id)],
    );
    if (!a) return res.status(404).json({ error: 'No such answer' });
    const [queries] = await pool.query('SELECT id, database_name, sql_text, row_count, duration_ms, error FROM sql_runs WHERE message_id = ? ORDER BY id', [a.id]);
    const [calls] = await pool.query('SELECT model, effort, round_no, stop_reason, input_tokens, cache_read_tokens, output_tokens, cost_usd, latency_ms, error FROM api_requests WHERE message_id = ? ORDER BY id', [a.id]);
    res.json({ answer: a, queries, calls });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default { name: 'admin', order: 95, routes: router };
