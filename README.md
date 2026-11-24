# Akanksha_AI

React (Vite) chat frontend + Node.js (Express) backend that talks to Claude and to the Akanksha MySQL database.

## Run
```bash
npm run dev
```
- Client: http://localhost:5173
- Server: http://localhost:5000
  - `GET /api/health` – server up
  - `GET /api/health/db` – MySQL connection check
  - `GET /api/chat/databases` – databases these credentials can see, with table counts
  - `GET /api/chat/tables?db=NAME` – tables and columns for one database
  - `POST /api/modules/export/docx` – turns an answer's Markdown into a Word document
  - `GET /api/modules` – which modules loaded and the tools they provide
  - `/api/modules/auth/*` – me, google, dev, logout, users, rules
  - `GET /api/modules/admin/summary?days=30` – admin page data
  - `GET|POST /api/modules/admin/settings` – editable settings (quotas, effort, limits)
  - `GET /api/modules/quota/me` – the signed-in user's prompt allowance
  - `GET|POST|DELETE /api/modules/glossary` – metric definitions per database
  - `POST /api/modules/learned/feedback` – thumbs up/down on an answer; up stores the question and SQL as an example
  - `GET /api/modules/learned?db=` and `/preview?db=&q=` – stored examples and what Claude would be shown for a question
  - `POST /api/chat` – streams a Claude reply as Server-Sent Events; body carries `database` and Claude can call a read-only `run_sql` tool against it

## Sign-in and roles
Everyone signs in. With `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` set (the same Google OAuth app as Alumni Connect and Tether; copy both from Alumni Connect's `server/.env`), that is Google sign-in limited to `AUTH_ALLOWED_DOMAIN` accounts. The callback `<CLIENT_URL>/api/modules/auth/google/callback` (locally `http://localhost:5173/api/modules/auth/google/callback`, or set `GOOGLE_CALLBACK_URL`) must be added under Authorised redirect URIs on that OAuth client. Without them, `AUTH_MODE=dev` shows a development sign-in that accepts any address on that domain with no password: fine on a laptop, never on a server.

Chats are stored on the server per user. Roles are `admin`, `analyst`, `viewer`. Emails in `SUPER_ADMIN_EMAILS` are super admins who manage users and access rules from the **Admin** page (sidebar). Access rules decide which databases and tables analysts and viewers can see; the database chips, the table list, Claude's schema prompt and the query runner all respect them, so a restricted user cannot even ask about hidden data.

Each role has a prompt allowance per day and per hour (0 = unlimited), set on the Admin page under **Prompt limits per role**; users see what they have left under their name, and a prompt past the limit is refused with a message. Days reset at midnight India time. A super admin can also give one person their own limit in the Users table (blank = role limit, 0 = unlimited); this needs migration `003_user_quota.sql`.

Settings on the Admin page are grouped into Prompt limits, Model, Answers, Learning and Alerts. The Admin page also has **Tables the model may query** (tick the tables per database that Claude may see and use; applies to everyone), **Table notes**, **Confirmed findings** (thumbs-up answers, searchable) and column-level access rules. Each user has **Preferences** (answer style, default database, notes the assistant keeps in mind).

The Admin page also shows spend and tokens per day, cost per person, thumbs-up rate, cache hit rate, slowest and failed queries, and the learned-query approval queue.

## Secrets
All secrets live in the root `.env` (git-ignored). The server loads it with `dotenv` and `.env` values override any injected environment variables.

| Key | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key |
| `CLAUDE_MODEL` | Optional, defaults to `claude-sonnet-5-5`; set `claude-opus-5-5` for harder questions |
| `DB_HOST` `DB_USER` `DB_PASSWORD` `DB_PORT` | MySQL connection |
| `DB_NAME` | Database selected by default; any database the user can see is selectable in the UI |
| `AI_DB_NAME` | The app's own database for chats, token usage, learned queries and settings. Hidden from the selector. |
| `PORT` | Express port (default 5000) |
| `CLIENT_URL` | Allowed CORS origin |
| `AUTH_MODE` `GOOGLE_CLIENT_ID` `GOOGLE_CLIENT_SECRET` `GOOGLE_CALLBACK_URL` `AUTH_ALLOWED_DOMAIN` `SUPER_ADMIN_EMAILS` | Sign-in configuration (see above) |
| `JWT_SECRET` | Signs session cookies |

Copy `.env.example` to `.env` on a fresh machine and fill in the values.

## App database
The app keeps its own tables in `AI_DB_NAME` (default `AI`), separate from the data it answers questions about. Schema lives in `server/migrations/*.sql` and is applied with:
```bash
npm run migrate --prefix server
```
The runner records applied files in `schema_migrations`, so it is safe to re-run. Add a new numbered file for every change.

## What happens to a question
1. The router (a tiny Haiku call) labels it lookup, aggregate or analysis. Lookups are answered by Haiku, aggregates and analysis by Sonnet; each tier's model is a setting, so Opus can be put back on analysis from the Admin page. The header pill reads "Auto · Haiku 5.5 → Opus 5.5" while routing is on. Every answer says which model answered, how it was routed, the effort, and the time taken; admins also see the cost. The Admin page's "By model" table shows answers, cost per answer and latency per model.
2. If the same person asked the exact same question on the same database recently, the earlier answer is reused at no cost.
3. The prompt is built from modules: schema of the tables the admin allowed (1 h cached), glossary, the user's preferences, closest confirmed examples, a summary of the earlier conversation if it is long, then the last turns.
4. Claude runs read-only SQL through `run_sql`; results come back as CSV, trimmed and capped, with totals when cut.
5. The answer streams to the browser and is stored with the chat; usage and queries are logged per user.

## Modules
Every AI capability is a folder in `server/src/modules/<name>/` exporting `{ name, order, tools, prompt(ctx), hooks, routes }`. The registry assembles the prompt and tool list, routes tool calls, and runs hooks. The client renders a module's tool steps through `client/src/modules/index.jsx`. Disable a module with `app_settings` key `module.<name>.enabled = 0`.

## Structure
```
client/   React UI (src/App.jsx is the chat screen)
server/   Express API
  src/index.js        entry, loads .env, loads modules, mounts routes
  src/registry.js     module registry: prompt blocks, tools, hooks, routes
  src/modules/sql/    schema prompt + run_sql tool (logs sql_runs)
  src/modules/export/ Markdown to .docx export (marked + docx)
  src/modules/usage/  logs every Claude call to api_requests with cost
  src/modules/glossary/ metric definitions in the prompt + CRUD routes
  src/modules/learned/  feedback, learned question/SQL examples
  src/modules/auth/     sign-in, sessions, users, access rules
  src/modules/admin/    usage and quality summary + settings for the Admin page
  src/modules/quota/    prompt limits per role
  src/modules/chats/    server-side chats, summaries, answer reuse
  src/modules/router/   cheap classifier that picks the model per question
  src/modules/memory/   user preferences and table notes
  src/access.js         role visibility of databases and tables
  src/appDb.js        app-database helpers and cached app_settings
  src/db.js           one MySQL pool per database (mysql2), database list
  src/schema.js       per-database schema cache and read-only SQL runner
  src/routes/chat.js  databases, tables and the Claude streaming loop
  migrations/         app schema (AI database), applied by scripts/migrate.mjs
client/src/modules/   per-module step renderers and message actions
```
Chats are kept in the browser's localStorage.

## How data questions work
- On first request the server loads every table and column from `information_schema` and puts the schema in the (prompt-cached) system prompt.
- Claude gets one tool, `run_sql`, which only allows single SELECT/SHOW/DESCRIBE statements, runs in a read-only transaction with a 20s limit, and returns at most 200 rows.
- The database for a chat is picked from the dropdown in the header. Changing it starts a new chat, so history never mixes schemas. The sidebar shows only New chat and your recent chats. Switching databases mid-chat starts a new chat so history never mixes schemas.
- The sidebar lists all tables and views of the selected database (scrollable, filterable). The refresh button re-reads `.env`, reconnects if the DB settings changed, and reloads the schema from `information_schema`. Ticking tables tells Claude to focus on them; leaving all unticked lets it use any table.
- While Claude works, the answer area shows a rotating classroom-themed status line (`client/src/modules/steps.jsx`) instead of a list of queries. Once the answer is in, the queries fold into one line ("Ran 3 queries · 120 ms") that expands to the SQL and row counts.
- Under every prompt: how long ago it was sent, a tick that becomes a double tick once answered, Copy, and Retry (asks the same question again).
- Every answer has 👍 / 👎. A thumbs up saves the question and the SQL that answered it; later questions on the same database get the closest confirmed examples in the prompt, so Claude copies a proven query instead of exploring.
- The **Glossary** on the Admin page holds agreed definitions (for one database or all). They go into every prompt so terms like "active student" always mean the same thing.
- **Charts for free (off by default).** Turn on *Answers → Charts in answers* in Admin settings. When on and a query result has a label or date column plus numbers, the server attaches a compact chart spec to that step and the answer shows a chart card (bars, rows, line or pie, switchable, hideable). Claude is never asked to draw anything, so prompts and answers cost exactly the same tokens as before.
- Every finished answer has a **Download as Word** button. The .docx keeps headings, tables, lists, code and links. Queries are not included.
