// The organisation's employee directory: AFDW.employees. Read-only (SELECT only), as every data database is.
// Used only by Admin > Access, to pick who gets access by team and name instead of typing email addresses.
// Same logic as Alumni Connect's server/lib/employees.js.
//
// EMPLOYEE_DB_NAME   the database holding the directory (default: AFDW). Set to "none" for no directory;
//                    Admin > Access then takes a typed email.
// EMPLOYEE_TABLE     the table (default: employees).
import { getPool } from './db.js';

const quote = (name) => '`' + String(name).replace(/`/g, '``') + '`';
const domain = () => (process.env.AUTH_ALLOWED_DOMAIN || 'akanksha.org').trim().toLowerCase();
const dbName = () => (process.env.EMPLOYEE_DB_NAME || 'AFDW').trim();
export const configured = () => !!dbName() && dbName().toLowerCase() !== 'none';
const table = () => quote((process.env.EMPLOYEE_TABLE || 'employees').trim());

// A team is the employee's department. Only people with a work email on the organisation's domain are
// offered: that email is what they sign in with.
const TEAM = "COALESCE(NULLIF(TRIM(department), ''), 'No team')";
const NAME = "COALESCE(NULLIF(TRIM(full_name), ''), TRIM(CONCAT_WS(' ', first_name, last_name)))";
const EMAIL = 'LOWER(TRIM(work_email))';
const PERSON = `employee_code, ${NAME} AS name, ${EMAIL} AS email, NULLIF(TRIM(designation), '') AS designation, ${TEAM} AS team`;

const UNAVAILABLE = ['ER_NO_SUCH_TABLE', 'ER_BAD_DB_ERROR', 'ER_DBACCESS_DENIED_ERROR', 'ER_TABLEACCESS_DENIED_ERROR', 'ER_BAD_FIELD_ERROR'];

// Runs a directory query; null means "there is no usable directory".
async function read(sql, params) {
  if (!configured()) return null;
  try {
    const [rows] = await getPool(dbName()).query(sql, params);
    return rows;
  } catch (err) {
    if (UNAVAILABLE.includes(err.code)) { console.warn('[employees] directory not readable:', err.code); return null; }
    throw err;
  }
}

export const teams = () => read(`SELECT ${TEAM} AS team, COUNT(*) AS members FROM ${table()} WHERE ${EMAIL} LIKE ? GROUP BY team ORDER BY team`, ['%@' + domain()]);

export const members = (team) => read(`SELECT ${PERSON} FROM ${table()} WHERE ${EMAIL} LIKE ? AND ${TEAM} = ? ORDER BY name`, ['%@' + domain(), team]);

// The directory entry for an email; undefined if they are not in it; null when there is no directory to ask.
export async function byEmail(email) {
  const rows = await read(`SELECT ${PERSON} FROM ${table()} WHERE ${EMAIL} = ? LIMIT 1`, [String(email).trim().toLowerCase()]);
  return rows === null ? null : rows[0];
}
