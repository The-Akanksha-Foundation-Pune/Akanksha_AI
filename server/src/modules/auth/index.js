// Auth module: who is asking. Google sign-in for the allowed domain (the same OAuth 2.0 code flow and the same
// Google OAuth app as Alumni Connect and Tether), or a labelled dev sign-in when Google is not configured. Sessions are HMAC-signed cookies; users live in the AI database.
import { Router } from 'express';
import crypto from 'node:crypto';
import { appPool } from '../../appDb.js';
import { allRules, invalidateRules } from '../../access.js';
import * as employees from '../../employees.js';

const COOKIE = 'akai_session';
const SESSION_DAYS = 14;
const ROLES = ['admin', 'analyst', 'viewer'];

const allowedDomain = () => (process.env.AUTH_ALLOWED_DOMAIN || 'akanksha.org').toLowerCase();
const superAdmins = () => (process.env.SUPER_ADMIN_EMAILS || 'nikhil.aher@akanksha.org').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
const googleClientId = () => process.env.GOOGLE_CLIENT_ID || '';
const googleClientSecret = () => process.env.GOOGLE_CLIENT_SECRET || '';
const frontendUrl = () => (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/+$/, '');
// Must be listed under "Authorised redirect URIs" on the Google OAuth client.
const googleCallbackUrl = () => process.env.GOOGLE_CALLBACK_URL || `${frontendUrl()}/api/modules/auth/google/callback`;
const authMode = () => (googleClientId() && googleClientSecret() ? 'google' : (process.env.AUTH_MODE || 'dev'));

let secret = process.env.JWT_SECRET;
if (!secret) { secret = crypto.randomBytes(32).toString('hex'); console.warn('JWT_SECRET is empty: sessions reset on every restart. Set it in .env.'); }

const sign = (data) => crypto.createHmac('sha256', secret).update(data).digest('base64url');
function makeToken(payload) { const body = Buffer.from(JSON.stringify(payload)).toString('base64url'); return `${body}.${sign(body)}`; }
function readToken(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = sign(body);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return p.exp > Date.now() ? p : null; } catch { return null; }
}
function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter(([k]) => k).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}
function setSession(res, user) {
  const token = makeToken({ uid: user.id, exp: Date.now() + SESSION_DAYS * 864e5 });
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`);
}

export const isSuperAdmin = (user) => !!user && superAdmins().includes(String(user.email).toLowerCase());
const publicUser = (u) => u && { id: u.id, email: u.email, name: u.name, role: u.role, isSuperAdmin: isSuperAdmin(u) };

// Signing in with an organisation account is not enough (same rule as Alumni Connect): a person must have been
// added in Admin > Access, or be a super admin. Nobody gets a users row just by signing in.
const NO_ACCESS = 'You have not been given access to Prism yet. Ask an admin to add you under Admin > Access.';
function refuse(code, message) { const err = new Error(message); err.reason = code; return err; }

async function upsertUser(email, name) {
  email = String(email).toLowerCase();
  const pool = appPool();
  const isSuper = superAdmins().includes(email);
  const [[existing]] = await pool.query('SELECT id, email, name, role, is_active FROM users WHERE email = ?', [email]);
  if (existing) {
    if (!existing.is_active && !isSuper) throw refuse('no_access', NO_ACCESS);
    const role = isSuper ? 'admin' : existing.role;
    await pool.query('UPDATE users SET name = COALESCE(name, ?), role = ?, is_active = 1, last_seen_at = NOW() WHERE id = ?', [name || null, role, existing.id]);
    return { ...existing, name: existing.name || name, role };
  }
  if (!isSuper) throw refuse('no_access', NO_ACCESS);
  const [r] = await pool.query('INSERT INTO users (email, name, role, last_seen_at) VALUES (?, ?, ?, NOW())', [email, name || null, 'admin']);
  return { id: r.insertId, email, name: name || null, role: 'admin', is_active: 1 };
}

async function userById(id) {
  const [[u]] = await appPool().query('SELECT * FROM users WHERE id = ? AND is_active = 1', [id]);
  return u || null;
}

// True once migration 003 has added the per-user quota columns.
let quotaColumns = null;
export async function hasQuotaColumns() {
  if (!quotaColumns) { // only a positive answer is cached, so applying the migration needs no restart
    const [rows] = await appPool().query("SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'quota_per_day'");
    quotaColumns = Number(rows[0].n) > 0;
  }
  return quotaColumns;
}

// Express middleware: attaches req.user or answers 401.
export async function requireUser(req, res, next) {
  try {
    const payload = readToken(parseCookies(req)[COOKIE]);
    const user = payload ? await userById(payload.uid) : null;
    if (!user) return res.status(401).json({ error: 'Sign in required' });
    req.user = user;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => (roles.includes(req.user?.role) ? next() : res.status(403).json({ error: 'Not allowed for your role' }));
}
export const requireSuperAdmin = (req, res, next) => (isSuperAdmin(req.user) ? next() : res.status(403).json({ error: 'Super admin only' }));

const router = Router();

router.get('/me', async (req, res) => {
  const payload = readToken(parseCookies(req)[COOKIE]);
  const user = payload ? await userById(payload.uid).catch(() => null) : null;
  res.json({ user: publicUser(user), mode: authMode(), domain: allowedDomain() });
});

// ---- Google sign-in: plain OAuth 2.0 code flow, as in Alumni Connect ----
// GET /google sends the browser to Google; GET /google/callback exchanges the code, checks the account is a
// verified one on the allowed domain, and sets the session cookie. The state value travels in a short-lived
// HttpOnly cookie (this app has no server-side session store) and is compared on the way back.
const STATE_COOKIE = 'akai_oauth';
const secureFlag = () => (process.env.NODE_ENV === 'production' ? '; Secure' : '');
const stateCookie = (value, maxAge) => `${STATE_COOKIE}=${value}; Path=/api/modules/auth; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureFlag()}`;

router.get('/google', (req, res) => {
  if (authMode() !== 'google') return res.redirect(`${frontendUrl()}/?signin=google_not_configured`);
  const state = crypto.randomBytes(16).toString('hex');
  res.setHeader('Set-Cookie', stateCookie(state, 600));
  const params = new URLSearchParams({
    client_id: googleClientId(),
    redirect_uri: googleCallbackUrl(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    hd: allowedDomain(), // asks Google to show only workspace accounts; verified again below
    prompt: 'select_account',
  });
  res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params.toString());
});

router.get('/google/callback', async (req, res) => {
  const deny = (reason) => { res.setHeader('Set-Cookie', stateCookie('', 0)); res.redirect(`${frontendUrl()}/?signin=${reason}`); };
  if (authMode() !== 'google') return deny('google_not_configured');
  const { code, state, error } = req.query;
  if (error) return deny('google_cancelled');
  const expected = parseCookies(req)[STATE_COOKIE];
  if (!code || !state || !expected || String(state) !== expected) return deny('google_state_mismatch');
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: String(code), client_id: googleClientId(), client_secret: googleClientSecret(), redirect_uri: googleCallbackUrl(), grant_type: 'authorization_code' }),
    });
    if (!tokenRes.ok) { console.error('[auth] google token exchange failed', tokenRes.status, await tokenRes.text()); return deny('google_failed'); }
    const { access_token } = await tokenRes.json();
    const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: 'Bearer ' + access_token } });
    if (!infoRes.ok) return deny('google_failed');
    const info = await infoRes.json();
    const email = String(info.email || '').trim().toLowerCase();
    if (!email || !info.email_verified || email.split('@')[1] !== allowedDomain()) return deny('wrong_domain');
    let user;
    try { user = await upsertUser(email, info.name); } catch (err) { if (err.reason) return deny(err.reason); throw err; }
    const token = makeToken({ uid: user.id, exp: Date.now() + SESSION_DAYS * 864e5 });
    res.setHeader('Set-Cookie', [
      stateCookie('', 0),
      `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secureFlag()}`,
    ]);
    res.redirect(`${frontendUrl()}/`);
  } catch (err) {
    console.error('[auth] google sign-in error', err.message);
    deny('google_failed');
  }
});

// ---- Sign-in from Tether (the Prism card) ----
// Tether's GET /auth/prism redirects here as <this route>?token=<jwt>, the same hand-off it uses for Alumni
// Connect: an HS256 JWT signed with Tether's JWT_SECRET (INTEGRATION_JWT_SECRET here), valid for 10 minutes,
// carrying email and name. Tether decides who is offered the card; this app still lets in only people who were
// given access (upsertUser). A token works once, and refusals return to /?signin=<reason> like Google's.
const usedSsoTokens = new Map(); // signature -> expiry (ms); one process, so memory is enough
function readTetherToken(token, key) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return { error: 'sso_invalid' };
  const [head, body, sig] = parts;
  let header, payload;
  try {
    header = JSON.parse(Buffer.from(head, 'base64url').toString());
    payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  } catch { return { error: 'sso_invalid' }; }
  if (header?.alg !== 'HS256') return { error: 'sso_invalid' }; // never trust the token's own choice of algorithm
  const expected = crypto.createHmac('sha256', key).update(`${head}.${body}`).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return { error: 'sso_invalid' };
  const exp = Number(payload?.exp) * 1000;
  if (!exp) return { error: 'sso_invalid' }; // a token with no expiry is not one of Tether's
  if (exp <= Date.now()) return { error: 'sso_expired' };
  const now = Date.now();
  for (const [k, until] of usedSsoTokens) if (until <= now) usedSsoTokens.delete(k);
  if (usedSsoTokens.has(sig)) return { error: 'sso_used' };
  usedSsoTokens.set(sig, exp);
  return { payload };
}

router.get('/sso', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer'); // the token is in this URL; keep it out of Referer headers
  const deny = (reason) => res.redirect(`${frontendUrl()}/?signin=${reason}`);
  try {
    const key = (process.env.INTEGRATION_JWT_SECRET || '').trim();
    if (!key) return deny('sso_not_configured');
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    if (!token) return deny('sso_invalid');
    const { payload, error } = readTetherToken(token, key);
    if (error) return deny(error);
    const email = String(payload.email || '').trim().toLowerCase();
    if (!email || email.split('@')[1] !== allowedDomain()) return deny('wrong_domain');
    let user;
    try { user = await upsertUser(email, payload.name); } catch (err) { if (err.reason) return deny(err.reason); throw err; }
    setSession(res, user);
    res.redirect(`${frontendUrl()}/`);
  } catch (err) {
    console.error('[auth] tether sign-in error', err.message);
    deny('sso_failed');
  }
});

// Dev sign-in: only when Google sign-in is not configured. Never enable in production.
router.post('/dev', async (req, res) => {
  if (authMode() !== 'dev') return res.status(400).json({ error: 'Dev sign-in is disabled' });
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email.endsWith('@' + allowedDomain())) return res.status(403).json({ error: `Only ${allowedDomain()} accounts can sign in` });
  try {
    const user = await upsertUser(email, req.body?.name);
    setSession(res, user);
    res.json({ user: publicUser(user) });
  } catch (err) {
    res.status(403).json({ error: err.message });
  }
});

router.post('/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
});

// ---- user and rule management (super admin) ----
router.get('/users', requireUser, requireRole('admin'), async (req, res) => {
  const [rows] = await appPool().query('SELECT * FROM users ORDER BY email');
  res.json({ users: rows.map((u) => ({ ...u, isSuperAdmin: isSuperAdmin(u) })), roles: ROLES, userQuotas: await hasQuotaColumns() });
});

router.post('/users/:id', requireUser, requireSuperAdmin, async (req, res) => {
  const { role, is_active } = req.body || {};
  const [[target]] = await appPool().query('SELECT id, email FROM users WHERE id = ?', [Number(req.params.id)]);
  if (!target) return res.status(404).json({ error: 'No such user' });
  if (isSuperAdmin(target) && ((role && role !== 'admin') || is_active === false)) return res.status(400).json({ error: 'A super admin stays an active admin' });
  if (role && !ROLES.includes(role)) return res.status(400).json({ error: 'Unknown role' });
  await appPool().query('UPDATE users SET role = COALESCE(?, role), is_active = COALESCE(?, is_active) WHERE id = ?', [role || null, is_active == null ? null : (is_active ? 1 : 0), target.id]);
  // Per-user quota override: null clears it (back to the role's limit). Needs migration 003.
  const { quota_per_day, quota_per_hour } = req.body || {};
  if (quota_per_day !== undefined || quota_per_hour !== undefined) {
    if (!(await hasQuotaColumns())) return res.status(409).json({ error: 'Per-user limits need migration 003 (npm run migrate --prefix server)' });
    const norm = (v) => (v === null || v === '' ? null : Math.max(0, Math.floor(Number(v) || 0)));
    const sets = [], vals = [];
    if (quota_per_day !== undefined) { sets.push('quota_per_day = ?'); vals.push(norm(quota_per_day)); }
    if (quota_per_hour !== undefined) { sets.push('quota_per_hour = ?'); vals.push(norm(quota_per_hour)); }
    await appPool().query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...vals, target.id]);
  }
  res.json({ ok: true });
});

// ---- Admin > Access: give someone access (super admin), picked from the employee directory by team ----
router.get('/directory/teams', requireUser, requireRole('admin'), async (req, res) => {
  try { const t = await employees.teams(); res.json({ available: t !== null, teams: t || [] }); } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/directory/members', requireUser, requireRole('admin'), async (req, res) => {
  try {
    const team = String(req.query.team || '').slice(0, 191);
    if (!team) return res.status(400).json({ error: 'Team is required' });
    const m = await employees.members(team);
    res.json({ available: m !== null, members: m || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /users { email, role, name? }  adds the person, or updates and re-activates them if they were listed before.
router.post('/users', requireUser, requireSuperAdmin, async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) return res.status(400).json({ error: 'Enter a full email address' });
    if (!email.endsWith('@' + allowedDomain())) return res.status(400).json({ error: `Access is only for @${allowedDomain()} accounts` });
    const role = superAdmins().includes(email) ? 'admin' : String(req.body?.role || '');
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'Choose a role' });
    // The directory is the source of truth for who someone is: a name or team sent by the browser is never
    // trusted when the directory can be asked.
    const person = await employees.byEmail(email);
    if (person === undefined) return res.status(400).json({ error: 'That email is not in the employee directory. Pick the person from their team.' });
    const name = person ? person.name : (String(req.body?.name || '').trim().slice(0, 255) || null);
    await appPool().query(
      `INSERT INTO users (email, name, role, is_active, team, designation, employee_code, added_by) VALUES (?, ?, ?, 1, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = COALESCE(VALUES(name), name), role = VALUES(role), is_active = 1, team = VALUES(team),
                               designation = VALUES(designation), employee_code = VALUES(employee_code), added_by = VALUES(added_by)`,
      [email, name, role, person?.team ?? null, person?.designation ?? null, person?.employee_code ?? null, req.user.email],
    );
    res.status(201).json({ ok: true, name: name || email, role });
  } catch (err) {
    const noCol = /unknown column/i.test(err.message);
    res.status(noCol ? 409 : 500).json({ error: noCol ? 'Giving access needs migration 008 (npm run migrate --prefix server)' : err.message });
  }
});

router.get('/rules', requireUser, requireRole('admin'), async (req, res) => {
  res.json({ rules: await allRules(true), roles: ROLES.filter((r) => r !== 'admin') });
});

router.post('/rules', requireUser, requireSuperAdmin, async (req, res) => {
  const { role, database_name, table_name, column_name, effect } = req.body || {};
  if (!ROLES.includes(role) || role === 'admin') return res.status(400).json({ error: 'role must be analyst or viewer' });
  if (!database_name) return res.status(400).json({ error: 'database_name is required' });
  if (!['allow', 'deny'].includes(effect)) return res.status(400).json({ error: 'effect must be allow or deny' });
  if (column_name && !table_name) return res.status(400).json({ error: 'a column rule needs a table' });
  if (column_name && effect !== 'deny') return res.status(400).json({ error: 'column rules can only deny (hide) a column' });
  try {
    if (column_name) await appPool().query('INSERT INTO access_rules (role, database_name, table_name, column_name, effect) VALUES (?, ?, ?, ?, ?)', [role, database_name, table_name, column_name, effect]);
    else await appPool().query('INSERT INTO access_rules (role, database_name, table_name, effect) VALUES (?, ?, ?, ?)', [role, database_name, table_name || null, effect]);
    invalidateRules();
    res.json({ ok: true, rules: await allRules(true) });
  } catch (err) {
    const noCol = /column_name/i.test(err.message) && /unknown column/i.test(err.message);
    res.status(err.code === 'ER_DUP_ENTRY' || noCol ? 409 : 500).json({ error: err.code === 'ER_DUP_ENTRY' ? 'That rule already exists' : noCol ? 'Column rules need migration 004 (npm run migrate --prefix server)' : err.message });
  }
});

router.delete('/rules/:id', requireUser, requireSuperAdmin, async (req, res) => {
  await appPool().query('DELETE FROM access_rules WHERE id = ?', [Number(req.params.id)]);
  invalidateRules();
  res.json({ ok: true, rules: await allRules(true) });
});

export default { name: 'auth', order: 0, routes: router };
