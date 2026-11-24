import { useEffect, useState } from 'react'

// Per-user preferences the assistant keeps in mind. Stored in user_memory on the server.
export default function PreferencesPanel({ databases, onClose }) {
  const [keys, setKeys] = useState({})
  const [memory, setMemory] = useState({})
  const [edits, setEdits] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    fetch('/api/modules/memory/me').then((r) => r.json()).then((d) => { setKeys(d.keys || {}); setMemory(d.memory || {}) }).catch(() => {})
  }, [])

  const value = (k) => (edits[k] !== undefined ? edits[k] : memory[k] || '')
  const dirty = Object.keys(edits).length > 0

  const save = async (e) => {
    e.preventDefault()
    setBusy(true); setError(''); setNote('')
    try {
      const r = await fetch('/api/modules/memory/me', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: edits }) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Save failed')
      setMemory(d.memory || {}); setEdits({}); setNote('Saved. Applies from your next question.')
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div className="modal-head"><h2>Your preferences</h2><button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button></div>
        <p className="note">The assistant reads these with every question you ask. Nobody else sees them.</p>
        {Object.entries(keys).map(([k, def]) => (
          <div key={k} className="setting-row">
            <div className="setting-text"><label htmlFor={`pref-${k}`}>{def.label}</label>{def.help && <div className="setting-help">{def.help}</div>}</div>
            <div className="setting-control">
              {def.kind === 'select' && <select id={`pref-${k}`} value={value(k) || def.def} onChange={(e) => setEdits({ ...edits, [k]: e.target.value })}>{def.options.map((o) => <option key={o} value={o}>{o}</option>)}</select>}
              {def.kind === 'database' && <select id={`pref-${k}`} value={value(k)} onChange={(e) => setEdits({ ...edits, [k]: e.target.value })}><option value="">(no preference)</option>{databases.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}</select>}
              {def.kind === 'text' && <textarea id={`pref-${k}`} rows={3} maxLength={def.max} value={value(k)} onChange={(e) => setEdits({ ...edits, [k]: e.target.value })} placeholder="e.g. I look after the Pune schools" />}
            </div>
          </div>
        ))}
        {error && <div className="error-text small">{error}</div>}
        <div className="settings-actions">
          {note && !dirty && <span className="hint ok">{note}</span>}
          <button type="button" className="action-btn" onClick={onClose}>Close</button>
          <button type="submit" className="action-btn primary" disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  )
}
