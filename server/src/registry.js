// Module registry. A module is a folder under ./modules/<name>/ whose index.js default-exports:
//   {
//     name,            // unique id, also the SSE "module" tag the client renders by
//     order,           // position of its prompt blocks and tools (lower first; keep stable for caching)
//     tools,           // [{ definition, execute(input, ctx) -> { content, isError?, ui?, stop? }, describe?(input) -> ui }]
//                      //   stop: true ends the chat loop after this round (the clarify module uses it to hand over to the user)
//     prompt(ctx),     // -> [{ text, cache?: true }] system prompt blocks, or []
//     hooks,           // { gate(ctx) may throw {status,message} to refuse; beforeRequest(ctx); afterRound(ctx, info); afterResponse(ctx, info) }
//     routes,          // express Router mounted at /api/modules/<name>
//   }
// Every part is optional except name. Modules are switched off with app_settings key module.<name>.enabled = 0.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { getSetting } from './appDb.js';

const MODULES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'modules');
const modules = [];

export async function loadModules() {
  modules.length = 0;
  const names = fs.readdirSync(MODULES_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  for (const dir of names) {
    const entry = path.join(MODULES_DIR, dir, 'index.js');
    if (!fs.existsSync(entry)) continue;
    const mod = (await import(pathToFileURL(entry).href)).default;
    if (!mod?.name) { console.warn(`module ${dir}: no name export, skipped`); continue; }
    modules.push({ order: 100, tools: [], hooks: {}, ...mod });
  }
  modules.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  console.log('modules loaded:', modules.map((m) => m.name).join(', ') || 'none');
  return modules;
}

export const listModules = () => modules.map((m) => ({ name: m.name, order: m.order, tools: m.tools.map((t) => t.definition.name), hasPrompt: !!m.prompt, hasRoutes: !!m.routes }));

async function enabledModules() {
  const out = [];
  for (const m of modules) {
    const flag = await getSetting(`module.${m.name}.enabled`, '1');
    if (flag !== '0' && flag !== 'false') out.push(m);
  }
  return out;
}

// System prompt blocks from every enabled module, in module order. `cache: true` becomes a cache breakpoint (max 4).
export async function buildSystem(ctx, baseBlocks = []) {
  const blocks = [...baseBlocks];
  for (const m of await enabledModules()) {
    if (!m.prompt) continue;
    const got = await m.prompt(ctx);
    for (const b of got || []) if (b?.text) blocks.push(b);
  }
  let breakpoints = 0;
  return blocks.map((b) => {
    const block = { type: 'text', text: b.text };
    if (b.cache && breakpoints < 4) { block.cache_control = b.ttl ? { type: 'ephemeral', ttl: b.ttl } : { type: 'ephemeral' }; breakpoints++; }
    return block;
  });
}

// Tool definitions from every enabled module, in a stable order.
export async function buildTools(ctx) {
  const defs = [];
  for (const m of await enabledModules()) {
    for (const t of m.tools) {
      if (t.available && !(await t.available(ctx))) continue;
      defs.push(t.definition);
    }
  }
  return defs;
}

function findTool(name) {
  for (const m of modules) for (const t of m.tools) if (t.definition.name === name) return { module: m, tool: t };
  return null;
}

// Describes a tool call for the client before it runs.
export function describeTool(name, input) {
  const hit = findTool(name);
  if (!hit) return { module: 'unknown', tool: name, ui: {} };
  return { module: hit.module.name, tool: name, ui: hit.tool.describe ? hit.tool.describe(input) : {} };
}

// Runs a tool and returns what goes back to Claude plus what the client should show.
export async function executeTool(name, input, ctx) {
  const hit = findTool(name);
  if (!hit) return { content: `Error: unknown tool ${name}`, isError: true, ui: { error: `Unknown tool ${name}` } };
  const started = Date.now();
  try {
    const r = await hit.tool.execute(input, ctx);
    return { content: r.content, isError: !!r.isError, ui: r.ui || {}, stop: !!r.stop, durationMs: Date.now() - started };
  } catch (err) {
    return { content: `Error: ${err.message}`, isError: true, ui: { error: err.message }, durationMs: Date.now() - started };
  }
}

// Like runHook, but a thrown error stops the request: the caller answers with err.status (default 400).
export async function runGate(ctx, info) {
  for (const m of await enabledModules()) {
    const fn = m.hooks?.gate;
    if (fn) await fn(ctx, info);
  }
}

export async function runHook(hook, ctx, info) {
  for (const m of await enabledModules()) {
    const fn = m.hooks?.[hook];
    if (!fn) continue;
    try { await fn(ctx, info); } catch (err) { console.warn(`module ${m.name} ${hook} hook failed:`, err.message); }
  }
}

export function mountRoutes(app) {
  for (const m of modules) if (m.routes) app.use(`/api/modules/${m.name}`, m.routes);
}
