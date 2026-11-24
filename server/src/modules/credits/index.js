// Credits module: a prepaid dollar balance per person. Admins are exempt.
// On a person's first prompt they are granted the amount set for their role (credits.<role>.usd; 0 = no
// credit limit for that role). Every prompt's model cost (api_requests.cost_usd, written by the usage
// module) counts against it. At zero the gate refuses the prompt until a super admin adds more.
// Needs migration 005 (users.credit_usd, users.credit_started_at); without it the module does nothing.
import { Router } from 'express';
import { appPool, appWrite, getNumberSetting } from '../../appDb.js';
import { requireRole, requireSuperAdmin } from '../auth/index.js';

const DEFAULTS = { analyst: 5, viewer: 2 };
export const OVER_MESSAGE = 'Your credits are over. Please ask an admin to add more credits to keep using Prism.';

let columns = null;
export async function hasCreditColumns() {
  if (!columns) { // only a positive answer is cached, so applying the migration needs no restart
    const [rows] = await appPool().query("SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'credit_usd'");
    columns = Number(rows[0].n) > 0;
  }
  return columns;
}

const roleGrant = (role) => (role === 'admin' ? 0 : getNumberSetting(`credits.${role}.usd`, DEFAULTS[role] ?? DEFAULTS.viewer));

// History row (migration 006). appWrite never throws, so a missing table only loses the history line.
const logGrant = (userId, amount, kind, by) => appWrite('INSERT INTO credit_grants (user_id, amount_usd, kind, granted_by) VALUES (?, ?, ?, ?)', [userId, amount, kind, by]);

// Gives the role's amount once. The WHERE makes two prompts at the same moment grant only once.
async function ensureStarted(userId, role) {
  const grant = await roleGrant(role);
  if (grant <= 0) return false;
  const [r] = await appPool().query('UPDATE users SET credit_usd = ?, credit_started_at = NOW() WHERE id = ? AND credit_started_at IS NULL', [grant, userId]);
  if (r.affectedRows) logGrant(userId, grant, 'initial', null);
  return true;
}

const SPENT = 'COALESCE((SELECT SUM(r.cost_usd) FROM api_requests r WHERE r.user_id = u.id AND r.created_at >= u.credit_started_at), 0)';
const shape = (row) => {
  const granted = Number(row.credit_usd) || 0;
  const spent = Number(row.spent) || 0;
  return { granted, spent, balance: Math.max(0, granted - spent) };
};

// ---- Monthly refill (setting credits.monthly_refill, migration 007) ----
// On the first look at a person's credit in a new month (India time), a balance below the role's amount is
// brought back up to it. Credit above that (top-ups) is kept; nothing rolls over or stacks.
const IST_OFFSET_MS = 5.5 * 3600e3;
export function istMonthStart(now = Date.now()) {
  const ist = new Date(now + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - IST_OFFSET_MS);
}
const round4 = (n) => Math.round(n * 10000) / 10000;
const refillOn = async () => (await getNumberSetting('credits.monthly_refill', 0)) === 1;

// row: users columns + spent. Updates row.credit_usd in place when a refill was applied.
async function refillIfDue(userId, role, row) {
  try {
    if (!row.credit_started_at || !(await refillOn())) return;
    const monthStart = istMonthStart();
    if (new Date(row.credit_refilled_at || row.credit_started_at) >= monthStart) return; // already covered this month
    const grant = await roleGrant(role);
    if (grant <= 0) return;
    const granted = Number(row.credit_usd) || 0;
    const target = Math.max(granted, round4((Number(row.spent) || 0) + grant)); // total that leaves a balance of `grant`
    // The WHERE makes two requests at the same moment refill only once.
    const [r] = await appPool().query('UPDATE users SET credit_usd = ?, credit_refilled_at = NOW() WHERE id = ? AND COALESCE(credit_refilled_at, credit_started_at) < ?', [target, userId, monthStart]);
    if (!r.affectedRows) return;
    if (target > granted) await logGrant(userId, round4(target - granted), 'refill', null);
    row.credit_usd = target;
  } catch (err) {
    console.warn('credit refill skipped:', /credit_refilled_at/.test(err.message) ? 'needs migration 007' : err.message);
  }
}

// null = no credit limit applies to this person (admin, role amount 0, or migration 005 not applied).
export async function creditStatus(user, { start = false } = {}) {
  if (!user || user.role === 'admin' || !(await hasCreditColumns())) return null;
  const read = async () => (await appPool().query(`SELECT u.*, ${SPENT} AS spent FROM users u WHERE u.id = ?`, [user.id]))[0][0];
  let row = await read();
  if (!row) return null;
  if (!row.credit_started_at) {
    const grant = await roleGrant(user.role);
    if (grant <= 0) return null;
    if (!start) return { granted: grant, spent: 0, balance: grant }; // shown before the first prompt
    await ensureStarted(user.id, user.role);
    row = await read();
  }
  await refillIfDue(user.id, user.role, row);
  return { ...shape(row), monthlyRefill: await refillOn() };
}

const router = Router();

router.get('/me', async (req, res) => {
  try { res.json({ credits: await creditStatus(req.user) }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// Admin page: every person's granted / spent / balance.
router.get('/users', requireRole('admin'), async (req, res) => {
  try {
    if (!(await hasCreditColumns())) return res.json({ enabled: false, users: {} });
    const [rows] = await appPool().query(`SELECT u.*, ${SPENT} AS spent FROM users u`);
    const users = {};
    for (const r of rows) if (r.role !== 'admin') await refillIfDue(r.id, r.role, r); // so the table is right on the 1st, before people sign in
    for (const r of rows) users[r.id] = r.role === 'admin' ? null : r.credit_started_at ? shape(r) : { pending: true, granted: await roleGrant(r.role), spent: 0, balance: await roleGrant(r.role) };
    res.json({ enabled: true, users });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/modules/credits/users/:id { add: 2.5 }   a negative amount takes credit away
router.post('/users/:id', requireSuperAdmin, async (req, res) => {
  try {
    if (!(await hasCreditColumns())) return res.status(409).json({ error: 'Credits need migration 005 (npm run migrate --prefix server)' });
    const add = Math.round(Number(req.body?.add) * 10000) / 10000;
    if (!Number.isFinite(add) || add === 0 || Math.abs(add) > 10000) return res.status(400).json({ error: 'Enter an amount in dollars, for example 5' });
    const [[target]] = await appPool().query('SELECT id, role FROM users WHERE id = ?', [Number(req.params.id)]);
    if (!target) return res.status(404).json({ error: 'No such user' });
    if (target.role === 'admin') return res.status(400).json({ error: 'Admins have no credit limit' });
    await ensureStarted(target.id, target.role); // a person who has not prompted yet keeps their role amount on top
    const [[before]] = await appPool().query('SELECT COALESCE(credit_usd, 0) AS total FROM users WHERE id = ?', [target.id]);
    const total = Math.max(0, Math.round((Number(before.total) + add) * 10000) / 10000); // the granted total never goes below zero
    await appPool().query('UPDATE users SET credit_usd = ?, credit_started_at = COALESCE(credit_started_at, NOW()) WHERE id = ?', [total, target.id]);
    const applied = Math.round((total - Number(before.total)) * 10000) / 10000;
    if (applied !== 0) await logGrant(target.id, applied, 'topup', req.user.id);
    res.json({ ok: true, credits: await creditStatus(target) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Admin page: the latest credit changes, newest first. Empty until migration 006 is applied.
router.get('/history', requireRole('admin'), async (req, res) => {
  try {
    const [rows] = await appPool().query(
      `SELECT g.id, g.created_at, g.amount_usd, g.kind, u.email, COALESCE(u.name, u.email) AS person, COALESCE(b.name, b.email) AS granted_by
         FROM credit_grants g JOIN users u ON u.id = g.user_id LEFT JOIN users b ON b.id = g.granted_by
        ORDER BY g.id DESC LIMIT 200`);
    res.json({ enabled: true, history: rows });
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') return res.json({ enabled: false, history: [] });
    res.status(500).json({ error: err.message });
  }
});

export default {
  name: 'credits',
  order: 6,
  routes: router,
  hooks: {
    // Runs before the stream starts, after the prompt quota.
    async gate(ctx) {
      if (!ctx.user) return;
      const s = await creditStatus(ctx.user, { start: true });
      if (!s) return;
      if (s.balance <= 0) {
        const err = new Error(OVER_MESSAGE);
        err.status = 402; err.credits = s; throw err;
      }
      ctx.credits = s;
    },
  },
};
