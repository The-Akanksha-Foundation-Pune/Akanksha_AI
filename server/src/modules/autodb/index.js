// Auto database module: picks the database for a new chat from the question, so the user does not have to
// choose one in the header. A small Haiku call reads a catalog (database name + its table names, limited to what
// this user may see) and answers with one name. The chat then runs against that single database as before;
// a conversation still never mixes schemas.
import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { listDatabases, defaultDatabase } from '../../db.js';
import { loadSchema } from '../../schema.js';
import { getSetting } from '../../appDb.js';
import { filterDatabases, allowedTableSet } from '../../access.js';
import { rulesText } from '../../rules.js';

const client = new Anthropic();
const MAX_TABLES_PER_DB = 80;
const CATALOG_TTL_MS = 10 * 60_000;
const catalogs = new Map(); // role -> { at, names, text }

// One-line descriptions that table names alone cannot convey. An app_settings key dbinfo.<name> overrides an entry.
// Sources: AFDW and tether_forms from the project notes; Netsuite and akanksha_production from test questions on
// 16 Nov 2026; the rest inferred the same day from table names, row counts and last-update times. Inferred lines are
// a best reading, not confirmed by the data owners: correct them here when one is wrong.
const DB_HINTS = {
  AFDW: 'main data warehouse and the current source for schools, students, enrolment, attendance and assessments (BOY/MOY/EOY, RAZ); attendance covers 2023-24 onwards; use it for any school or student question about those years or with no year given; its consultant_* tables are old copies, never use it for consultant questions',
  tether_forms: 'IT visit forms submitted by the technology team, plus the employees list (HR master: department, designation, joining date, manager)',
  Netsuite: 'historical student and attendance records from 2003-04 to 2023-24; use it only for attendance or student questions about academic years before 2023-24',
  akanksha_production: 'live alumni tracking, and the database every alumni question goes to (it also reads the akanksha database): alumni profiles, college and course by year, graduation, employment and income after school; no school assessments or attendance',
  akanksha: 'second set of the alumni tracking records, with some alumni that akanksha_production does not have; alumni questions still go to akanksha_production, which reads this one as well',
  Budget: 'budget versus actual spend: expense lines by donor, GL account code and organisation-wise budget; use for budget, utilisation and donor-wise expense',
  Finance: 'expense payment vouchers (EPV) and their approvals, items and allocations, payments, vendors, cost centres, expense heads and TDS; use for vouchers, vendor payments and finance entries',
  pazy: 'Pazy spend management: vendor invoices and their approval trail, employee expenses and reimbursements, corporate cards, purchase orders and tags',
  IT_helpdesk: 'IT helpdesk tickets with status, assignment, turnaround (TAT) events and SLA settings, plus the school-to-engineer mapping',
  TimeTable: 'school timetables: teachers, subjects, classes, period slots and teacher assignments per school',
  fams_mysql_dev: 'fixed asset management (development database): assets with IT details, locations, allocations, movements, repairs and verification cycles',
  consultant_mgmt: 'consultant management, and the only source for any question about consultants: consultants, engagements and rates, work reports, invoices and approvals',
  consultant_mgmt_test: 'test copy of consultant management with almost no data; do not use unless the question names it',
  dr_workspace: 'donor relations workspace: donors and their contacts, commitments, interactions, tasks and compliance documents',
  events_app: 'events calendar app (event types, cost centres, donor notifications); holds almost no event data yet',
  access_portal: 'access management portal: applications, roles, permissions and who holds which access',
};

// "name (N tables): t1, t2, …" per visible database. An optional app_settings key dbinfo.<name> adds a one-line description.
async function catalogFor(user) {
  const key = user.role;
  const hit = catalogs.get(key);
  if (hit && Date.now() - hit.at < CATALOG_TTL_MS) return hit;
  const { databases } = await listDatabases();
  const visible = await filterDatabases(user, databases);
  const lines = [];
  const names = [];
  for (const d of visible) {
    try {
      const schema = await loadSchema(d.name);
      const all = schema.tables.map((t) => t.name);
      const allowed = await allowedTableSet(user, d.name, all);
      // biggest tables first, so the ones that matter survive the cut and their size is visible
      const tables = schema.tables
        .filter((t) => !allowed || allowed.has(t.name))
        .sort((a, b) => (b.rows || 0) - (a.rows || 0))
        .map((t) => (t.rows >= 1000 ? `${t.name} (~${t.rows >= 1e6 ? (t.rows / 1e6).toFixed(1) + 'M' : Math.round(t.rows / 1000) + 'k'} rows)` : t.name));
      if (!tables.length) continue;
      const info = await getSetting(`dbinfo.${d.name}`, DB_HINTS[d.name] || '');
      const shown = tables.slice(0, MAX_TABLES_PER_DB).join(', ') + (tables.length > MAX_TABLES_PER_DB ? ', …' : '');
      lines.push(`${d.name} (${tables.length} tables)${info ? ` – ${info}` : ''}: ${shown}`);
      names.push(d.name);
    } catch (err) {
      console.warn(`autodb: skipped ${d.name}:`, err.message);
    }
  }
  const entry = { at: Date.now(), names, text: lines.join('\n') };
  catalogs.set(key, entry);
  return entry;
}

export async function pickDatabase(user, question, { current = '', previous = '' } = {}) {
  const { names, text } = await catalogFor(user);
  if (!names.length) throw new Error('No databases available');
  // In an ongoing chat the safe answer is to stay where the chat already is.
  const staying = current && names.includes(current) ? current : '';
  const fallback = staying || (names.includes(defaultDatabase()) ? defaultDatabase() : names[0]);
  if (names.length === 1) return { database: names[0], picked: false };
  const r = await client.messages.create({
    model: 'claude-haiku-5-5',
    max_tokens: 300,
    output_config: { effort: 'low' },
    system:
      'You route a question to the one MySQL database that most likely holds the data to answer it. ' +
      'Below is each database with a description where one exists, then its table names (largest first, with rough row counts). ' +
      'Trust a description over a table name: a similarly named table in another database may be old or about something else. ' +
      'Reply with only the database name, exactly as listed, and nothing else. ' +
      (staying
        ? `This is a follow-up in a conversation that is using ${staying}.${previous ? ` The previous question was: "${String(previous).replace(/\s+/g, ' ').slice(0, 300)}".` : ''} ` +
          `A follow-up that refines, breaks down, corrects or continues the previous question stays on ${staying}, as does anything short or ambiguous. ` +
          `Reply with another database only when the new question is clearly about a different kind of data that ${staying} does not hold. `
        : '') +
      `If none clearly fits, reply with ${fallback}.` +
      // server/prompts/RULES.md: the data owners' rules. They beat descriptions, table names and staying put.
      (rulesText() ? `\n\nRules from the data owners. A rule that names a database for a topic decides the answer, even for a follow-up, as long as that database is listed below:\n${rulesText()}` : '') +
      `\n\n${text}`,
    messages: [{ role: 'user', content: String(question).slice(0, 1500) }],
  });
  const answer = (r.content.find((b) => b.type === 'text')?.text || '').trim();
  // exact match first, then the longest listed name that appears in the reply
  const exact = names.find((n) => n.toLowerCase() === answer.toLowerCase().replace(/[`"'.\s]/g, ''));
  const loose = [...names].sort((a, b) => b.length - a.length).find((n) => new RegExp(`(^|[^A-Za-z0-9_])${n}([^A-Za-z0-9_]|$)`, 'i').test(answer));
  return { database: exact || loose || fallback, picked: !!(exact || loose) };
}

const routes = Router();

// POST /api/modules/autodb/pick { question, current?, previous? } -> { database, picked }
// current/previous describe an ongoing chat: the pick then stays on `current` unless the question is clearly about other data.
routes.post('/pick', async (req, res) => {
  const question = String(req.body?.question || '').trim();
  if (!question) return res.status(400).json({ error: 'question is required' });
  try {
    res.json(await pickDatabase(req.user, question, { current: String(req.body?.current || ''), previous: String(req.body?.previous || '') }));
  } catch (err) {
    console.warn('autodb: pick failed:', err.message);
    res.status(500).json({ error: 'Could not choose a database' });
  }
});

export default { name: 'autodb', order: 2, routes };
