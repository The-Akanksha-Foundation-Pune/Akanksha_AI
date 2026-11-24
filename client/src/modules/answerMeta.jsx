// One quiet line under every answer: which model answered, at what effort, how long it took, and what it cost.
const NAMES = { 'claude-opus-5-5': 'Claude Opus 5.5', 'claude-sonnet-5-5': 'Claude Sonnet 5.5', 'claude-haiku-5-5': 'Claude Haiku 5.5', 'claude-fable-5-1': 'Claude Fable 5.1' }

export default function AnswerMeta({ message, defaultModel }) {
  const m = message.meta
  if (!m || !m.model || message.pending) return null
  const name = NAMES[m.model] || m.model
  const switched = defaultModel && m.model !== defaultModel
  const parts = [
    `Answered by ${name}`,
    m.route ? `routed as ${m.route}` : null,
    m.effort ? `${m.effort} effort` : null,
    m.latencyMs ? `${(m.latencyMs / 1000).toFixed(1)} s` : null,
    // Shown to everyone (user request, 24 Nov 2026): people with a credit balance need to see what each prompt took from it.
    m.costUsd != null ? `$${Number(m.costUsd).toFixed(4)}` : null,
  ].filter(Boolean)
  return <div className={`answer-meta ${switched ? 'switched' : ''}`} title="Model, routing and cost for this answer">{parts.join(' · ')}</div>
}
