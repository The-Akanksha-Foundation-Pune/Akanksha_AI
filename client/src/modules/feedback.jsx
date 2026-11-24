import { useState } from 'react'

// Thumbs up / down on an answer. Up teaches the learned-queries module; down marks it as wrong.
export default function FeedbackAction({ conversation, message, database, onMessageChange }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const current = message.feedback || 0

  const rate = async (rating) => {
    if (busy) return
    const idx = conversation.messages.findIndex((m) => m.id === message.id)
    const question = [...conversation.messages.slice(0, idx)].reverse().find((m) => m.role === 'user')?.content || ''
    const queries = (message.steps || [])
      .filter((s) => s.module === 'sql' && s.status === 'done' && s.ui?.sql)
      .map((s) => ({ sql: s.ui.sql, rowCount: s.ui.rowCount }))
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/modules/learned/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: message.id, conversationId: conversation.id, database, question, rating, queries, answer: rating === 1 ? message.content : undefined }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || `Feedback failed (${res.status})`)
      onMessageChange?.({ feedback: rating, learnedId: d.learnedId ?? message.learnedId ?? null })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="feedback">
      <button type="button" className={`action-btn icon ${current === 1 ? 'on' : ''}`} onClick={() => rate(1)} disabled={busy} title="Correct answer. Remember how it was done.">👍</button>
      <button type="button" className={`action-btn icon ${current === -1 ? 'on bad' : ''}`} onClick={() => rate(-1)} disabled={busy} title="Wrong or unhelpful answer">👎</button>
      {current === 1 && <span className="hint">{message.learnedId ? 'Saved as an example for future questions' : 'Thanks'}</span>}
      {current === -1 && <span className="hint">Noted</span>}
      {error && <span className="error-text small">{error}</span>}
    </span>
  )
}
