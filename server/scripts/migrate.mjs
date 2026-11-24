// Applies every migrations/*.sql file not yet recorded in schema_migrations, in name order.
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env'), override: true });

const database = process.env.AI_DB_NAME;
if (!database) { console.error('AI_DB_NAME is not set in .env'); process.exit(1); }

const conn = await mysql.createConnection({
  host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 3306), database, ssl: { rejectUnauthorized: false }, multipleStatements: true,
});

await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name VARCHAR(120) NOT NULL, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (name)) ENGINE=InnoDB`);
const [done] = await conn.query('SELECT name FROM schema_migrations');
const applied = new Set(done.map((r) => r.name));

const dir = path.resolve(here, '../migrations');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
let ran = 0;
for (const file of files) {
  if (applied.has(file)) continue;
  const sql = fs.readFileSync(path.join(dir, file), 'utf8');
  process.stdout.write(`applying ${file} ... `);
  await conn.query(sql);
  await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
  console.log('ok');
  ran++;
}
console.log(ran ? `${ran} migration(s) applied to ${database}` : `${database} is up to date`);
await conn.end();
