// Glossary module: shared metric definitions that go into the prompt so every answer uses the same meaning.
import { Router } from 'express';
import { appPool } from '../../appDb.js';
import { requireRole } from '../auth/index.js';

let cache = { at: 0, rows: [] };
const TTL = 30_000;

async function allDefinitions(force = false) {
  if (!force && Date.now() - cache.at < TTL) return cache.rows;
  try {
    const [rows] = await appPool().query('SELECT id, database_name, term, definition, sql_hint, is_active, updated_at FROM metric_definitions ORDER BY term');
    cache = { at: Date.now(), rows };
  } catch (err) {
    console.warn('glossary unavailable:', err.message);
    cache.at = Date.now();
  }
  return cache.rows;
}

const forDb = (rows, db) => rows.filter((r) => r.is_active && (r.database_name == null || r.database_name === db));

const router = Router();

// GET /api/modules/glossary?db=NAME  -> definitions that apply to that database (global ones included)
router.get('/', async (req, res) => {
  const rows = await allDefinitions(req.query.refresh === '1');
  const db = req.query.db ? String(req.query.db) : null;
  res.json({ definitions: db ? rows.filter((r) => r.database_name == null || r.database_name === db) : rows });
});

// POST /api/modules/glossary  { id?, database_name|null, term, definition, sql_hint?, is_active? }
router.post('/', requireRole('admin', 'analyst'), async (req, res) => {
  const { id, database_name, term, definition, sql_hint, is_active } = req.body || {};
  if (!term?.trim() || !definition?.trim()) return res.status(400).json({ error: 'term and definition are required' });
  try {
    if (id) {
      await appPool().query('UPDATE metric_definitions SET database_name = ?, term = ?, definition = ?, sql_hint = ?, is_active = ? WHERE id = ?',
        [database_name || null, term.trim(), definition.trim(), sql_hint?.trim() || null, is_active === false ? 0 : 1, id]);
    } else {
      await appPool().query('INSERT INTO metric_definitions (database_name, term, definition, sql_hint) VALUES (?, ?, ?, ?)',
        [database_name || null, term.trim(), definition.trim(), sql_hint?.trim() || null]);
    }
    const rows = await allDefinitions(true);
    res.json({ ok: true, definitions: rows });
  } catch (err) {
    res.status(err.code === 'ER_DUP_ENTRY' ? 409 : 500).json({ error: err.code === 'ER_DUP_ENTRY' ? 'That term already exists for this database' : err.message });
  }
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    await appPool().query('DELETE FROM metric_definitions WHERE id = ?', [Number(req.params.id)]);
    res.json({ ok: true, definitions: await allDefinitions(true) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default {
  name: 'glossary',
  order: 15, // after the schema block, before per-question examples, so it stays inside the cached prefix
  routes: router,
  async prompt(ctx) {
    const defs = forDb(await allDefinitions(), ctx.database);
    if (!defs.length) return [];
    const lines = defs.map((d) => `- ${d.term}: ${d.definition}${d.sql_hint ? ` (SQL: ${d.sql_hint})` : ''}`);
    return [{
      text: 'Agreed definitions for this database. When a question uses one of these terms, apply the definition exactly and say so briefly:\n' + lines.join('\n'),
      cache: true,
    }];
  },
};
