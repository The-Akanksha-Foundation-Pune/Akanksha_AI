// Router module: a tiny Haiku call labels the question, then each tier gets its own model and effort.
//   lookup    -> router.lookup_model    (default Haiku 5.5, low effort)
//   aggregate -> router.aggregate_model (default Sonnet 5.5, low effort)
//   analysis  -> router.analysis_model  (default: the app default model, medium effort)
// Haiku is both the classifier and the first tier, so the cheap model decides when a bigger one is needed.
import Anthropic from '@anthropic-ai/sdk';
import { getSetting } from '../../appDb.js';

const client = new Anthropic();
export const TIERS = ['lookup', 'aggregate', 'analysis'];
const PROMPT =
  'You triage questions for a data assistant that answers with SQL. Reply with exactly one word:\n' +
  'lookup = find or list specific rows, describe a table, a simple count or filter on one table.\n' +
  'aggregate = group, sum, average, compare a few categories, one or two joins, a month-by-month breakdown.\n' +
  'analysis = several joins, multi-step reasoning, trends that need interpretation, anything asking why, what to do, or to compare across many dimensions.\n' +
  'When unsure between two, pick the harder one.';

export async function classify(question) {
  const r = await client.messages.create({
    model: 'claude-haiku-5-5',
    max_tokens: 5,
    system: PROMPT,
    messages: [{ role: 'user', content: String(question).slice(0, 1500) }],
  });
  const word = (r.content.find((b) => b.type === 'text')?.text || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  return TIERS.includes(word) ? word : 'analysis';
}

export async function tierConfig(tier, fallbackModel) {
  const defaults = {
    lookup: { model: 'claude-haiku-5-5', effort: 'low' },
    aggregate: { model: 'claude-sonnet-5-5', effort: 'low' },
    analysis: { model: fallbackModel, effort: 'medium' },
  }[tier];
  return {
    model: (await getSetting(`router.${tier}_model`, '')) || defaults.model,
    effort: (await getSetting(`router.${tier}_effort`, '')) || defaults.effort,
  };
}

export default {
  name: 'router',
  order: 1,
  hooks: {
    async beforeRequest(ctx, { messages }) {
      if ((await getSetting('router.enabled', '1')) !== '1') return;
      const last = [...(messages || [])].reverse().find((m) => m.role === 'user');
      if (!last) return;
      try {
        const tier = await classify(last.content);
        const cfg = await tierConfig(tier, ctx.model);
        ctx.route = tier;
        ctx.model = cfg.model;
        ctx.effort = cfg.effort;
      } catch (err) {
        console.warn('router: classification failed, using default model:', err.message);
      }
    },
  },
};
