// People module: who is online, and messages between colleagues (user request, 24 Nov 2026; modelled on
// Alumni Connect's server/routes/live.js). Needs migration 010.
//
// There is no socket: the browser reports in every 20 seconds and reads back who else is here and what is
// unread. That works through nginx and PM2 as they are, at the cost of a delay of a few seconds.
//
// Everyone here is signed in (index.js puts requireUser in front of /api). Only people who still have access
// (an active users row) are shown or can be written to. A conversation is visible to its two people only;
// nothing here is sent to Claude, counted against credit, or shown on the Admin page.
import { Router } from 'express';
import { appPool } from '../../appDb.js';

// A person is online while their last report is newer than this. The browser reports every 20 seconds, and
// browsers slow timers in background tabs to about once a minute.
const ONLINE_SECONDS = 75;
const MAX_MESSAGE = 2000;
const PAGE = 100;
const ONLINE = '(p.left_at IS NULL AND p.last_seen > UTC_TIMESTAMP(3) - INTERVAL ? SECOND)';

const missing = (err) => err?.code === 'ER_NO_SUCH_TABLE';
const nameOf = (r) => r.name || String(r.email || '').split('@')[0];
const person = (r) => ({ id: Number(r.id), name: nameOf(r), picture: r.picture_url || null, team: r.team || null, online: !!Number(r.online) });
const message = (r, me) => ({ id: Number(r.id), mine: Number(r.sender_id) === me, body: r.body, at: r.sent_at });

class HttpError extends Error { constructor(status, text) { super(text); this.status = status; } }
// Runs a handler; "chat is not set up" (migration 010 missing) is answered plainly so the client hides the feature.
const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); } catch (err) {
    if (missing(err)) return res.status(503).json({ error: 'Chat is not set up yet (migration 010)', unavailable: true });
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error('[people]', err.message);
    res.status(500).json({ error: 'Something went wrong' });
  }
};

async function unreadFor(me) {
  const [rows] = await appPool().query(
    `SELECT m.sender_id AS id, COUNT(*) AS count, MAX(m.id) AS last_id, u.name, u.email, u.picture_url
       FROM direct_messages m JOIN users u ON u.id = m.sender_id
      WHERE m.recipient_id = ? AND m.read_at IS NULL
      GROUP BY m.sender_id, u.name, u.email, u.picture_url`,
    [me],
  );
  return rows.map((r) => ({ id: Number(r.id), name: nameOf(r), picture: r.picture_url || null, count: Number(r.count), lastId: Number(r.last_id) }));
}

// The other person in a conversation: a real, different user.
async function otherOf(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'That is not a person');
  if (id === req.user.id) throw new HttpError(400, 'You cannot chat with yourself');
  const [[row]] = await appPool().query(
    `SELECT u.id, u.name, u.email, u.picture_url, u.team, u.is_active, COALESCE(${ONLINE}, 0) AS online
       FROM users u LEFT JOIN user_presence p ON p.user_id = u.id WHERE u.id = ?`,
    [ONLINE_SECONDS, id],
  );
  if (!row) throw new HttpError(404, 'No such person');
  return row;
}

const router = Router();

// "I am here." Answers with who else is online and what is unread.
router.post('/presence', wrap(async (req, res) => {
  const me = req.user.id;
  await appPool().query(
    `INSERT INTO user_presence (user_id, last_seen, left_at) VALUES (?, UTC_TIMESTAMP(3), NULL)
     ON DUPLICATE KEY UPDATE last_seen = VALUES(last_seen), left_at = NULL`,
    [me],
  );
  const [rows] = await appPool().query(
    `SELECT u.id, u.name, u.email, u.picture_url, u.team, 1 AS online
       FROM user_presence p JOIN users u ON u.id = p.user_id
      WHERE ${ONLINE} AND u.is_active = 1 AND u.id <> ?
      ORDER BY COALESCE(u.name, u.email), u.id`,
    [ONLINE_SECONDS, me],
  );
  res.json({ online: rows.map(person), unread: await unreadFor(me) });
}));

// Tab closed or signed out: go offline at once instead of timing out.
router.post('/presence/leave', wrap(async (req, res) => {
  await appPool().query('UPDATE user_presence SET left_at = UTC_TIMESTAMP(3) WHERE user_id = ?', [req.user.id]);
  res.json({ ok: true });
}));

// The chat list: everyone who has access, with the last message exchanged and the unread count.
// Online first, then the most recent conversation, then by name.
router.get('/list', wrap(async (req, res) => {
  const me = req.user.id;
  const pool = appPool();
  const [users] = await pool.query(
    `SELECT u.id, u.name, u.email, u.picture_url, u.team, u.is_active, COALESCE(${ONLINE}, 0) AS online
       FROM users u LEFT JOIN user_presence p ON p.user_id = u.id
      WHERE u.id <> ?`,
    [ONLINE_SECONDS, me],
  );
  const [threads] = await pool.query(
    `SELECT t.other, MAX(t.id) AS last_id
       FROM (SELECT recipient_id AS other, id FROM direct_messages WHERE sender_id = ?
             UNION ALL
             SELECT sender_id AS other, id FROM direct_messages WHERE recipient_id = ?) t
      GROUP BY t.other`,
    [me, me],
  );
  const lastIds = threads.map((t) => t.last_id);
  const [last] = lastIds.length ? await pool.query('SELECT id, sender_id, body, sent_at FROM direct_messages WHERE id IN (?)', [lastIds]) : [[]];
  const lastById = new Map(last.map((m) => [Number(m.id), m]));
  const lastOf = new Map(threads.map((t) => [Number(t.other), lastById.get(Number(t.last_id))]));
  const unread = new Map((await unreadFor(me)).map((u) => [u.id, u.count]));

  const people = users
    // Someone whose access was removed stays in the list only if there is a conversation to read.
    .filter((u) => u.is_active || lastOf.has(Number(u.id)))
    .map((u) => {
      const m = lastOf.get(Number(u.id));
      return {
        ...person(u),
        canMessage: !!u.is_active,
        unread: unread.get(Number(u.id)) || 0,
        last: m ? { id: Number(m.id), mine: Number(m.sender_id) === me, body: String(m.body).slice(0, 120), at: m.sent_at } : null,
      };
    })
    .sort((a, b) => Number(b.online) - Number(a.online) || (b.last?.id || 0) - (a.last?.id || 0) || a.name.localeCompare(b.name));
  res.json({ people });
}));

// A conversation. Reading it marks the other person's messages as read.
//   (no query)    the newest messages
//   ?after=<id>   only messages newer than that one (what the open chat polls)
//   ?before=<id>  the page just older than that one (scrolling up)
router.get('/chat/:id', wrap(async (req, res) => {
  const me = req.user.id;
  const them = await otherOf(req);
  const pool = appPool();
  const after = Number(req.query.after) || 0;
  const before = after ? 0 : Number(req.query.before) || 0;
  const pair = '((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?))';
  const args = [me, them.id, them.id, me];
  const select = `SELECT id, sender_id, body, sent_at FROM direct_messages WHERE ${pair}`;
  let more;
  const [rows] = after
    ? await pool.query(`${select} AND id > ? ORDER BY id LIMIT ${PAGE}`, [...args, after])
    : before
      ? await pool.query(`${select} AND id < ? ORDER BY id DESC LIMIT ${PAGE + 1}`, [...args, before])
      : await pool.query(`${select} ORDER BY id DESC LIMIT ${PAGE + 1}`, args);
  if (!after) {
    more = rows.length > PAGE; // one row more than a page was asked for, to learn whether older ones exist
    if (more) rows.pop();
    rows.reverse();
  }
  await pool.query('UPDATE direct_messages SET read_at = UTC_TIMESTAMP(3) WHERE sender_id = ? AND recipient_id = ? AND read_at IS NULL', [them.id, me]);
  const [[seen]] = await pool.query('SELECT MAX(id) AS id FROM direct_messages WHERE sender_id = ? AND recipient_id = ? AND read_at IS NOT NULL', [me, them.id]);
  res.json({
    them: { ...person(them), canMessage: !!them.is_active },
    messages: rows.map((r) => message(r, me)),
    seen: Number(seen?.id) || 0, // the newest of my messages they have read
    ...(more === undefined ? {} : { more }),
  });
}));

router.post('/chat/:id', wrap(async (req, res) => {
  const me = req.user.id;
  const them = await otherOf(req);
  const body = String(req.body?.body ?? '').trim();
  if (!body) throw new HttpError(400, 'Write a message first');
  if (body.length > MAX_MESSAGE) throw new HttpError(400, `A message can be at most ${MAX_MESSAGE} characters`);
  if (!them.is_active) throw new HttpError(400, 'That person no longer has access to Prism');
  const [r] = await appPool().query('INSERT INTO direct_messages (sender_id, recipient_id, body, sent_at) VALUES (?, ?, ?, UTC_TIMESTAMP(3))', [me, them.id, body]);
  const [[row]] = await appPool().query('SELECT id, sender_id, body, sent_at FROM direct_messages WHERE id = ?', [r.insertId]);
  res.status(201).json({ message: message(row, me) });
}));

export default { name: 'people', order: 90, routes: router };
