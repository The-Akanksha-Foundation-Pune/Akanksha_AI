// Memory module: per-user preferences and notes (user_memory) and notes about tables (table_notes).
// Both tables arrive with migration 004; until then reads return nothing and writes say so.
import { Router } from 'express';
import { appPool, appWrite } from '../../appDb.js';
import { requireRole } from '../auth/index.js';

const MEMORY_KEYS = {
  answer_style: { label: 'Answer style', kind: 'select', options: ['concise', 'balanced', 'detailed'], def: 'balanced', help: 'How much explanation to include with the numbers.' },
  default_database: { label: 'Default database', kind: 'database', help: 'Opened when you start a new chat.' },
  notes: { label: 'Things to remember', kind: 'text', help: 'Short notes the assistant should keep in mind for you, e.g. "I look after the Pune schools" or "I prefer school acronyms".', max: 600 },
};

const missing = (err) => /doesn't exist|ER_NO_SUCH_TABLE/i.test(err.message);

export async function memoryFor(userId) {
  try {
    const [rows] = await appPool().query('SELECT memory_key, value FROM user_memory WHERE user_id = ?', [userId]);
    return Object.fromEntries(rows.map((r) => [r.memory_key, r.value]));
  } catch (err) {
    if (!missing(err)) console.warn('user_memory read failed:', err.message);
    return {};
  }
}

let notesCache = { at: 0, rows: [] };
export async function tableNotes(database, force = false) {
  if (force || Date.now() - notesCache.at > 30_000) {
    try {
      const [rows] = await appPool().query('SELECT id, database_name, table_name, note, is_active, updated_at FROM table_notes ORDER BY database_name, table_name');
      notesCache = { at: Date.now(), rows };
    } catch (err) {
      if (!missing(err)) console.warn('table_notes read failed:', err.message);
      notesCache = { at: Date.now(), rows: [] };
    }
  }
  return database ? notesCache.rows.filter((r) => r.database_name === database && r.is_active) : notesCache.rows;
}

const router = Router();

router.get('/me', async (req, res) => {
  res.json({ keys: MEMORY_KEYS, memory: await memoryFor(req.user.id) });
});

// POST /api/modules/memory/me { values: { answer_style, default_database, notes } }  (empty string clears)
router.post('/me', async (req, res) => {
  const values = req.body?.values || {};
  try {
    for (const [key, raw] of Object.entries(values)) {
      const def = MEMORY_KEYS[key];
      if (!def) return res.status(400).json({ error: `Unknown memory key ${key}` });
      let value = String(raw ?? '').trim();
      if (def.kind === 'select' && value && !def.options.includes(value)) return res.status(400).json({ error: `Invalid ${def.label}` });
      if (def.max) value = value.slice(0, def.max);
      if (!value) await appPool().query('DELETE FROM user_memory WHERE user_id = ? AND memory_key = ?', [req.user.id, key]);
      else {
        const [[ex]] = await appPool().query('SELECT id FROM user_memory WHERE user_id = ? AND memory_key = ?', [req.user.id, key]);
        if (ex) await appPool().query('UPDATE user_memory SET value = ?, source = ? WHERE id = ?', [value, 'user', ex.id]);
        else await appPool().query('INSERT INTO user_memory (user_id, memory_key, value, source) VALUES (?, ?, ?, ?)', [req.user.id, key, value, 'user']);
      }
    }
    res.json({ ok: true, memory: await memoryFor(req.user.id) });
  } catch (err) {
    res.status(missing(err) ? 409 : 500).json({ error: missing(err) ? 'Preferences need migration 004 (npm run migrate --prefix server)' : err.message });
  }
});

// Table notes (admins read; super admin writes via requireRole admin + settings in UI)
router.get('/tables', requireRole('admin'), async (req, res) => {
  res.json({ notes: await tableNotes(null, true) });
});
router.post('/tables', requireRole('admin'), async (req, res) => {
  const { database_name, table_name, note } = req.body || {};
  if (!database_name || !table_name) return res.status(400).json({ error: 'database_name and table_name are required' });
  try {
    if (!String(note || '').trim()) await appPool().query('DELETE FROM table_notes WHERE database_name = ? AND table_name = ?', [database_name, table_name]);
    else await appPool().query('INSERT INTO table_notes (database_name, table_name, note, created_by) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE note = VALUES(note), is_active = 1', [database_name, table_name, String(note).trim().slice(0, 1000), req.user.id]);
    res.json({ ok: true, notes: await tableNotes(null, true) });
  } catch (err) {
    res.status(missing(err) ? 409 : 500).json({ error: missing(err) ? 'Table notes need migration 004 (npm run migrate --prefix server)' : err.message });
  }
});

export default {
  name: 'memory',
  order: 18, // after schema and glossary (cached), before learned examples; per-user, so cached per user
  routes: router,
  async prompt(ctx) {
    if (!ctx.user) return [];
    const m = await memoryFor(ctx.user.id);
    const lines = [];
    if (m.answer_style === 'concise') lines.push('This user wants concise answers: the figures and one line of context, no explanation unless asked.');
    if (m.answer_style === 'detailed') lines.push('This user wants detailed answers: explain how the figures were computed and note caveats.');
    if (m.notes) lines.push(`Notes this user asked you to keep in mind: ${m.notes}`);
    return lines.length ? [{ text: 'About the person asking:\n' + lines.join('\n'), cache: true }] : [];
  },
};
