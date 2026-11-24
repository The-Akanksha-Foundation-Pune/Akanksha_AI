import { useEffect, useState } from 'react'

// Admin: confirmed findings (thumbs-up answers) with search.
export default function InsightsPanel({ databases }) {
  const [q, setQ] = useState('')
  const [db, setDb] = useState('')
  const [rows, setRows] = useState([])
  const [unavailable, setUnavailable] = useState('')

  const load = async () => {
    const r = await fetch(`/api/modules/learned/insights?q=${encodeURIComponent(q)}&db=${encodeURIComponent(db)}`)
    const d = await r.json()
    setRows(d.insights || []); setUnavailable(d.unavailable || '')
  }
  useEffect(() => { load() }, [db])

  return (
    <section className="admin-card">
      <h2>Confirmed findings</h2>
      <p className="note">Every answer that got a thumbs up, with its headline figure and the SQL behind it. Search to find what has already been established.</p>
      <form className="scope-tools" onSubmit={(e) => { e.preventDefault(); load() }}>
        <input id="ins-q" className="tables-search" placeholder="Search findings…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select id="ins-db" value={db} onChange={(e) => setDb(e.target.value)}><option value="">All databases</option>{databases.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}</select>
        <button type="submit" className="action-btn">Search</button>
      </form>
      {unavailable && <div className="muted small">{unavailable}</div>}
      {!unavailable && !rows.length && <div className="muted small">Nothing yet. Findings appear here when answers get a thumbs up.</div>}
      {rows.length > 0 && (
        <div className="admin-table-wrap"><table className="rows">
          <thead><tr><th>When</th><th>DB</th><th>Question</th><th>Finding</th><th>SQL</th><th>By</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td>{new Date(r.created_at).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</td><td>{r.database_name}</td><td>{r.question}</td><td>{r.headline}</td><td><code className="sql" title={r.sql_text || ''}>{r.sql_text || ''}</code></td><td>{r.email || ''}</td></tr>)}</tbody>
        </table></div>
      )}
    </section>
  )
}
