import { useEffect, useState } from 'react'

// Admin: agreed definitions per database. Claude reads them with every question on that database.
export default function GlossaryAdmin({ canEdit, databases }) {
  const [db, setDb] = useState('')
  const [defs, setDefs] = useState([])
  const [form, setForm] = useState({ term: '', definition: '', sql_hint: '', scope: 'db' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (!db && databases.length) setDb(databases[0].name) }, [databases])
  const load = async (name) => {
    if (!name) return
    try { const r = await fetch(`/api/modules/glossary?db=${encodeURIComponent(name)}`); const d = await r.json(); if (r.ok) setDefs(d.definitions) } catch { /* optional */ }
  }
  useEffect(() => { load(db) }, [db])

  const save = async (e) => {
    e.preventDefault(); setBusy(true); setError('')
    try {
      const r = await fetch('/api/modules/glossary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ term: form.term, definition: form.definition, sql_hint: form.sql_hint, database_name: form.scope === 'all' ? null : db }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `Save failed (${r.status})`)
      setForm({ term: '', definition: '', sql_hint: '', scope: 'db' }); await load(db)
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const remove = async (id) => { await fetch(`/api/modules/glossary/${id}`, { method: 'DELETE' }); await load(db) }

  return (
    <section className="admin-card">
      <h2>Glossary</h2>
      <p className="note">Agreed meanings of terms like "active student" or "completed visit". Prism applies them exactly, so every answer uses the same definition.</p>
      <div className="db-chips">
        {databases.map((d) => <button key={d.name} type="button" className={`db-chip ${d.name === db ? 'active' : ''}`} onClick={() => setDb(d.name)}>{d.name}</button>)}
      </div>
      {defs.length === 0 ? <div className="muted small">No definitions yet for {db}.</div> : (
        <div className="admin-table-wrap"><table className="rows">
          <thead><tr><th>Term</th><th>Definition</th><th>SQL hint</th><th>Scope</th><th></th></tr></thead>
          <tbody>{defs.map((d) => <tr key={d.id}><td><b>{d.term}</b></td><td>{d.definition}</td><td><code className="sql">{d.sql_hint || ''}</code></td><td>{d.database_name == null ? 'all databases' : d.database_name}</td><td>{canEdit && <button type="button" className="type-btn" onClick={() => remove(d.id)}>Delete</button>}</td></tr>)}</tbody>
        </table></div>
      )}
      {canEdit && (
        <form className="rule-form glossary-admin-form" onSubmit={save}>
          <input id="ga-term" placeholder="Term, e.g. active student" value={form.term} onChange={(e) => setForm({ ...form, term: e.target.value })} required />
          <input id="ga-def" placeholder="What it means" value={form.definition} onChange={(e) => setForm({ ...form, definition: e.target.value })} required />
          <input id="ga-sql" placeholder="SQL hint (optional), e.g. status LIKE 'Active%'" value={form.sql_hint} onChange={(e) => setForm({ ...form, sql_hint: e.target.value })} />
          <select id="ga-scope" value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}><option value="db">Only {db}</option><option value="all">All databases</option></select>
          <button type="submit" className="action-btn" disabled={busy}>{busy ? 'Saving…' : 'Add term'}</button>
        </form>
      )}
      {error && <div className="error-text small">{error}</div>}
    </section>
  )
}
