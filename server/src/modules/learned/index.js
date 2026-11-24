// Learned queries module: thumbs up on an answer stores question + SQL; similar future questions get them as examples.
import { Router } from 'express';
import { appPool, appWrite, getSetting, getNumberSetting } from '../../appDb.js';
import { requireRole } from '../auth/index.js';
import { runReadOnlySql } from '../../schema.js';

const TABLE_RE = /\b(?:FROM|JOIN)\s+`?([A-Za-z0-9_]+)`?/gi;
const tablesIn = (sql) => [...new Set([...String(sql).matchAll(TABLE_RE)].map((m) => m[1]))];

// Closest approved examples for a question in one database. Full-text first, LIKE on the longest words as a fallback.
export async function findExamples(database, question, limit = 3) {
  const q = String(question || '').trim();
  if (!q) return [];
  try {
    const [rows] = await appPool().query(
      `SELECT id, question, sql_text, MATCH(question) AGAINST (? IN NATURAL LANGUAGE MODE) AS score
         FROM learned_queries
        WHERE database_name = ? AND status = 'approved'
       HAVING score > 0
        ORDER BY score DESC, use_count DESC LIMIT ?`,
      [q, database, limit],
    );
    if (rows.length) return rows;
    const words = q.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3).sort((a, b) => b.length - a.length).slice(0, 3);
    if (!words.length) return [];
    const [like] = await appPool().query(
      `SELECT id, question, sql_text FROM learned_queries
        WHERE database_name = ? AND status = 'approved' AND (${words.map(() => 'question LIKE ?').join(' OR ')})
        ORDER BY use_count DESC LIMIT ?`,
      [database, ...words.map((w) => `%${w}%`), limit],
    );
    return like;
  } catch (err) {
    console.warn('learned lookup failed:', err.message);
    return [];
  }
}

const router = Router();

// POST /api/modules/learned/feedback
// { messageId, conversationId, database, question, rating: 1|-1, comment?, queries: [{sql, rowCount}] }
router.post('/feedback', async (req, res) => {
  const { messageId, conversationId, database, question, rating, comment, queries } = req.body || {};
  if (!messageId || !database || ![1, -1].includes(rating)) return res.status(400).json({ error: 'messageId, database and rating (1 or -1) are required' });
  try {
    await appPool().query(
      `INSERT INTO feedback (message_id, conversation_id, database_name, question, user_id, rating, comment)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE rating = VALUES(rating), comment = VALUES(comment), question = VALUES(question)`,
      [messageId, conversationId || null, database, question || null, req.user?.id ?? null, rating, comment || null],
    );
    let learned = null;
    const good = (Array.isArray(queries) ? queries : []).filter((x) => typeof x?.sql === 'string' && x.sql.trim() && !x.error);
    if (rating === 1 && question && good.length) {
      const sqlText = good.map((x) => x.sql.trim()).join('\n\n');
      const tables = [...new Set(good.flatMap((x) => tablesIn(x.sql)))];
      const autoApprove = (await getSetting('learned.auto_approve', '1')) !== '0';
      const [existing] = await appPool().query('SELECT id FROM learned_queries WHERE source_message_id = ?', [messageId]);
      if (existing.length) {
        await appPool().query("UPDATE learned_queries SET status = ?, question = ?, sql_text = ?, tables_used = ? WHERE id = ?",
          [autoApprove ? 'approved' : 'pending', question, sqlText, JSON.stringify(tables), existing[0].id]);
        learned = existing[0].id;
      } else {
        const [r] = await appPool().query(
          'INSERT INTO learned_queries (database_name, question, sql_text, tables_used, source_message_id, created_by, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [database, question, sqlText, JSON.stringify(tables), messageId, req.user?.id ?? null, autoApprove ? 'approved' : 'pending'],
        );
        learned = r.insertId;
      }
    } else if (rating === -1) {
      await appWrite("UPDATE learned_queries SET status = 'rejected' WHERE source_message_id = ?", [messageId]);
    }
    // Confirmed finding: keep the headline with the question and SQL, dated (needs migration 004; silently skipped before).
    const answer = String(req.body?.answer || '').trim();
    if (rating === 1 && question && answer) {
      const headline = answer.split(/\n\s*\n/)[0].replace(/[*_`#>]/g, '').trim().slice(0, 400);
      const sqlText = good.map((x) => x.sql.trim()).join('\n\n') || null;
      appWrite('INSERT INTO insights (database_name, question, headline, sql_text, message_id, user_id) VALUES (?, ?, ?, ?, ?, ?)', [database, question, headline, sqlText, messageId, req.user?.id ?? null]);
    }
    res.json({ ok: true, learnedId: learned });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/modules/learned/insights?q=&db=  -> confirmed findings, newest first (full-text when q is given)
router.get('/insights', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const db = req.query.db ? String(req.query.db) : null;
  try {
    const params = [];
    let where = '1=1';
    if (db) { where += ' AND i.database_name = ?'; params.push(db); }
    if (q) { where += ' AND MATCH(i.question, i.headline) AGAINST (? IN NATURAL LANGUAGE MODE)'; params.push(q); }
    const [rows] = await appPool().query(`SELECT i.id, i.database_name, i.question, i.headline, i.sql_text, i.created_at, u.email FROM insights i LEFT JOIN users u ON u.id = i.user_id WHERE ${where} ORDER BY i.created_at DESC LIMIT 100`, params);
    res.json({ insights: rows });
  } catch (err) {
    res.json({ insights: [], unavailable: /doesn't exist/i.test(err.message) ? 'Insights need migration 004' : err.message });
  }
});

// GET /api/modules/learned?db=NAME[&status=approved]  -> stored examples
router.get('/', async (req, res) => {
  try {
    const params = [];
    let where = '1=1';
    if (req.query.db) { where += ' AND database_name = ?'; params.push(String(req.query.db)); }
    if (req.query.status) { where += ' AND status = ?'; params.push(String(req.query.status)); }
    const [rows] = await appPool().query(`SELECT id, database_name, question, sql_text, tables_used, status, use_count, last_used_at, created_at FROM learned_queries WHERE ${where} ORDER BY created_at DESC LIMIT 200`, params);
    res.json({ queries: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/modules/learned/preview?db=NAME&q=question  -> what Claude would be shown for this question
router.get('/preview', async (req, res) => {
  const limit = await getNumberSetting('learned.max_examples', 3);
  res.json({ examples: await findExamples(String(req.query.db || ''), String(req.query.q || ''), limit) });
});

router.post('/:id/status', requireRole('admin'), async (req, res) => {
  const status = String(req.body?.status || '');
  if (!['approved', 'pending', 'rejected'].includes(status)) return res.status(400).json({ error: 'status must be approved, pending or rejected' });
  await appWrite('UPDATE learned_queries SET status = ? WHERE id = ?', [status, Number(req.params.id)]);
  res.json({ ok: true });
});

router.post('/verify', requireRole('admin'), async (req, res) => res.json(await verifyLearnedQueries()));

router.delete('/insights/:id', requireRole('admin'), async (req, res) => {
  await appWrite('DELETE FROM insights WHERE id = ?', [Number(req.params.id)]);
  res.json({ ok: true });
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  await appWrite('DELETE FROM learned_queries WHERE id = ?', [Number(req.params.id)]);
  res.json({ ok: true });
});

export default {
  name: 'learned',
  order: 20, // after the cached schema + glossary, because it changes with every question
  routes: router,
  hooks: {
    beforeRequest(ctx, { messages }) {
      const last = [...(messages || [])].reverse().find((m) => m.role === 'user');
      ctx.question = typeof last?.content === 'string' ? last.content : '';
    },
  },
  async prompt(ctx) {
    const limit = await getNumberSetting('learned.max_examples', 3);
    const examples = await findExamples(ctx.database, ctx.question, limit);
    if (!examples.length) return [];
    appWrite(`UPDATE learned_queries SET use_count = use_count + 1, last_used_at = NOW() WHERE id IN (${examples.map(() => '?').join(',')})`, examples.map((e) => e.id));
    const text = examples.map((e, i) => `Example ${i + 1}\nQuestion: ${e.question}\nSQL that answered it correctly:\n${e.sql_text}`).join('\n\n');
    return [{
      text: 'Past questions on this database that users confirmed were answered correctly, with the SQL used. Reuse their approach, adapting filters and columns to the new question:\n\n' + text,
    }];
  },
};

// Nightly: re-run every approved example with LIMIT 1. One that errors (schema drift) is retired to the queue.
export async function verifyLearnedQueries() {
  let checked = 0, retired = 0;
  try {
    const [rows] = await appPool().query("SELECT id, database_name, sql_text FROM learned_queries WHERE status = 'approved'");
    for (const r of rows) {
      checked++;
      const stmts = String(r.sql_text).split(/\n\n+/).map((x) => x.trim()).filter(Boolean);
      for (const stmt of stmts) {
        try { await runReadOnlySql(r.database_name, stmt.replace(/\bLIMIT\s+\d+\s*$/i, '') + ' LIMIT 1', { maxRows: 1, timeoutMs: 8000 }); }
        catch (err) { retired++; await appWrite("UPDATE learned_queries SET status = 'rejected' WHERE id = ?", [r.id]); console.warn(`learned #${r.id} retired: ${err.message}`); break; }
      }
    }
  } catch (err) { console.warn('learned verification skipped:', err.message); }
  console.log(`learned queries verified: ${checked} checked, ${retired} retired`);
  return { checked, retired };
}
const DAY = 24 * 3600e3;
setTimeout(() => { verifyLearnedQueries(); setInterval(verifyLearnedQueries, DAY); }, 2 * 60e3).unref();
