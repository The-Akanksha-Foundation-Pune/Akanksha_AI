// The rules file: server/prompts/RULES.md. Plain Markdown that the data owners' instructions go into, such as
// "consultant questions are answered from consultant_mgmt". It is read into two places:
//   - the system prompt of every answer (routes/chat.js), right after the base prompt, so it is in front of the
//     cached schema block and costs nothing extra once cached;
//   - the database picker (modules/autodb), where a rule beats the catalog's descriptions.
// The file is re-read when it changes on disk, so an edit needs no restart; the next request picks it up (and
// rewrites the prompt cache once).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../prompts/RULES.md');
let cached = { mtime: 0, text: '' };

export function rulesText() {
  try {
    const mtime = fs.statSync(FILE).mtimeMs;
    if (mtime !== cached.mtime) cached = { mtime, text: fs.readFileSync(FILE, 'utf8').trim() };
  } catch {
    cached = { mtime: 0, text: '' }; // no file: no extra rules
  }
  return cached.text;
}

// When the rules file last changed (null when there is none). Answers saved before this are not reused.
export function rulesChangedAt() {
  rulesText();
  return cached.mtime ? new Date(cached.mtime) : null;
}
