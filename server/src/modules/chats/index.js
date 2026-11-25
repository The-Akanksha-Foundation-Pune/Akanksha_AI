// Chats module: conversations and messages live in the AI database, per user.
// Also: running summary per conversation (compaction) and reuse of an identical recent answer.
import { Router } from 'express';
import crypto from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { appPool, appWrite, getNumberSetting } from '../../appDb.js';

const client = new Anthropic();
const SUMMARY_PREFIX = 'Summary of the earlier part of this conversation:';

export async function ownConversation(userId, id) {
  if (!id) return null;
  const [[row]] = await appPool().query('SELECT * FROM conversations WHERE id = ? AND user_id = ?', [id, userId]);
  return row || null;
}

export async function createConversation(userId, database, title = 'New chat') {
  const id = crypto.randomUUID();
  await appPool().query('INSERT INTO conversations (id, user_id, title, database_name) VALUES (?, ?, ?, ?)', [id, userId, title, database]);
  return { id, user_id: userId, title, database_name: database };
}

export async function addMessage({ id, conversationId, role, content, status = 'complete', error = null }) {
  const mid = id || crypto.randomUUID();
  await appPool().query('INSERT INTO messages (id, conversation_id, role, content, status, error) VALUES (?, ?, ?, ?, ?, ?)', [mid, conversationId, role, content, status, error]);
  return mid;
}

export async function finishMessage(id, { content, status = 'complete', error = null }) {
  await appWrite('UPDATE messages SET content = ?, status = ?, error = ? WHERE id = ?', [content, status, error, id]);
}

export async function touchConversation(id, { title, model } = {}) {
  await appWrite('UPDATE conversations SET updated_at = NOW(), title = COALESCE(?, title), model = COALESCE(?, model) WHERE id = ?', [title || null, model || null, id]);
}

// Auto mode may move a chat to another database when a later question is about different data.
export async function setConversationDatabase(id, database) {
  await appWrite('UPDATE conversations SET database_name = ?, updated_at = NOW() WHERE id = ?', [database, id]);
}

// History for the model: the latest summary (if any) + every turn after it, capped to the last N turns.
// Long Markdown tables in earlier answers are cut down before they go back to the model: it only needs the shape.
const HISTORY_TABLE_ROWS = 12;
export function compactTables(text) {
  const out = [];
  let run = [];
  const flush = () => {
    if (run.length > HISTORY_TABLE_ROWS + 6) {
      out.push(...run.slice(0, HISTORY_TABLE_ROWS), `[… ${run.length - HISTORY_TABLE_ROWS} more rows of this table were shown to the user]`);
    } else out.push(...run);
    run = [];
  };
  for (const line of String(text || '').split('\n')) {
    if (line.trimStart().startsWith('|')) run.push(line);
    else { flush(); out.push(line); }
  }
  flush();
  return out.join('\n');
}

export async function buildHistory(conversationId, historyTurns) {
  const [rows] = await appPool().query(
    "SELECT id, role, content, status, created_at FROM messages WHERE conversation_id = ? AND status IN ('complete','streaming') ORDER BY created_at, id",
    [conversationId],
  );
  let summary = null;
  let turns = [];
  for (const m of rows) {
    if (m.role === 'system') { summary = m.content; turns = []; continue; }
    if (m.role === 'assistant' && m.status !== 'complete') continue;
    turns.push({ role: m.role, content: m.role === 'assistant' ? compactTables(m.content) : m.content });
  }
  // drop a trailing empty assistant placeholder and keep the last N pairs
  while (turns.length && turns[turns.length - 1].role === 'assistant' && !turns[turns.length - 1].content) turns.pop();
  turns = turns.slice(-(historyTurns * 2));
  if (turns[0]?.role !== 'user') turns.shift();
  return { summary, turns, totalTurns: rows.filter((m) => m.role !== 'system').length };
}

// After an answer: if the un-summarised part is long, fold the older half into a summary row (Haiku, cheap).
export async function maybeCompact(conversationId, historyTurns) {
  try {
    const [rows] = await appPool().query(
      "SELECT id, role, content, created_at FROM messages WHERE conversation_id = ? AND status = 'complete' ORDER BY created_at, id",
      [conversationId],
    );
    let lastSummary = -1;
    rows.forEach((m, i) => { if (m.role === 'system') lastSummary = i; });
    const since = rows.slice(lastSummary + 1);
    if (since.length <= historyTurns * 2 + 4) return false;
    const keep = historyTurns * 2;
    const older = since.slice(0, since.length - keep);
    const prior = lastSummary >= 0 ? rows[lastSummary].content.replace(SUMMARY_PREFIX, '').trim() : '';
    const transcript = older.map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 2000)}`).join('\n\n');
    const r = await client.messages.create({
      model: 'claude-haiku-5-5',
      max_tokens: 600,
      system: 'Summarise this data-analysis conversation for the assistant that will continue it. Keep: the questions asked, the definitions and filters agreed, the key numbers found with their table or query, and anything the user asked to remember. Plain prose, under 250 words, no preamble.',
      messages: [{ role: 'user', content: (prior ? `Earlier summary:\n${prior}\n\nNew part:\n` : '') + transcript }],
    });
    const text = r.content.find((b) => b.type === 'text')?.text?.trim();
    if (!text) return false;
    // the summary row must sort after the messages it covers and before the kept ones
    const at = older[older.length - 1].created_at;
    await appPool().query('INSERT INTO messages (id, conversation_id, role, content, status, created_at) VALUES (?, ?, ?, ?, ?, DATE_ADD(?, INTERVAL 1 MICROSECOND))',
      [crypto.randomUUID(), conversationId, 'system', `${SUMMARY_PREFIX}\n${text}`, 'complete', at]);
    return true;
  } catch (err) {
    console.warn('compaction skipped:', err.message);
    return false;
  }
}

// An identical question by the same person on the same database, answered recently and not thumbed down.
// The answer must be the direct reply to that question: an assistant row after it with no other question in
// between. (Until 25 Nov 2026 this took the latest answer in the same chat, so a question followed by other
// questions got the last one's answer back.) `notBefore` leaves out answers written before the rules file last
// changed, so a corrected rule is not hidden behind an old answer.
export async function findRecentAnswer(userId, database, question, hours, notBefore = null) {
  if (!hours) return null;
  const [rows] = await appPool().query(
    `SELECT a.id, a.content, a.created_at
       FROM messages u
       JOIN conversations c ON c.id = u.conversation_id
       JOIN messages a ON a.conversation_id = u.conversation_id AND a.role = 'assistant' AND a.status = 'complete' AND a.created_at >= u.created_at
       LEFT JOIN feedback f ON f.message_id = a.id AND f.rating = -1
      WHERE c.user_id = ? AND c.database_name = ? AND u.role = 'user' AND LOWER(TRIM(u.content)) = LOWER(TRIM(?))
        AND a.created_at >= NOW() - INTERVAL ? HOUR AND a.created_at >= ? AND f.id IS NULL
        AND NOT EXISTS (SELECT 1 FROM messages x
                         WHERE x.conversation_id = u.conversation_id AND x.role = 'user' AND x.id <> u.id
                           AND x.created_at >= u.created_at AND x.created_at <= a.created_at)
      ORDER BY a.created_at DESC LIMIT 1`,
    [userId, database, question, hours, notBefore || new Date(0)],
  );
  const hit = rows[0];
  return hit && hit.content?.trim() ? hit : null;
}

const router = Router();

router.get('/', async (req, res) => {
  try {
    const [rows] = await appPool().query(
      `SELECT c.id, c.title, c.database_name, c.model, c.updated_at, c.created_at,
              (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.role <> 'system') AS message_count
         FROM conversations c WHERE c.user_id = ? AND c.is_archived = 0 ORDER BY c.updated_at DESC LIMIT 50`, [req.user.id]);
    res.json({ conversations: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const database = String(req.body?.database || '');
    if (!database) return res.status(400).json({ error: 'database is required' });
    res.json({ conversation: await createConversation(req.user.id, database) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const conv = await ownConversation(req.user.id, req.params.id);
    if (!conv) return res.status(404).json({ error: 'No such chat' });
    const [msgs] = await appPool().query("SELECT id, role, content, status, error, created_at FROM messages WHERE conversation_id = ? AND role <> 'system' ORDER BY created_at, id", [conv.id]);
    const ids = msgs.map((m) => m.id);
    let runs = [], fb = [], reqs = [];
    if (ids.length) {
      const ph = ids.map(() => '?').join(',');
      [runs] = await appPool().query(`SELECT id, message_id, sql_text, row_count, truncated, duration_ms, error FROM sql_runs WHERE message_id IN (${ph}) ORDER BY id`, ids);
      [fb] = await appPool().query(`SELECT message_id, rating FROM feedback WHERE message_id IN (${ph})`, ids);
      [reqs] = await appPool().query(`SELECT message_id, SUBSTRING_INDEX(GROUP_CONCAT(model ORDER BY id DESC), ',', 1) AS model, SUBSTRING_INDEX(GROUP_CONCAT(COALESCE(effort,'') ORDER BY id DESC), ',', 1) AS effort, SUM(cost_usd) AS cost_usd, SUM(latency_ms) AS latency_ms, COUNT(*) AS rounds FROM api_requests WHERE message_id IN (${ph}) GROUP BY message_id`, ids);
    }
    const fbMap = Object.fromEntries(fb.map((f) => [f.message_id, f.rating]));
    const metaMap = Object.fromEntries(reqs.map((r) => [r.message_id, { model: r.model, effort: r.effort || null, costUsd: Number(r.cost_usd) || 0, latencyMs: Number(r.latency_ms) || 0, rounds: Number(r.rounds) || 0 }]));
    const messages = msgs.map((m) => ({
      id: m.id, role: m.role, content: m.content, error: m.error || undefined,
      pending: false, feedback: fbMap[m.id] || 0, meta: metaMap[m.id] || null, createdAt: m.created_at,
      steps: runs.filter((r) => r.message_id === m.id).map((r) => ({ id: `run-${r.id}`, module: 'sql', tool: 'run_sql', status: r.error ? 'error' : 'done', error: r.error || undefined, ui: { sql: r.sql_text, rowCount: r.row_count, truncated: !!r.truncated, durationMs: r.duration_ms } })),
    }));
    res.json({ conversation: { id: conv.id, title: conv.title, database: conv.database_name, model: conv.model }, messages });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/title', async (req, res) => {
  const conv = await ownConversation(req.user.id, req.params.id);
  if (!conv) return res.status(404).json({ error: 'No such chat' });
  await touchConversation(conv.id, { title: String(req.body?.title || '').slice(0, 255) || null });
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  const conv = await ownConversation(req.user.id, req.params.id);
  if (!conv) return res.status(404).json({ error: 'No such chat' });
  await appPool().query('DELETE FROM conversations WHERE id = ?', [conv.id]); // messages cascade
  res.json({ ok: true });
});

export default { name: 'chats', order: 30, routes: router };
