// Usage module: records every Claude API call in api_requests with its cost.
import { appPool, appWrite } from '../../appDb.js';

let pricingCache = { at: 0, rows: [] };

async function priceFor(model) {
  if (Date.now() - pricingCache.at > 5 * 60_000) {
    try {
      const [rows] = await appPool().query('SELECT model, input_per_mtok, cache_read_per_mtok, cache_write_per_mtok, output_per_mtok FROM model_pricing WHERE effective_from <= CURDATE() ORDER BY effective_from DESC');
      pricingCache = { at: Date.now(), rows };
    } catch { pricingCache.at = Date.now(); }
  }
  return pricingCache.rows.find((r) => r.model === model) || null;
}

export function costOf(usage, price) {
  if (!price || !usage) return 0;
  const per = (n, p) => (Number(n) || 0) * Number(p) / 1_000_000;
  return per(usage.input_tokens, price.input_per_mtok)
    + per(usage.cache_read_input_tokens, price.cache_read_per_mtok)
    + per(usage.cache_creation_input_tokens, price.cache_write_per_mtok)
    + per(usage.output_tokens, price.output_per_mtok);
}

export default {
  name: 'usage',
  order: 100,
  hooks: {
    // info: { rounds: [{ response, latencyMs, error? }], totalLatencyMs }
    async afterResponse(ctx, info) {
      let total = 0;
      for (const [i, r] of (info.rounds || []).entries()) {
        const u = r.response?.usage || {};
        const model = r.response?.model || ctx.model;
        const cost = costOf(u, await priceFor(model));
        total += cost;
        appWrite(
          `INSERT INTO api_requests (message_id, conversation_id, user_id, database_name, model, effort, round_no, stop_reason,
             input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, thinking_tokens, cost_usd, latency_ms, error)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [ctx.messageId, ctx.conversationId, ctx.userId, ctx.database, model, ctx.effort, i + 1, r.response?.stop_reason || null,
           u.input_tokens || 0, u.cache_read_input_tokens || 0, u.cache_creation_input_tokens || 0, u.output_tokens || 0,
           u.output_tokens_details?.thinking_tokens || 0, cost.toFixed(6), r.latencyMs ?? null, r.error || null],
        );
      }
      info.costUsd = total;
    },
  },
};
