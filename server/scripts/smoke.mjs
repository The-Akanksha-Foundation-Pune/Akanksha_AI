// Smoke test for CI: starts the real server and drives it over HTTP.
//
//   npm run smoke --prefix server
//
// It checks that the server boots with every module, that health and the database answer, that the API
// refuses a caller with no session, and (SMOKE_SIGNIN=1, dev sign-in mode only) that a signed-in super
// admin gets the module list. With SERVE_CLIENT=1 it also checks that the client page is served.
//
// CI runs it against a throwaway MySQL (see .github/workflows/ci-cd.yml). SMOKE_SIGNIN creates a user
// row, so never set it against the real AI database.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, '..');
const port = process.env.PORT || 5000;
const base = `http://127.0.0.1:${port}`;

let log = '';
const child = spawn(process.execPath, ['src/index.js'], { cwd: serverDir, env: process.env });
child.stdout.on('data', (d) => { log += d; });
child.stderr.on('data', (d) => { log += d; });
let exited = null;
child.on('exit', (code) => { exited = code; });

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`);
  if (!ok) failed++;
};
const get = async (url, headers = {}) => {
  const r = await fetch(base + url, { headers, redirect: 'manual' });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, text, json, headers: r.headers };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  // 1. Boot
  let up = false;
  for (let i = 0; i < 60 && exited === null; i++) {
    try { if ((await get('/api/health')).json?.status === 'ok') { up = true; break; } } catch { /* not listening yet */ }
    await sleep(500);
  }
  check('server starts and /api/health answers', up, exited !== null ? `server exited with code ${exited}` : 'no answer in 30 s');
  if (!up) throw new Error('server did not start');

  // 2. Every module folder loaded
  const folders = fs.readdirSync(path.join(serverDir, 'src/modules'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(serverDir, 'src/modules', d.name, 'index.js'))).map((d) => d.name);
  const loadedLine = (log.match(/modules loaded: (.*)/) || [])[1] || '';
  const loaded = loadedLine.split(',').map((s) => s.trim()).filter(Boolean);
  check(`all ${folders.length} modules loaded`, loaded.length === folders.length, `loaded: ${loadedLine || 'none'}`);

  // 3. Database reachable
  const db = await get('/api/health/db');
  check('/api/health/db reaches MySQL', db.status === 200 && db.json?.status === 'ok', db.text.slice(0, 200));

  // 4. No session, no data
  for (const url of ['/api/chat/databases', '/api/modules', '/api/modules/admin/summary', '/api/modules/credits/users']) {
    const r = await get(url);
    check(`${url} refuses a caller with no session`, r.status === 401, `status ${r.status}`);
  }
  const me = await get('/api/modules/auth/me');
  check('/api/modules/auth/me answers with no user', me.status === 200 && !me.json?.user, me.text.slice(0, 200));
  if (process.env.TETHER_URL) check('the Back to Tether address comes from TETHER_URL', me.json?.tetherUrl === process.env.TETHER_URL.replace(/\/+$/, ''), me.text.slice(0, 200));

  // 5. Signed in (throwaway database only)
  if (process.env.SMOKE_SIGNIN === '1') {
    const email = (process.env.SUPER_ADMIN_EMAILS || '').split(',')[0].trim();
    const r = await fetch(base + '/api/modules/auth/dev', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, name: 'CI' }) });
    const body = await r.json().catch(() => ({}));
    const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
    check('dev sign-in as the super admin', r.status === 200 && body.user?.role === 'admin' && !!cookie, JSON.stringify(body).slice(0, 200));
    if (cookie) {
      const mods = await get('/api/modules', { Cookie: cookie });
      check('/api/modules lists every module when signed in', mods.status === 200 && mods.json?.modules?.length === folders.length, mods.text.slice(0, 200));
      const dbs = await get('/api/chat/databases', { Cookie: cookie });
      check('/api/chat/databases answers when signed in', dbs.status === 200, dbs.text.slice(0, 200));
      const credits = await get('/api/modules/credits/me', { Cookie: cookie });
      check('/api/modules/credits/me answers when signed in', credits.status === 200, credits.text.slice(0, 200));
    }
    const stranger = await fetch(base + '/api/modules/auth/dev', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `not-invited@${email.split('@')[1]}` }) });
    check('someone who was not given access is refused', stranger.status === 403, `status ${stranger.status}`);

    // A viewer, added the way Admin > Access adds people, does not get the admin-only preference.
    if (cookie) {
      const post = (url, body, c) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: c }, body: JSON.stringify(body) });
      const viewerEmail = `ci-viewer@${email.split('@')[1]}`;
      const added = await post('/api/modules/auth/users', { email: viewerEmail, role: 'viewer', name: 'CI Viewer' }, cookie);
      check('a super admin can give a viewer access', added.status === 201 || added.status === 200, `status ${added.status}`);
      const vr = await fetch(base + '/api/modules/auth/dev', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: viewerEmail }) });
      const viewerCookie = (vr.headers.get('set-cookie') || '').split(';')[0];
      check('the viewer can sign in', vr.status === 200 && !!viewerCookie, `status ${vr.status}`);
      const adminKeys = Object.keys((await get('/api/modules/memory/me', { Cookie: cookie })).json?.keys || {});
      const viewerKeys = Object.keys((await get('/api/modules/memory/me', { Cookie: viewerCookie })).json?.keys || {});
      check('an admin is offered the default-database preference', adminKeys.includes('default_database'), adminKeys.join(','));
      check('a viewer is not offered the default-database preference', viewerKeys.length > 0 && !viewerKeys.includes('default_database'), viewerKeys.join(','));
      const forced = await post('/api/modules/memory/me', { values: { default_database: 'AFDW' } }, viewerCookie);
      check('a viewer cannot set a default database through the API', forced.status === 403, `status ${forced.status}`);
      // Who asked what: super admins only.
      const peek = await get('/api/modules/admin/questions', { Cookie: viewerCookie });
      check('a viewer cannot read other people\'s questions', peek.status === 403, `status ${peek.status}`);
      const own = await get('/api/modules/admin/questions?days=1', { Cookie: cookie });
      check('a super admin can list questions', own.status === 200 && Array.isArray(own.json?.questions), `status ${own.status}`);
      const allowed = await post('/api/modules/memory/me', { values: { answer_style: 'concise' } }, viewerCookie);
      check('a viewer can still save the other preferences', allowed.status === 200, `status ${allowed.status}`);

      // Who is online, and chat between the two of them.
      const people = '/api/modules/people';
      const here = async (c) => (await post(`${people}/presence`, {}, c)).json();
      await here(cookie);
      const viewerSees = await here(viewerCookie);
      const adminSees = await here(cookie);
      check('each person sees the other as online, and not themselves', viewerSees.online?.length === 1 && adminSees.online?.length === 1 && adminSees.online[0].name === 'CI Viewer', JSON.stringify({ viewerSees, adminSees }).slice(0, 300));
      const viewerId = adminSees.online?.[0]?.id, adminId = viewerSees.online?.[0]?.id;
      const sent = await post(`${people}/chat/${viewerId}`, { body: 'Hello from CI' }, cookie);
      check('a message can be sent to a colleague', sent.status === 201, `status ${sent.status}`);
      const waiting = await here(viewerCookie);
      check('the recipient is told one message is unread', waiting.unread?.length === 1 && waiting.unread[0].count === 1 && waiting.unread[0].id === adminId, JSON.stringify(waiting.unread));
      const thread = await get(`${people}/chat/${adminId}`, { Cookie: viewerCookie });
      check('the recipient can read it, and it is not marked as theirs', thread.json?.messages?.length === 1 && thread.json.messages[0].body === 'Hello from CI' && thread.json.messages[0].mine === false, thread.text.slice(0, 200));
      check('opening the conversation clears the unread count', (await here(viewerCookie)).unread?.length === 0);
      const back = await get(`${people}/chat/${viewerId}`, { Cookie: cookie });
      check('the sender sees it was read', back.json?.seen === back.json?.messages?.[0]?.id && back.json?.messages?.[0]?.mine === true, back.text.slice(0, 200));
      const listed = await get(`${people}/list`, { Cookie: viewerCookie });
      check('the chat list shows the conversation', listed.json?.people?.[0]?.last?.body === 'Hello from CI' && listed.json.people[0].online === true, listed.text.slice(0, 200));
      check('nobody can message themselves', (await post(`${people}/chat/${adminId}`, { body: 'x' }, cookie)).status === 400);
      check('an empty message is refused', (await post(`${people}/chat/${viewerId}`, { body: '   ' }, cookie)).status === 400);
      check('a message to someone who does not exist is refused', (await post(`${people}/chat/999999`, { body: 'x' }, cookie)).status === 404);
      check('chat needs a session', (await get(`${people}/list`)).status === 401);
      await post(`${people}/presence/leave`, {}, viewerCookie);
      check('leaving takes the person off the online list at once', (await here(cookie)).online?.length === 0);
    }
  }

  // 6. Sign-in from Tether (throwaway database only): a token as Tether's jwt.sign() makes it
  if (process.env.SMOKE_SIGNIN === '1' && process.env.INTEGRATION_JWT_SECRET) {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const mint = (claims, { key = process.env.INTEGRATION_JWT_SECRET, alg = 'HS256', ttl = 600 } = {}) => {
      const now = Math.floor(Date.now() / 1000);
      const data = `${b64({ alg, typ: 'JWT' })}.${b64({ iat: now, exp: now + ttl, timestamp: Date.now(), ...claims })}`;
      return `${data}.${alg === 'none' ? '' : crypto.createHmac('sha256', key).update(data).digest('base64url')}`;
    };
    const sso = async (token) => {
      const r = await fetch(`${base}/api/modules/auth/sso?token=${encodeURIComponent(token)}`, { redirect: 'manual' });
      return { status: r.status, to: r.headers.get('location') || '', cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
    };
    const admin = (process.env.SUPER_ADMIN_EMAILS || '').split(',')[0].trim();
    const domain = admin.split('@')[1];
    const refused = (r, reason) => r.status === 302 && r.to.endsWith(`/?signin=${reason}`) && !r.cookie;

    const good = mint({ email: admin, name: 'CI', picture: 'https://lh3.googleusercontent.com/a/ci-picture=s96-c' });
    const first = await sso(good);
    check('Tether token for an invited person opens a session', first.status === 302 && first.to.endsWith('/') && !first.to.includes('signin=') && first.cookie.startsWith('akai_session='), JSON.stringify(first));
    if (first.cookie) {
      const who = await get('/api/modules/auth/me', { Cookie: first.cookie });
      check('that session belongs to the person in the token', who.json?.user?.email === admin, who.text.slice(0, 200));
      check('the profile picture from the token is remembered', who.json?.user?.picture === 'https://lh3.googleusercontent.com/a/ci-picture=s96-c', who.text.slice(0, 200));
    }
    check('the same Tether token does not work twice', refused(await sso(good), 'sso_used'));
    check('a token signed with another secret is refused', refused(await sso(mint({ email: admin }, { key: 'some-other-secret' })), 'sso_invalid'));
    check('an unsigned token (alg none) is refused', refused(await sso(mint({ email: admin }, { alg: 'none' })), 'sso_invalid'));
    const edited = mint({ email: `someone-else@${domain}` }).split('.');
    edited[1] = b64({ email: admin, exp: Math.floor(Date.now() / 1000) + 600 });
    check('a token whose contents were edited is refused', refused(await sso(edited.join('.')), 'sso_invalid'));
    check('an expired token is refused', refused(await sso(mint({ email: admin }, { ttl: -60 })), 'sso_expired'));
    check('a token for someone without access is refused', refused(await sso(mint({ email: `not-invited@${domain}` })), 'no_access'));
    check('a token for another organisation is refused', refused(await sso(mint({ email: 'ci-admin@elsewhere.example' })), 'wrong_domain'));
    check('a request with no token is refused', refused(await sso(''), 'sso_invalid'));
    const odd = await sso(mint({ email: admin, picture: 'javascript:alert(1)' }));
    const oddWho = odd.cookie ? await get('/api/modules/auth/me', { Cookie: odd.cookie }) : null;
    check('a picture that is not an https address is ignored', oddWho?.json?.user?.picture === 'https://lh3.googleusercontent.com/a/ci-picture=s96-c', oddWho?.text?.slice(0, 200));
  }

  // 7. Client page
  if (process.env.SERVE_CLIENT === '1') {
    const home = await get('/');
    check('/ serves the client page', home.status === 200 && /<div id="root">/.test(home.text), `status ${home.status}`);
    const deep = await get('/some/page');
    check('unknown page paths fall back to the client page', deep.status === 200 && /<div id="root">/.test(deep.text), `status ${deep.status}`);
    const api = await get('/api/no-such-route');
    check('unknown /api paths do not return the page', api.status !== 200, `status ${api.status}`);
  }
} catch (err) {
  console.error(err.message);
  failed++;
} finally {
  child.kill();
}

if (failed) {
  console.log('\n--- server output ---\n' + log);
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nSmoke test passed');
process.exit(0);
