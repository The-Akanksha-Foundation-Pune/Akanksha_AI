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
  }

  // 6. Client page
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
