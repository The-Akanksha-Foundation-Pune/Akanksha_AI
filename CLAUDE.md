# Akanksha AI

**Shown to people as "Prism"** (user decision, 24 Nov 2026): the page title, header, sign-in page, messages, Word export and the assistant's own name say Prism. Folder, repository, package, PM2 and database names, the `/akanksha-ai/` path, localStorage keys and the health check's `app: "Akanksha_AI"` (which `deploy/deploy.sh` looks for) stay as they are. Write "Prism" in any new text a user will read.

Internal data assistant for the Akanksha Foundation (schools NGO, Pune / Mumbai / Nagpur).
Staff pick a MySQL database, ask a question in plain English, and Claude answers by running
read-only SQL against it. Owner: Nikhil Aher (nikhil.aher@akanksha.org).

## Hard rule: SELECT only, on every database

When Claude runs SQL itself (probes, checks, verifying a fix), it fires **SELECT statements only**,
against **every** database including the app's own `AI` database. No INSERT, UPDATE, DELETE,
CREATE, ALTER, DROP or TRUNCATE from a script, a probe or a one-off command, and no "cleanup" of
rows. The only sanctioned way to change the AI database is a new numbered file in
`server/migrations/` that the user applies with `npm run migrate --prefix server`. Writes to the AI
database at runtime happen only through the app's own code paths (modules, `appWrite`), never by
Claude's hand. If a task seems to need a write, stop and ask.

## Review before answering

1. **This file** and the hard rule above, then `README.md` for run commands and endpoints, then `docs/ARCHITECTURE_AND_PRACTICES.md` for the token budget, the memory layers and the agreed order of upcoming work.
2. **`.env` keys, never values.** Run `sed -E 's/=.*/=/' .env` to see which keys exist. Do not print, quote or echo a value. Do not commit `.env`.
3. **The file you are about to change.** Most logic is in these files:
   - `server/src/registry.js` – loads `modules/*/index.js`, builds prompt + tools, dispatches tool calls, runs hooks, mounts routes
   - `server/src/routes/chat.js` – thin Claude loop + SSE stream; database/table listing
   - `server/src/modules/sql/` – schema prompt block + `run_sql` tool, logs `sql_runs`; `chart.js` decides server-side whether a result is chartable (zero tokens: Claude is never asked)
   - `server/src/modules/export/` – Markdown → Word route at `/api/modules/export/docx`
   - `server/src/modules/usage/` – `afterResponse` hook that writes `api_requests` with cost
   - `server/src/modules/glossary/` – `metric_definitions` → cached prompt block; CRUD at `/api/modules/glossary`
   - `server/src/modules/learned/` – thumbs up/down → `feedback` + `learned_queries`; closest approved examples injected per question
   - `server/src/modules/auth/` – sign-in (Google when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set, else labelled dev sign-in by email). Google is the OAuth 2.0 code flow copied from Alumni Connect (user request, 24 Nov 2026): `GET /google` redirects to Google with `hd`, `GET /google/callback` exchanges the code, checks verified email + domain, sets the session cookie; state is kept in a 10-minute HttpOnly cookie `akai_oauth`; refusals return to `/?signin=<reason>`, HMAC cookie sessions, `requireUser` / `requireRole` / `requireSuperAdmin`, users + access rules routes
   - `server/src/access.js` – role visibility from `access_rules`: `filterDatabases`, `visibleTableSet`, `canUseDatabase`, `isRestricted`
   - `server/src/modules/admin/` – `/summary` for the admin page (usage, cost per person, feedback rate, slowest/failed queries, learned queue); `/settings` GET/POST over a whitelist (`EDITABLE`: key, group, kind number|boolean|select, def, help) of `app_settings` keys; UI is `client/src/modules/settings.jsx` (tabs per group)
   - `server/src/modules/chats/` – server-side conversations/messages (per user), history built from the DB, Haiku summary rows (`role='system'`) when a chat outgrows `history_turns`, reuse of an identical recent answer (`answers.cache_hours`)
   - `server/src/modules/router/` – Haiku classifier (`lookup|aggregate|analysis`), three tiers: `router.lookup_model` (Haiku 5.5, low), `router.aggregate_model` (Sonnet 5.5, low), `router.analysis_model` (Opus 5.5, medium); `router.<tier>_effort` optional. `/api/chat/databases` returns `routing` + `tiers` for the header pill ("Auto · Haiku 5.5 → Opus 5.5"). User decision 16 Oct 2026: Haiku first, escalate by classification.
   - `server/src/modules/memory/` – `user_memory` (preferences block, cached per user) and `table_notes` (injected under the table in the schema block); needs migration 004
   - `server/src/modules/clarify/` – `ask_user` tool (order 12, static prompt): when a question lacks a detail that changes the answer (academic year, subject or overall, measure…), Claude asks up to 3 multiple-choice questions. The tool returns `stop: true`; `chat.js` then sends a `clarify` SSE event, stores the questions as the assistant's text (prefix `CLARIFY_PREFIX`, excluded from answer reuse) and ends the turn. `client/src/modules/clarify.jsx` shows them in a small dialog; the choices go back as the next user message ("Question: answer" lines). Added 16 Nov 2026 at the user's request. Switch off with `module.clarify.enabled = 0`. **Choices come from the database** (user request, 24 Nov 2026: the dialog offered academic years from the model's memory and left out 2026-2027): each question carries `options_sql`, one SELECT listing the real values; the server runs it through `distinctValues` in the sql module (same access rules as `run_sql`, 8 s cap, logged to `sql_runs`, cached 10 min) and shows up to 40 values, then the model's `extra_options` ("Overall", "All schools"). The model's own `options` are used only when the choices are not data or the query fails. The prompt tells the model to read the values from the table it will answer from; telling it to use the smallest table made it pick a 22-row lookup table and offer only one year.
   - `server/src/modules/autodb/` – `POST /api/modules/autodb/pick {question}`: a Haiku call picks the database for a new chat from a catalog of visible databases and their table names (cached 10 min per role; optional one-line description per database in `app_settings` key `dbinfo.<name>`). The header dropdown has an "Auto" option (default, `localStorage` `akanksha_ai_db_auto`); the client calls `/pick` before the first message of a new chat, then the chat is tied to that one database as before. Added 16 Nov 2026 at the user's request.
   - `server/src/modules/quota/` – prompts per role per day (IST) / per hour from `quota.<role>.per_day|per_hour` (0 = unlimited); `gate` hook refuses with 429 before streaming; `/me` for the chip
   - `server/src/modules/credits/` – prepaid dollar balance per person (user request, 24 Nov 2026). Admins exempt. First prompt grants `credits.<role>.usd` (analyst 5, viewer 2; 0 = no credit limit) into `users.credit_usd` and sets `credit_started_at`; balance = `credit_usd` − that person's `api_requests.cost_usd` since then. `gate` hook (order 6) refuses with 402 "Your credits are over…" at zero; `/me` for the header chip, `/users` + `POST /users/:id {add}` (super admin top-up) for the Admin Users table. Needs migration 005 (applied 24 Nov 2026); inert without it. Every grant and top-up also writes a `credit_grants` row (migration 006: user, amount, kind initial|topup|opening, granted_by), listed by `/history` in the Admin "Credit history" section. Monthly refill (`credits.monthly_refill`, default 0; migration 007 `users.credit_refilled_at`): on the first credit check in a new IST month (`/me`, the gate, or the admin `/users` list) a balance below the role amount is raised back to it, logged as kind `refill`; credit above the role amount is kept, nothing stacks. The refill itself was not exercised before 1 Dec 2026. Router, autodb and summary Haiku calls are not in `api_requests`, so they are not charged.
   - `server/src/modules/people/` – who is online and one-to-one chat between colleagues (user request, 24 Nov 2026; modelled on Alumni Connect's `live.js`; migration 010, applied 24 Nov 2026: `user_presence`, `direct_messages`). No socket: the client (`client/src/modules/people.jsx`, `OnlinePeople` in the header) posts `/presence` every 20 s and gets back who else is online (reported within 75 s, active users only) and unread counts; `/list` is everyone with access, online first; `GET/POST /chat/:userId` reads (marks read) and sends, max 2000 characters. The header shows up to 5 faces, then a "+N" button that opens the full list. Messages are private to the two people: not sent to Claude, not charged, not on the Admin page. Not built: group chat, editing or deleting a message. A new module folder is not picked up by `node --watch` until `touch server/src/index.js`.
   - `server/src/appDb.js` – app-database pool, `appWrite` (never throws), cached `app_settings`
   - `server/src/schema.js`, `server/src/db.js` – schema cache, read-only SQL guard, pools
   - `client/src/App.jsx` – the UI shell; `client/src/modules/` – per-module step and action renderers
4. **Which database a change touches.** Data databases (AFDW, tether_forms, Finance, …) are read-only, always, for the app and for Claude. The app's own tables live only in `AI_DB_NAME` (currently `AI`) and change only through migrations. Never create, alter or write tables in a data database. Never use the old `ai_*` tables in AFDW.
5. **The migrations folder** before touching the AI database. Schema changes are a new numbered file in `server/migrations/`, applied with `npm run migrate --prefix server`. Never edit an applied file.
6. **The claude-api skill** before changing anything that calls Anthropic. Model IDs, thinking, effort and fallbacks have drifted from older patterns; the skill is authoritative over memory.

## How it runs

```bash
npm run dev            # from this folder: Vite client on :5173 + Express server on :5000
npm run migrate --prefix server   # apply pending migrations to the AI database
```

- Preview in the Claude desktop browser pane: launch config `akanksha-ai` in the parent folder's `.claude/launch.json`. It injects `PORT=5173`, which is why `dotenv` loads with `override: true`.
- The server uses `node --watch`. A file that fails to parse is dropped from the watch list; `touch server/src/index.js` to restart after fixing it.
- Vite proxies `/api` to the server, so the client uses relative URLs.

## CI/CD and deploy (added 24 Nov 2026)

- `.github/workflows/ci-cd.yml`: on a pull request to `main`, CI on GitHub's machines (client lint + production build; server `npm run check`, migrations on an empty MySQL, `npm run smoke`). On a push to `main`, CI then the deploy job on a self-hosted runner labelled `akanksha-ai-prod`, only when the repository variable `DEPLOY_ENABLED` is `true`. Same arrangement as Alumni Connect.
- `deploy/deploy.sh` (build beside the live files, migrate, swap, PM2 restart, health check), `deploy/ecosystem.config.cjs`, `deploy/nginx-akanksha-ai.conf`, `deploy/env.production.example`; steps in `docs/DEPLOY.md`. As of 24 Nov 2026 nothing is set up on the server: no runner, no checkout, no nginx block.
- Production is planned under a sub-path: the client is built with `VITE_BASE_PATH=/akanksha-ai/` (`vite.config.js` `base`), `client/src/main.jsx` prefixes every `/api/...` fetch with it, and Express serves `client/dist` when `SERVE_CLIENT=1`. Keep writing API calls as `fetch('/api/...')`; a link or `window.open` to the API must use `import.meta.env.BASE_URL` itself.
- The deploy runs `npm run migrate` on the server. A new migration therefore reaches production with the merge that carries it; keep migrations additive so a rollback to the previous commit still works.
- The smoke test with `SMOKE_SIGNIN=1` creates a user row; that is for CI's throwaway database only.

## Auth and roles

- Every `/api` route except `/api/health*` and `/api/modules/auth/*` needs a session (`index.js`). `req.user` = `{id, email, name, role}`.
- **Access is by invitation** (user request, 24 Nov 2026; same logic as Alumni Connect's Admin > Access): signing in with an akanksha.org account is not enough. `upsertUser` only lets in a person with an active `users` row, or a super admin; everyone else is sent back with `signin=no_access`. A super admin adds people in the Admin "Access" section (`client/src/modules/access.jsx`): team (department in `AFDW.employees`, read-only, via `server/src/employees.js`; `EMPLOYEE_DB_NAME` default AFDW, `none` = typed email) → team member → role. `POST /api/modules/auth/users` copies name, team, designation, employee code from the directory (migration 008) and refuses an email that is not in it. Removing access = unticking Active.
- **Sign-in from Tether** (user request, 24 Nov 2026): Tether's Prism card (developers only, user decision) goes to Tether's `GET /auth/prism`, which redirects to `GET /api/modules/auth/sso?token=<jwt>` here, the same hand-off Tether uses for Alumni Connect. The auth module checks the HS256 signature with `INTEGRATION_JWT_SECRET` (= Tether's `JWT_SECRET`; empty = route off), the 10-minute expiry and the email domain, lets a token work once (in memory), then applies the same invitation rule as Google sign-in. Refusals return to `/?signin=sso_*`. Tether's env `PRISM_URL` = `<CLIENT_URL>/api/modules/auth/sso`. Tether's older built-in assistant at its `/ai` page was also called Prism; the card no longer leads to it.
- **Profile picture** (user request, 24 Nov 2026): `users.picture_url` (migration 009, applied 24 Nov 2026) is filled at sign-in from Google's `picture` or the Tether token's `picture` (`rememberPicture`, https addresses only) and returned as `user.picture`; `Avatar` in `auth.jsx` shows it beside the name in the sidebar, or the person's initials when there is none or it fails to load. It updates only when the person signs in again.
- **Back to Tether** (user request, 24 Nov 2026): a link at the top right of the header, shown only when `GET /api/modules/auth/me` returns `tetherUrl`: `TETHER_URL` if set, else the origin of `CLIENT_URL` when the app is served under a path (production), else none (local dev).
- Roles: `admin`, `analyst`, `viewer`. Super admins are the emails in `SUPER_ADMIN_EMAILS` (default nikhil.aher@akanksha.org): always active admins, the only ones who can change roles or access rules.
- `AUTH_MODE=dev` (no `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`) lets anyone sign in with an `AUTH_ALLOWED_DOMAIN` email and no password. Local use only; set both Google keys before anyone else gets the URL.
- Access rules apply to analyst/viewer; admins see everything; a role with no rules sees everything. An `allow` on a database limits the role to allowed databases; table `deny` hides a table; table `allow` rules (if any for that db) restrict to those tables. Hidden things look absent ("Unknown database"), not forbidden.
- Enforcement points, all driven by `access.js`: database chips (`/api/chat/databases`), table list (`/api/chat/tables`), the schema prompt block (sql module), and `run_sql` itself (hidden tables refused, cross-db `db.table` refs refused for everyone, SHOW/DESCRIBE/information_schema refused for restricted roles).
- Usage rows (`api_requests`, `sql_runs`, `feedback`, `learned_queries.created_by`) carry `user_id` from `req.user`.
- Prompt quotas count distinct `message_id` in `api_requests` per user; defaults admin unlimited, analyst 100/day 30/hour, viewer 30/day 10/hour; editable on the Admin page (super admin). Per-user overrides: `users.quota_per_day` / `quota_per_hour` (migration `003_user_quota.sql`; NULL = role limit, 0 = unlimited) beat the role limit; the auth module's `hasQuotaColumns()` keeps everything working before the migration is applied.
- Chats live on the server (`conversations`, `messages`); the client keeps only an unsent "local-" chat until its first message. History sent to the model = latest summary row + turns after it, capped to `history_turns` pairs. Only the database preference stays in localStorage.
- **Table scope** (admin, super admin edits): `app_settings` key `scope.<db>` = JSON array of table names; absent = all. `access.js` `allowedTableSet` = scope ∩ role visibility, applied to the schema block, `/api/chat/tables` and `run_sql` (admins included). Column rules (`access_rules.column_name`, migration 004) hide a column from a role: omitted from the schema and refused by word match in `run_sql`.
- MySQL pools run with `timezone: 'Z'` and `SET time_zone='+00:00'` per connection, so DATETIME columns round-trip as UTC (fixes "6 hours ago" on fresh messages).
- Query results reach the model as CSV (cells trimmed to 120 chars, `max_rows_per_query` rows, totals appended when cut). Schema block has a 1h cache TTL. Prompt says results are untrusted data and to answer briefly. `max_tokens` is a setting (default 16000 since 16 Nov 2026; at 4000 a school × grade × month table was cut mid-row). When a reply ends with `stop_reason: max_tokens` the client shows a note with a Continue button.
- Nightly (and 2 min after start) the learned module re-runs approved examples with LIMIT 1 and retires those that error; `POST /api/modules/learned/verify` runs it on demand. Thumbs up with an answer also writes `insights` (migration 004).
- Every user message gets `client/src/modules/promptFooter.jsx`: relative time (`createdAt`, from the server for stored chats), status tick derived from the following assistant message, copy, retry (= `send(text)` again).
- Every answer carries `meta` (model, route, effort, cost, latency): live from the `done` event, stored chats from `api_requests` grouped by `message_id` (`chats` GET). Rendered by `client/src/modules/answerMeta.jsx`; highlighted when the model differs from the default.
- Admin page (user request, 24 Nov 2026: one long page was "too complex"): seven sections picked from a side menu in `admin.jsx` (`TABS`; choice kept in localStorage `akanksha_ai_admin_tab`): Overview (alerts, tiles, daily charts), People (give access, roles, active), Limits & credits (role limits, per-person limits and top-ups, credit history), Data access (table scope, access rules), Knowledge (example queries, glossary, table notes, findings), Usage detail (cost per person/model, slow and failed queries), Settings (Model, Answers, Alerts). `SettingsPanel` takes `only={[groups]}` so each section shows the settings that belong to it. Put a new admin feature in the section it belongs to, not on Overview.
- UI layout (user requests, 13–16 Oct 2026): the sidebar holds only New chat and the last five chats. The database is chosen from a dropdown in the header (changing it starts a new chat); the glossary lives on the Admin page (`glossaryAdmin.jsx`), not the sidebar. The user block (name, allowance, role, Preferences, Admin, Sign out) is at the bottom of the left sidebar (`.sidebar-user`; moved from the header at the user's request, 24 Nov 2026), so it is hidden while the sidebar is collapsed. `focusTables` is still accepted by the API but nothing in the UI sets it.

## Modules (the registry)

A capability is one folder `server/src/modules/<name>/index.js` default-exporting
`{ name, order, tools, prompt(ctx), hooks, routes }`, all optional but `name`. The registry
concatenates prompt blocks in `order` (a block with `cache: true` becomes a cache breakpoint),
collects tool definitions, routes each `tool_use` to the module that owns the tool, and runs
`gate` (before headers; a thrown error with `.status` becomes the JSON response, used for quotas) / `beforeRequest` / `afterRound` / `afterResponse` hooks. Tool events sent to the client are tagged
with the module name; the client picks a renderer from `client/src/modules/index.jsx`
(`STEP_RENDERERS` for steps, `MESSAGE_ACTIONS` for buttons under an answer, `MESSAGE_BLOCKS` for blocks after the text such as charts, `SIDEBAR_PANELS`). `steps.jsx` wraps the steps: a rotating classroom phrase while working, one collapsed summary line afterwards; the user asked for no query list on screen while running. A module is switched
off with `app_settings` key `module.<name>.enabled = 0`. `GET /api/modules` lists what loaded.
`ctx` carries `database`, `focusTables`, `conversationId`, `messageId`, `userId` (null until
sign-in), `model`, `effort`, and `question` (set by the learned module's `beforeRequest`).
Prompt order today: base persona → sql schema (cached, order 10) → glossary (cached, 15) → learned
examples (uncached, 20). Anything that varies per question must have order > 15 or it breaks the
cache. To add a module: new folder, optional migration, optional client
renderer, restart. Keep `order` values stable; they decide prompt order and therefore cache hits.

## Architecture in one paragraph

Root `.env` holds all secrets. `index.js` loads it, then dynamically imports the routes so the
Anthropic client is constructed after the key exists. `GET /api/chat/databases` lists every
database the credentials can see minus MySQL system schemas and the AI database. `GET
/api/chat/tables?db=` returns tables, views and columns for one database, cached per database.
`POST /api/chat` takes `{messages, database, tables, conversationId, messageId}`; the registry
builds the system prompt (base persona + module blocks, schema block cached) and the tool list,
and the server loops up to `max_tool_rounds` rounds, streaming `text`, `tool`, `tool_result`,
`done` (with usage and cost) and `error` events over SSE. `run_sql`
allows one SELECT/SHOW/DESCRIBE statement, runs in a read-only transaction with a 20 s cap, and
returns at most 200 rows. `POST /api/modules/export/docx` turns an answer into Word. Chats are stored in
the browser's localStorage for now.

## Conventions and decisions

- **Model**: `CLAUDE_MODEL` in `.env` wins (now `claude-sonnet-5-5`, user decision 27 Oct 2026), else `app_settings.default_model`, else `claude-opus-5-5`. Router tiers: lookup Haiku, aggregate Sonnet, analysis Sonnet (`router.analysis_model` set to Sonnet the same day; Opus only if an admin changes it back). Effort, tool rounds, row cap and history length come from `app_settings` (30 s cache). Requests go through `client.beta.messages.stream` with `fallbacks: 'default'` and beta `server-side-fallback-2026-07-01`. Keep streaming; keep `max_tokens` 16000.
- **Prompt caching**: the schema block carries `cache_control`. Keep stable content first and anything that changes per request after it. Verify with `usage.cache_read_input_tokens` in the `done` event.
- **SQL safety is layered**: regex guard in `schema.js`, read-only transaction, row cap, `USE` blocked, database name validated against the list the credentials can see. Do not loosen any layer; add a DB user with SELECT-only grants before any public release.
- **Default-database preference is admin-only** (user request, 24 Nov 2026): `MEMORY_KEYS.default_database` has `adminOnly`; the memory module leaves it out of `GET /me` for other roles and refuses it on `POST /me` with 403. Nothing reads the stored value yet.
- **Database dropdown is admin-only** (user request, 24 Nov 2026): for analysts and viewers the header dropdown is disabled and `autoDb` is forced on (`canPickDb` in `App.jsx`). Client-side only; the API still accepts a `database` from any role, limited by access rules.
- **Per-chat database**: a conversation remembers its database, and choosing a database by hand still starts a new chat. In Auto mode (user request, 16 Nov 2026) every follow-up is re-checked by `/api/modules/autodb/pick` with `current` + `previous`; the chat stays put unless the question is clearly about other data, in which case the client sends `switchDatabase: true`, `chat.js` updates `conversations.database_name` and the answer starts with "Switched to the X database for this question." Each request still sees one schema; history is answer text only, so schemas never mix in the prompt. Replies from the clarify dialog skip the re-check (`keepDb`).
- **Tool results**: on a failed query return `tool_result` with `is_error: true`; never drop it. Append `final.content` whole (thinking blocks included) when continuing the loop.
- **Round limit**: after `max_tool_rounds` tool rounds the loop makes one more call with `tool_choice: {type: 'none'}` and a note appended to the last tool results, so every question ends in a written answer (16 Nov 2026; before this a question that used all its rounds was saved half-finished). The sql prompt tells the model its round budget, that totals must come from SQL (it once mis-added city totals by hand), and lists secondary indexes for tables of 100k+ rows.
- **Printed tables**: `run_sql` takes `show_table` / `table_title`. When true, the sql module queues the full result (up to `table.max_rows`, default 1000) as a Markdown table in `ctx.tables`, gives the model a 15-row preview plus totals, and `chat.js` appends the queued tables to the answer text after the loop. The model never retypes rows (16 Nov 2026: a retyped 278-row table took 77 s, cost $0.23 and had a copy error; printed it takes 15 s and $0.07). `buildHistory` cuts long tables in earlier answers to 12 lines before they go back to the model.
- **Views** count as tables in the schema and the sidebar, marked with a badge and no row count. Row counts come from `TABLE_ROWS` and are estimates.
- **Prism mark** (user chose "Light into answers" from six options, 24 Nov 2026): `client/src/modules/PrismMark.jsx`, a beam entering a prism and coming out as four chart bars; SVG + CSS only (`App.css`, "Prism mark"). `mode="once"` plays the entrance and rests (sidebar; hover replays), `"loop"` cycles (sign-in page, and the sidebar while an answer streams), `"still"` is static. `client/public/favicon.svg` is the still frame. Reduced-motion users get the still mark.
- **User guide and scope** (user request, 24 Nov 2026; users are not technical): `client/src/modules/guide.jsx` is the "What can I ask?" page (sidebar button and a link on the empty chat). It lists topics, what is recorded about each and clickable example questions, in plain words: no table, column or database names. A topic shows only if the person can see one of its `dbs`. Add a topic there when a new data source is added. `BASE_PROMPT` in `chat.js` tells the model to answer in plain language, to decline questions that are not about Akanksha's records (no query, say it is outside what Prism covers, suggest in-scope questions), and to say so plainly when the records do not hold what is asked.
- **Rules file** (user request, 24 Nov 2026): `server/prompts/RULES.md` is the Markdown file the model reads before answering. `server/src/rules.js` loads it (re-read when the file changes, no restart) into the system prompt right after `BASE_PROMPT` (stable text, in front of the cached schema block) and into the autodb picker's prompt, where a rule beats descriptions and "stay on the current database". Put the data owners' instructions there as plain bullets, not in code. First rule: consultant questions are answered from `consultant_mgmt` only; `AFDW` also has `consultant_*` tables, which are old copies, and `consultant_mgmt_test` is test data. Each chat still sees one database, so in a chat fixed on another database the model declines and asks for a new chat. Two more rules (user request, 25 Nov 2026): **alumni** questions look at `akanksha_production` and `akanksha` together (same 104 tables; on 25 Nov all 4,475 people in production were also in `akanksha`, which had 230 more), each person counted once, production wins where they differ; and **coverage**: the model checks which schools/years have rows and says what is recorded and what is not (known gap: 2023-2024 attendance covers 13 schools, from the Edustems rollout), never showing a gap as zero.
- **Linked databases** (25 Nov 2026, for the alumni rule): `LINKED_DATABASES` in `access.js` is the one exception to "cross-db refs refused for everyone". For a database listed there, `run_sql` accepts `other.table` references to its linked databases and the schema block lists the linked tables (name only when the columns match). The role's access rules, table scope and column rules apply in the linked database too. Only the alumni pair is listed; add a pair only when a rule in `RULES.md` needs it. `enforceVisibility` now also checks tables written as `db.table` against the role's rules (before, a qualified name skipped that check).
- **Styling**: plain CSS in `App.css` with tokens in `index.css`; dark mode follows the system. No UI library.
- **No answer tests yet** (CI has a boot-level smoke test only). Verify changes by running the app in the browser pane and asking a real question; check the server log and the SSE events. To check what the app wrote (usage, feedback, learned queries), SELECT from the AI database; do not insert test rows and do not delete anything.
- **Secrets**: anything pasted into `.env` has also been in a chat; rotate the Anthropic key before release.

## App database (`AI_DB_NAME`)

Created by `server/migrations/001_init.sql`, `002_learning.sql`, `003_user_quota.sql` and `004_memory.sql` (table_notes, user_memory, insights, access_rules.column_name). Code tolerates 004 not being applied: those features answer with a '… need migration 004' message. The usage module writes `api_requests`; the sql module writes `sql_runs`; the learned module writes `feedback` and `learned_queries`; the glossary module owns `metric_definitions`. Chats are still in localStorage, so `feedback.message_id` has no foreign key yet.

| Group | Tables |
|---|---|
| Chats | `users`, `conversations`, `messages` |
| Usage | `api_requests` (one row per Claude call: tokens, cache, cost, latency), `model_pricing`, view `v_daily_usage` |
| Queries | `sql_runs` (every statement Claude ran) |
| Learning | `feedback`, `learned_queries` (full-text on question), `metric_definitions` |
| Reports | `saved_reports`, `report_runs` |
| Control | `access_rules`, `app_settings`, `schema_migrations` |

`app_settings` seeds: `default_model`, `default_effort`, `max_tool_rounds`, `max_rows_per_query`, `history_turns`. Prefer reading limits from there once the registry lands.

## Roadmap (agreed, in order)

1. ~~Tool registry refactor~~ done (sql, export, usage modules).
2. ~~Learned queries + metric glossary~~ done. Thumbs up stores question + SQL as `approved` (setting `learned.auto_approve`); `learned.max_examples` controls how many are shown. Full-text match first, LIKE fallback.
3. ~~Charts in answers~~ done with no token cost: the sql module attaches `ui.chart` (`{type, x, y, data}`, ≤60 rows, ≤4 series) to a tool result when a label/date column plus numeric columns are present; `client/src/modules/charts.jsx` draws it with the dependency-free SVG `Chart.jsx` (bar, hbar, line, pie). Do not add chart instructions to the prompt; keep charts derived from query results. Charts are OFF by default (`charts.enabled` = 0, user decision 15 Oct 2026); the sql module attaches `ui.chart` only when the setting is 1.
4. ~~Roles via `access_rules`, usage per user, admin page~~ done. Google sign-in is wired but needs `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env` (reuse Alumni Connect's, from its `server/.env`) and the redirect URI `http://localhost:5173/api/modules/auth/google/callback` (plus the production one) added to that OAuth client in the Google Cloud console.
5. ~~Server-side chat storage~~ done (chats module). Shared chat links not yet.
6. ~~Model router, CSV results, answer reuse, nightly verification, alerts, table scope, table notes, user memory, insights, column rules~~ done (16 Oct 2026).
7. **Evaluation set** (`eval_cases`, `eval_runs`, `npm run eval`): deferred by the user; build next. Then embeddings for learned queries (needs an embedding API key) and shared chat links.

Not wanted: scheduled reports (user decision, 13 Oct 2026). `saved_reports` / `report_runs` tables stay unused.

## Data notes worth remembering

- `tether_forms.it_visit_submissions` holds IT visit forms; `answers_json` carries the multi-select fields (device_issues, applications_used). School names ending in TEST are test rows.
- `tether_forms.employees` is a view with salary and DOB fields; treat as sensitive.
- Text columns do not share one collation: joining `AFDW.full_assessment_data.school_name` to `city.school_name`, or `tether_forms.it_visit_submissions.email` to `employees.work_email`, fails with "Illegal mix of collations" unless both sides get `COLLATE utf8mb4_unicode_ci`. The sql module adds that hint to the error.
- `Netsuite.ChildAttendanceList` stops at 2023-24 and `akanksha_production` is alumni tracking; the autodb module's `DB_HINTS` (one line for each of the 16 databases) steer the Auto picker. Most lines were inferred from table names on 16 Nov 2026 and are not confirmed by the data owners. `akanksha` holds the same alumni tables as `akanksha_production` plus some people production lacks (the user wants both read, 25 Nov 2026); `consultant_mgmt_test` and `fams_mysql_dev` are test/dev databases.
- AFDW is the main data warehouse (116 tables): students, assessments (RAZ), schools, finance entries.
- The IT visits dashboard artifact lives at https://claude.ai/artifact/Rgg3v3vJxFFZTfBewrWyrr and is fed by CSV snapshots, not live queries.
