// Access to the app's own database (AI_DB_NAME): settings, usage, learned queries, chats.
import { getPool, appDatabase } from './db.js';

export function appPool() {
  const name = appDatabase();
  if (!name) throw new Error('AI_DB_NAME is not set');
  return getPool(name);
}

// Runs a write against the app database; failures are logged, never thrown, so logging can't break a chat.
export async function appWrite(sql, params = []) {
  try {
    const [r] = await appPool().query(sql, params);
    return r;
  } catch (err) {
    console.warn('app db write failed:', err.message);
    return null;
  }
}

// ---- app_settings with a short cache -------------------------------------------------
let settingsCache = { at: 0, map: new Map() };
const SETTINGS_TTL_MS = 30_000;

export async function allSettings(force = false) {
  if (!force && Date.now() - settingsCache.at < SETTINGS_TTL_MS) return settingsCache.map;
  try {
    const [rows] = await appPool().query('SELECT setting_key, setting_value FROM app_settings');
    settingsCache = { at: Date.now(), map: new Map(rows.map((r) => [r.setting_key, r.setting_value])) };
  } catch (err) {
    if (!settingsCache.at) console.warn('app_settings unavailable, using defaults:', err.message);
    settingsCache.at = Date.now();
  }
  return settingsCache.map;
}

export async function getSetting(key, fallback) {
  const v = (await allSettings()).get(key);
  return v == null || v === '' ? fallback : v;
}

export async function getNumberSetting(key, fallback) {
  const n = Number(await getSetting(key, fallback));
  return Number.isFinite(n) ? n : fallback;
}
