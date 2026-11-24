import { useEffect, useState } from 'react'

// Small dialog for the clarify module: Claude asks up to three short questions before it queries.
// The chosen answers go back as the user's next message, one "Question: answer" line each.
export default function ClarifyDialog({ questions, onSubmit, onClose }) {
  const [picked, setPicked] = useState({}) // question index -> option text
  const [other, setOther] = useState({}) // question index -> typed text

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const answer = (i) => (other[i]?.trim() ? other[i].trim() : picked[i] || '')
  const complete = questions.every((_, i) => answer(i))

  const submit = (e) => {
    e.preventDefault()
    if (!complete) return
    onSubmit(questions.map((q, i) => `${q.question.replace(/[?:\s]+$/, '')}: ${answer(i)}`).join('\n'))
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal clarify" onClick={(e) => e.stopPropagation()} onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="clarify-title">
        <div className="modal-head">
          <h2 id="clarify-title">A quick check first</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {questions.map((q, i) => (
          <fieldset key={i} className="clarify-q">
            <legend>{q.question}</legend>
            <div className="clarify-options">
              {q.options.map((o) => (
                <button
                  key={o}
                  type="button"
                  className={`clarify-option ${picked[i] === o && !other[i]?.trim() ? 'on' : ''}`}
                  aria-pressed={picked[i] === o && !other[i]?.trim()}
                  onClick={() => { setPicked({ ...picked, [i]: o }); setOther({ ...other, [i]: '' }) }}
                >{o}</button>
              ))}
            </div>
            <input
              type="text"
              className="clarify-other"
              placeholder="Something else"
              aria-label={`${q.question} Something else`}
              maxLength={80}
              value={other[i] || ''}
              onChange={(e) => setOther({ ...other, [i]: e.target.value })}
            />
          </fieldset>
        ))}
        <div className="settings-actions">
          <button type="button" className="action-btn" onClick={() => onSubmit('Use your best judgement and say what you assumed.')}>Skip, use best guess</button>
          <button type="submit" className="action-btn primary" disabled={!complete}>Answer</button>
        </div>
      </form>
    </div>
  )
}
