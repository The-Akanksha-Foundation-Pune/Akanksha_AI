import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENV_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env');
const SYSTEM_SCHEMAS = new Set(['information_schema', 'mysql', 'performance_schema', 'sys']);

const pools = new Map(); // database name -> pool
let connKey = null;      // JSON of host/user/password/port the pools were made with
let dbListCache = null;  // { names, loadedAt }

function connConfig() {
  return {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT || 3306),
  };
}

export const defaultDatabase = () => process.env.DB_NAME || '';
// The app's own database (chats, usage, learned queries). Hidden from the data selector.
export const appDatabase = () => process.env.AI_DB_NAME || '';

function makePool(database) {
  const pool = mysql.createPool({
    ...connConfig(),
    ...(database ? { database } : {}),
    ssl: { rejectUnauthorized: false },
    waitForConnections: true,
    connectionLimit: 4,
    connectTimeout: 15000,
    timezone: 'Z', // DATETIME values are read as UTC; the session below writes them as UTC too
  });
  pool.on('connection', (conn) => conn.query("SET time_zone = '+00:00'"));
  return pool;
}

// Pool for one database. `null` gives a pool with no default schema (for SHOW DATABASES).
export function getPool(database = defaultDatabase()) {
  const key = JSON.stringify(connConfig());
  if (connKey !== key) {
    for (const p of pools.values()) p.end().catch(() => {});
    pools.clear();
    dbListCache = null;
    connKey = key;
  }
  const name = database || '';
  if (!pools.has(name)) pools.set(name, makePool(name));
  return pools.get(name);
}

// Databases these credentials can see, minus MySQL's own schemas, with table counts.
export async function listDatabases(force = false) {
  if (dbListCache && !force) return dbListCache;
  const [rows] = await getPool(null).query(
    `SELECT TABLE_SCHEMA AS name, COUNT(*) AS tables
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA NOT IN ('information_schema','mysql','performance_schema','sys')
      GROUP BY TABLE_SCHEMA ORDER BY TABLE_SCHEMA`,
  );
  const [all] = await getPool(null).query('SHOW DATABASES');
  const counts = new Map(rows.map((r) => [r.name, Number(r.tables)]));
  const names = all.map((r) => Object.values(r)[0]).filter((n) => !SYSTEM_SCHEMAS.has(n) && n !== appDatabase());
  dbListCache = { databases: names.map((name) => ({ name, tables: counts.get(name) || 0 })), loadedAt: new Date().toISOString() };
  return dbListCache;
}

// Throws if `database` is not one these credentials can see.
export async function assertDatabase(database) {
  const { databases } = await listDatabases();
  if (!databases.some((d) => d.name === database)) {
    await listDatabases(true);
    if (!dbListCache.databases.some((d) => d.name === database)) throw new Error(`Unknown database "${database}"`);
  }
  return database;
}

// Re-read .env; returns true when the connection settings changed (pools are rebuilt lazily).
export async function refreshPool() {
  const before = JSON.stringify(connConfig());
  dotenv.config({ path: ENV_PATH, override: true });
  dbListCache = null;
  return JSON.stringify(connConfig()) !== before;
}

export async function checkDb(database = defaultDatabase()) {
  const [[row]] = await getPool(database).query('SELECT VERSION() AS version, DATABASE() AS db');
  return row;
}
