// Core chat loop. Everything Claude can do comes from the module registry; this file only streams.
import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { loadSchema, clearSchemaCache } from '../schema.js';
import { listDatabases, assertDatabase, refreshPool, defaultDatabase } from '../db.js';
import { getSetting, getNumberSetting } from '../appDb.js';
import { buildSystem, buildTools, describeTool, executeTool, runHook, runGate } from '../registry.js';
import { filterDatabases, allowedTableSet, canUseDatabase } from '../access.js';
import { clarifyText, CLARIFY_PREFIX } from '../modules/clarify/index.js';
import { ownConversation, setConversationDatabase, addMessage, finishMessage, touchConversation, buildHistory, maybeCompact, findRecentAnswer } from '../modules/chats/index.js';

const router = Router();
const client = new Anthropic();

const currentModel = async () => process.env.CLAUDE_MODEL || (await getSetting('default_model', 'claude-opus-5-5'));
const BASE_PROMPT = 'You are Prism, a data assistant for the Akanksha Foundation team.';

const ROUND_LIMIT_NOTE =
  '[System note: the query limit for this question is reached and no more queries can run. Answer now from the results above. ' +
  'Give what the data supports, say plainly what could not be checked and why (for example a query that timed out), and suggest how the user could narrow the question.]';

function sendEvent(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function resolveDb(req) {
  const name = await assertDatabase(String(req.query.db || req.body?.database || defaultDatabase()));
  if (!(await canUseDatabase(req.user, name))) throw new Error(`Unknown database "${name}"`); // hidden tables and databases look absent, not forbidden
  return name;
}

// GET /api/chat/databases
router.get('/databases', async (req, res) => {
  try {
    if (req.query.refresh === '1') { await refreshPool(); clearSchemaCache(); }
    const { databases, loadedAt } = await listDatabases(req.query.refresh === '1');
    const visible = await filterDatabases(req.user, databases);
    const def = visible.some((d) => d.name === defaultDatabase()) ? defaultDatabase() : (visible[0]?.name || '');
    const routing = (await getSetting('router.enabled', '1')) === '1';
    const model = await currentModel();
    const { tierConfig } = await import('../modules/router/index.js');
    const tiers = routing ? Object.fromEntries(await Promise.all(['lookup', 'aggregate', 'analysis'].map(async (t) => [t, (await tierConfig(t, model)).model]))) : null;
    res.json({ loadedAt, default: def, databases: visible, model, routing, tiers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chat/tables?db=NAME
router.get('/tables', async (req, res) => {
  try {
    const refresh = req.query.refresh === '1';
    if (refresh) await refreshPool();
    const database = await resolveDb(req);
    const { tables, loadedAt } = await loadSchema(database, refresh);
    const allowed = await allowedTableSet(req.user, database, tables.map((t) => t.name));
    res.json({ loadedAt, database, tables: allowed ? tables.filter((t) => allowed.has(t.name)) : tables });
  } catch (err) {
    res.status(err.message.startsWith('Unknown database') ? 400 : 500).json({ error: err.message });
  }
});

// POST /api/chat  { messages, database?, tables?, conversationId?, messageId? }
// SSE: text | tool {id, module, tool, ui} | tool_result {id, ui, error?} | done | error
router.post('/', async (req, res) => {
  const { messages, tables: focusTables, conversationId, messageId } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  let database;
  try { database = await resolveDb(req); } catch (err) { return res.status(400).json({ error: err.message }); }

  // A conversation id must belong to the signed-in user; then the chat is stored server-side.
  const conv = conversationId ? await ownConversation(req.user.id, conversationId).catch(() => null) : null;
  if (conversationId && !conv) return res.status(404).json({ error: 'No such chat' });
  // A chat stays on its database unless the client (Auto mode) asks to move it for this question.
  const switched = !!(conv && conv.database_name !== database && req.body?.switchDatabase === true);
  if (conv && conv.database_name !== database && !switched) return res.status(400).json({ error: 'This chat belongs to another database' });
  if (switched) await setConversationDatabase(conv.id, database);

  const ctx = {
    database,
    focusTables: Array.isArray(focusTables) ? focusTables.map(String) : [],
    conversationId: conversationId || null,
    messageId: messageId || null,
    userId: req.user?.id ?? null,
    // quota_per_day / quota_per_hour are the per-user overrides (migration 003); without them the quota gate fell back to the role limit.
    user: req.user ? { id: req.user.id, email: req.user.email, role: req.user.role, quota_per_day: req.user.quota_per_day ?? null, quota_per_hour: req.user.quota_per_hour ?? null } : null,
    model: await currentModel(),
    effort: await getSetting('default_effort', 'medium'),
  };
  try {
    await runGate(ctx, { messages });
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message, quota: err.quota || null, credits: err.credits || null });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const abort = new AbortController();
  res.on('close', () => abort.abort());

  const maxRounds = await getNumberSetting('max_tool_rounds', 8);
  const maxTokens = await getNumberSetting('max_tokens', 16000);
  const historyTurns = await getNumberSetting('history_turns', 10);
  const rounds = [];
  const startedAt = Date.now();
  const question = String([...messages].reverse().find((m) => m.role === 'user')?.content || '');
  const userMessageId = req.body?.userMessageId || null;
  let assistantId = null;
  let streamedText = '';

  try {
    // Persist the question and an assistant placeholder; build history from the stored conversation.
    let history, summary = null;
    if (conv) {
      const before = await buildHistory(conv.id, historyTurns);
      await addMessage({ id: userMessageId || undefined, conversationId: conv.id, role: 'user', content: question });
      assistantId = await addMessage({ id: ctx.messageId || undefined, conversationId: conv.id, role: 'assistant', content: '', status: 'streaming' });
      ctx.messageId = assistantId;
      summary = before.summary;
      history = [...before.turns, { role: 'user', content: question }];
      if (before.totalTurns === 0) await touchConversation(conv.id, { title: question.slice(0, 80) });

      // Identical recent question from the same person: reuse the earlier answer, no model call.
      if (before.totalTurns === 0) {
        const hours = await getNumberSetting('answers.cache_hours', 24);
        const hit = await findRecentAnswer(req.user.id, database, question, hours).catch(() => null);
        if (hit && !hit.content.includes(CLARIFY_PREFIX)) { // a stored clarifying turn is not an answer
          sendEvent(res, 'text', { text: hit.content });
          sendEvent(res, 'done', { database, stop_reason: 'end_turn', refusal: null, model: null, cached: true, cachedAt: hit.created_at, usage: null, rounds: 0, costUsd: 0, quota: ctx.quota || null, credits: ctx.credits || null });
          await finishMessage(assistantId, { content: hit.content, status: 'complete' });
          await touchConversation(conv.id, {});
          return res.end();
        }
      }
    } else {
      history = messages.slice(-(historyTurns * 2)).map((m) => ({ role: m.role, content: String(m.content) }));
      if (history[0]?.role !== 'user') history.shift();
    }

    if (switched) {
      // Say so in the answer itself, so the user and later turns can see where each answer came from.
      const text = `_Switched to the ${database} database for this question._\n\n`;
      streamedText += text;
      sendEvent(res, 'text', { text });
    }

    await runHook('beforeRequest', ctx, { messages: history });
    const system = await buildSystem(ctx, [{ text: BASE_PROMPT }]);
    if (summary) system.push({ type: 'text', text: summary }); // after the cached blocks, since it changes per conversation
    const tools = await buildTools(ctx);

    let final;
    let clarify = null; // set when a tool hands the turn back to the user with questions
    let needsBreak = false; // text was streamed in an earlier round; separate it from the next round's text
    for (let round = 0; round <= maxRounds; round++) {
      const t0 = Date.now();
      // The round after the last allowed tool round runs with tools switched off, so every question ends
      // in a written answer instead of stopping mid-investigation.
      const lastRound = round === maxRounds;
      if (lastRound && round > 0) {
        const tail = history[history.length - 1];
        if (Array.isArray(tail?.content)) tail.content.push({ type: 'text', text: ROUND_LIMIT_NOTE });
      }
      const stream = client.beta.messages.stream(
        {
          model: ctx.model,
          max_tokens: maxTokens,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: ctx.effort },
          system,
          tools,
          ...(lastRound ? { tool_choice: { type: 'none' } } : {}),
          messages: history,
        },
        { signal: abort.signal },
      );
      stream.on('text', (text) => {
        if (needsBreak) { needsBreak = false; text = '\n\n' + text; }
        streamedText += text;
        sendEvent(res, 'text', { text });
      });
      final = await stream.finalMessage();
      if (final.content.some((b) => b.type === 'text' && b.text.trim())) needsBreak = true;
      rounds.push({ response: final, latencyMs: Date.now() - t0 });
      await runHook('afterRound', ctx, { round, response: final });

      if (final.stop_reason !== 'tool_use') break;

      history.push({ role: 'assistant', content: final.content });
      const results = [];
      for (const tu of final.content.filter((b) => b.type === 'tool_use')) {
        sendEvent(res, 'tool', { id: tu.id, ...describeTool(tu.name, tu.input) });
        const r = await executeTool(tu.name, tu.input, ctx);
        sendEvent(res, 'tool_result', { id: tu.id, ui: r.ui, error: r.isError ? (r.ui?.error || r.content) : undefined });
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: r.content, is_error: r.isError });
        if (r.stop && !r.isError && r.ui?.questions?.length) clarify = r.ui.questions;
      }
      if (clarify) {
        // The turn ends here: show the questions, store them as this message's text, wait for the user's reply.
        const text = (streamedText.trim() ? '\n\n' : '') + clarifyText(clarify);
        streamedText += text;
        sendEvent(res, 'text', { text });
        sendEvent(res, 'clarify', { questions: clarify });
        break;
      }
      history.push({ role: 'user', content: results });
    }

    // Results a tool asked to show in full go under the answer as-is; the model never retypes them.
    if (!clarify && ctx.tables?.length) {
      const text = (streamedText.trim() ? '\n\n' : '') + ctx.tables.slice(-3).join('\n\n');
      streamedText += text;
      sendEvent(res, 'text', { text });
    }

    const info = { rounds, totalLatencyMs: Date.now() - startedAt };
    await runHook('afterResponse', ctx, info);
    if (conv) {
      await finishMessage(assistantId, { content: streamedText, status: 'complete' });
      await touchConversation(conv.id, { model: final?.model });
      maybeCompact(conv.id, historyTurns); // runs in the background; next request picks up the summary
    }
    sendEvent(res, 'done', {
      database,
      stop_reason: clarify ? 'clarify' : final?.stop_reason,
      refusal: final?.stop_reason === 'refusal' ? final.stop_details : null,
      model: final?.model,
      route: ctx.route || null,
      effort: ctx.effort,
      usage: final?.usage,
      rounds: rounds.length,
      latencyMs: info.totalLatencyMs,
      costUsd: info.costUsd ?? null,
      credits: ctx.credits ? { ...ctx.credits, spent: ctx.credits.spent + (info.costUsd || 0), balance: Math.max(0, ctx.credits.balance - (info.costUsd || 0)) } : null,
      quota: ctx.quota ? { ...ctx.quota, used: { today: ctx.quota.used.today + 1, hour: ctx.quota.used.hour + 1 }, remaining: { day: ctx.quota.remaining.day == null ? null : ctx.quota.remaining.day - 1, hour: ctx.quota.remaining.hour == null ? null : ctx.quota.remaining.hour - 1 } } : null,
    });
  } catch (err) {
    if (!abort.signal.aborted) {
      const message =
        err instanceof Anthropic.AuthenticationError ? 'Invalid Anthropic API key'
        : err instanceof Anthropic.RateLimitError ? 'Rate limited, please retry shortly'
        : err?.message || 'Unknown error';
      console.error('chat error:', err?.status || '', message);
      sendEvent(res, 'error', { message });
      if (assistantId) await finishMessage(assistantId, { content: streamedText, status: 'error', error: message });
      await runHook('afterResponse', ctx, { rounds: [...rounds, { response: null, latencyMs: null, error: message }], totalLatencyMs: Date.now() - startedAt });
    }
  } finally {
    res.end();
  }
});

export default router;
