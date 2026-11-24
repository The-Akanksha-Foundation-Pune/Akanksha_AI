import { useEffect, useMemo, useState } from 'react'

// Admin: which tables the model may query, per database. Checkboxes, multi-select, one save.
export default function ScopePanel({ canEdit, databases }) {
  const [db, setDb] = useState('')
  const [tables, setTables] = useState([])
  const [mode, setMode] = useState('all')
  const [picked, setPicked] = useState(new Set())
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  useEffect(() => { if (!db && databases.length) setDb(databases[0].name) }, [databases])

  const load = async (name) => {
    if (!name) return
    setError(''); setNote('')
    try {
      const r = await fetch(`/api/modules/admin/scope?db=${encodeURIComponent(name)}`)
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Could not load tables')
      setTables(d.tables); setMode(d.mode); setPicked(new Set(d.tables.filter((t) => t.included).map((t) => t.name)))
    } catch (e) { setError(e.message) }
  }
  useEffect(() => { load(db) }, [db])

  const saved = useMemo(() => new Set(tables.filter((t) => t.included).map((t) => t.name)), [tables])
  const dirty = picked.size !== saved.size || [...picked].some((t) => !saved.has(t))
  const shown = tables.filter((t) => !filter || t.name.toLowerCase().includes(filter.toLowerCase()))
  const toggle = (name) => setPicked((p) => { const n = new Set(p); n.has(name) ? n.delete(name) : n.add(name); return n })
  const setAll = (on) => setPicked(on ? new Set(tables.map((t) => t.name)) : new Set())
  const setShown = (on) => setPicked((p) => { const n = new Set(p); for (const t of shown) on ? n.add(t.name) : n.delete(t.name); return n })

  const save = async () => {
    setBusy(true); setError(''); setNote('')
    try {
      const all = picked.size === tables.length
      const r = await fetch('/api/modules/admin/scope', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ database: db, tables: all ? null : [...picked] }) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Save failed')
      setNote(all ? `Saved. All tables in ${db} are available to the model.` : `Saved. The model can query ${picked.size} of ${tables.length} tables in ${db}.`)
      await load(db)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  return (
    <section className="admin-card scope-card">
      <div className="settings-head">
        <div>
          <h2>Tables the model may query</h2>
          <p className="note">Unticked tables are left out of the schema Claude sees and refused if a query names them. Applies to every role. New tables are included until you untick them.</p>
        </div>
        {canEdit && (
          <div className="settings-actions">
            {note && !dirty && <span className="hint ok">{note}</span>}
            {dirty && <button type="button" className="action-btn" onClick={() => setPicked(saved)} disabled={busy}>Discard</button>}
            <button type="button" className="action-btn primary" onClick={save} disabled={busy || !dirty}>{busy ? 'Saving…' : dirty ? 'Save' : 'Saved'}</button>
          </div>
        )}
      </div>
      {error && <div className="error-text small">{error}</div>}
      <div className="scope-toolbar">
        <div className="db-chips">
          {databases.map((d) => <button key={d.name} type="button" className={`db-chip ${d.name === db ? 'active' : ''}`} onClick={() => setDb(d.name)}>{d.name}<em>{d.tables}</em></button>)}
        </div>
        <div className="scope-tools">
          <input id="scope-filter" className="tables-search" placeholder="Filter tables…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <span className="muted small">{picked.size} of {tables.length} selected{mode === 'all' && !dirty ? ' (all)' : ''}</span>
          {canEdit && <>
            <button type="button" className="type-btn" onClick={() => setAll(true)}>All</button>
            <button type="button" className="type-btn" onClick={() => setAll(false)}>None</button>
            {filter && <><button type="button" className="type-btn" onClick={() => setShown(true)}>Tick shown</button><button type="button" className="type-btn" onClick={() => setShown(false)}>Untick shown</button></>}
          </>}
        </div>
      </div>
      <div className="scope-grid">
        {shown.map((t) => (
          <label key={t.name} className={`scope-item ${picked.has(t.name) ? 'on' : ''}`} title={`${t.columns} columns${t.rows != null ? ` · ~${t.rows.toLocaleString()} rows` : ''}`}>
            <input type="checkbox" checked={picked.has(t.name)} disabled={!canEdit} onChange={() => toggle(t.name)} />
            <span className="scope-name">{t.name}</span>
            {t.type === 'view' ? <span className="table-badge">view</span> : <span className="table-rows">{t.rows?.toLocaleString()}</span>}
          </label>
        ))}
        {!shown.length && <div className="muted small">No tables match.</div>}
      </div>
    </section>
  )
}
