import { useEffect, useState } from 'react'

// Admin: notes about tables that the schema cannot express. Injected next to the table in the prompt.
export default function TableNotesPanel({ canEdit, databases }) {
  const [notes, setNotes] = useState([])
  const [db, setDb] = useState('')
  const [tables, setTables] = useState([])
  const [table, setTable] = useState('')
  const [text, setText] = useState('')
  const [error, setError] = useState('')

  const load = async () => { const r = await fetch('/api/modules/memory/tables'); const d = await r.json(); setNotes(d.notes || []) }
  useEffect(() => { load(); if (!db && databases.length) setDb(databases[0].name) }, [databases])
  useEffect(() => {
    if (!db) return
    fetch(`/api/modules/admin/scope?db=${encodeURIComponent(db)}`).then((r) => r.json()).then((d) => setTables((d.tables || []).map((t) => t.name))).catch(() => setTables([]))
  }, [db])

  const save = async (e) => {
    e.preventDefault(); setError('')
    const r = await fetch('/api/modules/memory/tables', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ database_name: db, table_name: table, note: text }) })
    const d = await r.json()
    if (!r.ok) return setError(d.error || 'Save failed')
    setNotes(d.notes || []); setText('')
  }
  const remove = async (n) => {
    const r = await fetch('/api/modules/memory/tables', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ database_name: n.database_name, table_name: n.table_name, note: '' }) })
    const d = await r.json(); if (r.ok) setNotes(d.notes || [])
  }

  return (
    <section className="admin-card">
      <h2>Table notes</h2>
      <p className="note">What the schema cannot say: how often a table refreshes, which rows to ignore, what a status really means. Prism sees the note right under that table.</p>
      {notes.length > 0 && (
        <div className="admin-table-wrap"><table className="rows">
          <thead><tr><th>Database</th><th>Table</th><th>Note</th><th></th></tr></thead>
          <tbody>{notes.map((n) => <tr key={n.id}><td>{n.database_name}</td><td>{n.table_name}</td><td>{n.note}</td><td>{canEdit && <button type="button" className="type-btn" onClick={() => remove(n)}>Delete</button>}</td></tr>)}</tbody>
        </table></div>
      )}
      {canEdit && (
        <form className="rule-form" onSubmit={save}>
          <select id="tn-db" value={db} onChange={(e) => { setDb(e.target.value); setTable('') }}>{databases.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}</select>
          <select id="tn-table" value={table} onChange={(e) => setTable(e.target.value)} required><option value="">table…</option>{tables.map((t) => <option key={t} value={t}>{t}</option>)}</select>
          <input id="tn-note" placeholder="Note for this table" value={text} onChange={(e) => setText(e.target.value)} required />
          <button type="submit" className="action-btn" disabled={!db || !table || !text.trim()}>Save note</button>
        </form>
      )}
      {error && <div className="error-text small">{error}</div>}
    </section>
  )
}
