// Role-based visibility of databases and tables, from the access_rules table.
// Semantics:
//   - admins see everything.
//   - a role with no rules sees everything.
//   - if a role has any `allow` rule with table_name NULL, only those databases are visible.
//   - inside a visible database, `deny` rules with a table hide that table; `allow` rules with tables
//     (when any exist for that database) restrict the role to just those tables.
import { appPool, allSettings } from './appDb.js';

let cache = { at: 0, rules: [] };
const TTL = 30_000;

export async function allRules(force = false) {
  if (!force && Date.now() - cache.at < TTL) return cache.rules;
  try {
    const [rows] = await appPool().query('SELECT * FROM access_rules ORDER BY role, database_name, table_name');
    cache = { at: Date.now(), rules: rows };
  } catch (err) {
    console.warn('access_rules unavailable, treating as unrestricted:', err.message);
    cache.at = Date.now();
  }
  return cache.rules;
}

export const invalidateRules = () => { cache.at = 0; };

const isAdmin = (user) => !user || user.role === 'admin';
const tableRule = (r) => r.table_name && !r.column_name; // a rule about a whole table
const columnRule = (r) => !!r.column_name;

export async function isRestricted(user) {
  if (isAdmin(user)) return false;
  return (await allRules()).some((r) => r.role === user.role);
}

// Databases this user may see, given the full list.
export async function filterDatabases(user, databases) {
  if (isAdmin(user)) return databases;
  const rules = (await allRules()).filter((r) => r.role === user.role);
  if (!rules.length) return databases;
  const allowedDbs = new Set(rules.filter((r) => r.effect === 'allow' && !columnRule(r)).map((r) => r.database_name));
  const deniedWholeDbs = new Set(rules.filter((r) => r.effect === 'deny' && r.table_name == null).map((r) => r.database_name));
  return databases.filter((d) => (allowedDbs.size ? allowedDbs.has(d.name) : true) && !deniedWholeDbs.has(d.name));
}

// Table names this user may see in one database, or null when unrestricted.
export async function visibleTableSet(user, database, allTableNames) {
  if (isAdmin(user)) return null;
  const rules = (await allRules()).filter((r) => r.role === user.role);
  if (!rules.length) return null;
  const forDb = rules.filter((r) => r.database_name === database);
  const allowedDbs = new Set(rules.filter((r) => r.effect === 'allow' && !columnRule(r)).map((r) => r.database_name));
  if (allowedDbs.size && !allowedDbs.has(database)) return new Set();
  if (forDb.some((r) => r.effect === 'deny' && r.table_name == null)) return new Set();
  const allowTables = forDb.filter((r) => r.effect === 'allow' && tableRule(r)).map((r) => r.table_name);
  const denyTables = new Set(forDb.filter((r) => r.effect === 'deny' && tableRule(r)).map((r) => r.table_name));
  const base = allowTables.length ? allTableNames.filter((t) => allowTables.includes(t)) : allTableNames;
  return new Set(base.filter((t) => !denyTables.has(t)));
}

export async function canUseDatabase(user, database) {
  if (isAdmin(user)) return true;
  const visible = await filterDatabases(user, [{ name: database }]);
  return visible.length === 1;
}

// ---- Admin-chosen tables the model may query, per database (app_settings key scope.<db> = JSON array). ----
// No entry = every table. Applies to everyone, admins included; role rules narrow further.
export async function scopeFor(database) {
  const raw = (await allSettings()).get(`scope.${database}`);
  if (!raw) return null;
  try { const list = JSON.parse(raw); return Array.isArray(list) ? new Set(list) : null; } catch { return null; }
}

// Tables the model may use for this user in this database: scope ∩ role visibility. null = all.
export async function allowedTableSet(user, database, allTableNames) {
  const scope = await scopeFor(database);
  const role = await visibleTableSet(user, database, allTableNames);
  if (!scope && !role) return null;
  const base = scope ? allTableNames.filter((t) => scope.has(t)) : allTableNames;
  return new Set(role ? base.filter((t) => role.has(t)) : base);
}

// Columns hidden from this user's role in one database, as a Set of "table.column" in lower case.
export async function hiddenColumns(user, database) {
  if (isAdmin(user)) return new Set();
  const rules = (await allRules()).filter((r) => r.role === user.role && r.database_name === database && columnRule(r) && r.effect === 'deny');
  return new Set(rules.map((r) => `${r.table_name}.${r.column_name}`.toLowerCase()));
}

// ---- Linked databases: the one case where a query may read a second database. ----
// A chat still has one database, but some topics are recorded in two (rule in server/prompts/RULES.md: alumni
// questions look at akanksha_production and akanksha). For a database listed here, run_sql also accepts
// `other.table` references to its linked databases, and the schema block describes them. Every other
// cross-database reference stays refused. The person's own access rules still apply to the linked database:
// one they cannot see is left out, and its hidden tables and columns stay hidden.
const LINKED_DATABASES = {
  akanksha_production: ['akanksha'],
  akanksha: ['akanksha_production'],
};

export async function linkedDatabases(user, database) {
  const out = [];
  for (const name of LINKED_DATABASES[database] || []) if (await canUseDatabase(user, name)) out.push(name);
  return out;
}
