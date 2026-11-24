// Quota module: how many prompts a role may send per day (Asia/Kolkata day) and per hour.
// Limits live in app_settings as quota.<role>.per_day / quota.<role>.per_hour; 0 means unlimited.
import { Router } from 'express';
import { appPool, getNumberSetting } from '../../appDb.js';

const DEFAULTS = {
  admin: { per_day: 0, per_hour: 0 },
  analyst: { per_day: 100, per_hour: 30 },
  viewer: { per_day: 30, per_hour: 10 },
};
const IST_OFFSET_MS = 5.5 * 3600e3;

export async function roleLimits(role) {
  const d = DEFAULTS[role] || DEFAULTS.viewer;
  return {
    per_day: await getNumberSetting(`quota.${role}.per_day`, d.per_day),
    per_hour: await getNumberSetting(`quota.${role}.per_hour`, d.per_hour),
  };
}

// Effective limits: a per-user value (users.quota_per_day / quota_per_hour, when the column exists and is set) beats the role's.
export async function limitsFor(user) {
  const role = await roleLimits(user.role);
  const hasUser = user.quota_per_day != null || user.quota_per_hour != null;
  return {
    per_day: user.quota_per_day != null ? Number(user.quota_per_day) : role.per_day,
    per_hour: user.quota_per_hour != null ? Number(user.quota_per_hour) : role.per_hour,
    source: hasUser ? 'user' : 'role',
    role,
  };
}

// Seconds since midnight in India, so the day boundary is right whatever clocks the servers run on.
function secondsSinceIstMidnight() {
  const now = Date.now();
  const ist = new Date(now + IST_OFFSET_MS);
  const startIst = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_OFFSET_MS;
  return Math.floor((now - startIst) / 1000);
}

export async function usageFor(userId) {
  if (!userId) return { today: 0, hour: 0 };
  const [[row]] = await appPool().query(
    `SELECT COUNT(DISTINCT CASE WHEN created_at >= NOW() - INTERVAL ? SECOND THEN message_id END) AS today,
            COUNT(DISTINCT CASE WHEN created_at >= NOW() - INTERVAL 1 HOUR THEN message_id END) AS hour
       FROM api_requests WHERE user_id = ? AND message_id IS NOT NULL`,
    [secondsSinceIstMidnight(), userId],
  );
  return { today: Number(row.today) || 0, hour: Number(row.hour) || 0 };
}

export async function quotaStatus(user) {
  const limits = await limitsFor(user);
  const used = await usageFor(user.id);
  const left = (limit, n) => (limit > 0 ? Math.max(0, limit - n) : null);
  return { role: user.role, limits, used, remaining: { day: left(limits.per_day, used.today), hour: left(limits.per_hour, used.hour) } };
}

const router = Router();
router.get('/me', async (req, res) => {
  try { res.json(await quotaStatus(req.user)); } catch (err) { res.status(500).json({ error: err.message }); }
});

export default {
  name: 'quota',
  order: 5,
  routes: router,
  hooks: {
    // Runs before the stream starts. Throwing here answers the request with the error's status.
    async gate(ctx) {
      if (!ctx.user) return;
      const s = await quotaStatus(ctx.user);
      if (s.remaining.hour === 0) {
        const err = new Error(`You have used your ${s.limits.per_hour} prompts for this hour. Try again a little later.`);
        err.status = 429; err.quota = s; throw err;
      }
      if (s.remaining.day === 0) {
        const err = new Error(`You have used your ${s.limits.per_day} prompts for today. The limit resets at midnight (IST).`);
        err.status = 429; err.quota = s; throw err;
      }
      ctx.quota = s;
    },
  },
};
