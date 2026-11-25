// Admin > Questions: who asked what, and what Prism answered. Super admins only (the server refuses everyone
// else). Read-only: nothing here changes a chat. The list shows one row per answer; a row opens the whole
// question and answer with the queries that were run and what each model call cost.
import { Fragment, useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const money = (v) => (v == null ? '' : `$${Number(v).toFixed(4)}`)
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '')
const modelName = (m) => (m ? m.replace(/^claude-/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/^./, (c) => c.toUpperCase()) : '')
const oneLine = (t, n) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s }
const CLARIFY = /To answer this I need a few details/

function Rating({ value }) {
  if (value === 1) return <span className="q-rate up" title="Thumbs up">👍</span>
  if (value === -1) return <span className="q-rate down" title="Thumbs down">👎</span>
  return null
}

function Detail({ id, onClose }) {
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    setD(null); setError('')
    fetch(`/api/modules/admin/questions/${encodeURIComponent(id)}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Could not load'); return j })
      .then((j) => live && setD(j))
      .catch((e) => live && setError(e.message))
    return () => { live = false }
  }, [id])

  if (error) return <div className="q-detail"><div className="error-text">{error}</div></div>
  if (!d) return <div className="q-detail"><div className="muted small">Loading…</div></div>
  const a = d.answer
  const cost = d.calls.reduce((s, c) => s + Number(c.cost_usd || 0), 0)
  return (
    <div className="q-detail">
      <div className="q-detail-head">
        <div>
          <strong>{a.name || a.email}</strong> <span className="muted">· {a.email} · {when(a.created_at)} · {a.database_name}</span>
        </div>
        <button type="button" className="type-btn" onClick={onClose}>Close</button>
      </div>
      <div className="q-block">
        <div className="q-label">Question</div>
        <div className="q-question">{a.question || <span className="muted">(not found)</span>}</div>
      </div>
      <div className="q-block">
        <div className="q-label">Answer{a.status !== 'complete' && <span className="pill">{a.status === 'streaming' ? 'not finished' : a.status}</span>}</div>
        {a.content?.trim()
          ? <div className="q-answer markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{a.content}</ReactMarkdown></div>
          : <div className="muted small">No answer was saved{a.error ? `: ${a.error}` : '. The reply was cut off before it finished.'}</div>}
      </div>
      {d.queries.length > 0 && (
        <details className="q-block">
          <summary className="q-label">Queries Prism ran ({d.queries.length})</summary>
          {d.queries.map((q) => (
            <div key={q.id} className="q-query">
              <div className="muted small">{q.database_name} · {q.error ? <span className="error-text">failed: {q.error}</span> : `${q.row_count ?? 0} rows`} · {q.duration_ms} ms</div>
              <pre>{q.sql_text}</pre>
            </div>
          ))}
        </details>
      )}
      {d.calls.length > 0 && (
        <div className="muted small">
          {d.calls.length} model {d.calls.length === 1 ? 'call' : 'calls'} · {[...new Set(d.calls.map((c) => modelName(c.model)))].join(', ')}
          {d.calls[0].effort ? ` · ${d.calls[d.calls.length - 1].effort} effort` : ''} · {money(cost)} · {(d.calls.reduce((s, c) => s + Number(c.latency_ms || 0), 0) / 1000).toFixed(1)} s
        </div>
      )}
    </div>
  )
}

export default function QuestionsPanel() {
  const [days, setDays] = useState(7)
  const [person, setPerson] = useState('')
  const [search, setSearch] = useState('')
  const [applied, setApplied] = useState('')
  const [offset, setOffset] = useState(0)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(null)

  useEffect(() => {
    let live = true
    setError('')
    const p = new URLSearchParams({ days: String(days), offset: String(offset) })
    if (person) p.set('user', person)
    if (applied) p.set('q', applied)
    fetch(`/api/modules/admin/questions?${p}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Could not load'); return j })
      .then((j) => live && setData(j))
      .catch((e) => live && setError(e.message))
    return () => { live = false }
  }, [days, person, applied, offset])

  const reset = (fn) => (v) => { setOffset(0); setOpen(null); fn(v) }
  const rows = data?.questions || []

  return (
    <section className="admin-card">
      <h2>Questions people asked</h2>
      <p className="note">Every question put to Prism and the answer it gave. Only super admins can open this page. Messages between colleagues are not shown here.</p>
      <form className="q-filters" onSubmit={(e) => { e.preventDefault(); reset(setApplied)(search.trim()) }}>
        <label htmlFor="q-person">Person</label>
        <select id="q-person" value={person} onChange={(e) => reset(setPerson)(e.target.value)}>
          <option value="">Everyone</option>
          {(data?.people || []).map((u) => <option key={u.id} value={u.id}>{u.name || u.email} ({u.answers})</option>)}
        </select>
        <label htmlFor="q-days">Period</label>
        <select id="q-days" value={days} onChange={(e) => reset(setDays)(Number(e.target.value))}>
          <option value={1}>Last 24 hours</option>
          {[7, 30, 90].map((d) => <option key={d} value={d}>Last {d} days</option>)}
        </select>
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Words in the question" aria-label="Search questions" />
        <button type="submit" className="action-btn">Search</button>
        {applied && <button type="button" className="type-btn" onClick={() => { setSearch(''); reset(setApplied)('') }}>Clear</button>}
      </form>
      {error && <div className="error-text">{error}</div>}
      {!data && !error && <div className="muted small">Loading…</div>}
      {data && !rows.length && <div className="muted small">No questions match.</div>}
      {rows.length > 0 && (
        <div className="admin-table-wrap q-table">
          <table className="rows">
            <thead><tr><th>When</th><th>Person</th><th>Question</th><th>Data</th><th>Model</th><th>USD</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.id}>
                <tr className={`q-row ${open === r.id ? 'on' : ''}`} onClick={() => setOpen(open === r.id ? null : r.id)} tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(open === r.id ? null : r.id) } }}>
                  <td className="q-when">{when(r.created_at)}</td>
                  <td title={r.email}>{r.name || r.email}</td>
                  <td>
                    <div className="q-text">{oneLine(r.question, 160) || <span className="muted">(not found)</span>}</div>
                    <div className="muted q-preview">
                      {!r.preview?.trim() ? 'No answer saved' : CLARIFY.test(r.preview) ? 'Prism asked for details first' : oneLine(r.preview.replace(/[*_#|`]/g, ''), 120)}
                    </div>
                  </td>
                  <td>{r.database_name}</td>
                  <td className="q-model">{r.model ? <>{modelName(r.model)}{r.effort && <span className="muted"> · {r.effort}</span>}</> : <span className="muted">{r.preview?.trim() && !CLARIFY.test(r.preview) ? 'reused' : ''}</span>}</td>
                  <td className="num">{money(r.cost_usd)}</td>
                  <td><Rating value={r.rating} /></td>
                </tr>
                {open === r.id && <tr className="q-open"><td colSpan={7}><Detail id={r.id} onClose={() => setOpen(null)} /></td></tr>}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && (offset > 0 || data.more) && (
        <div className="q-pager">
          <button type="button" className="action-btn" disabled={offset === 0} onClick={() => { setOpen(null); setOffset(Math.max(0, offset - data.pageSize)) }}>Newer</button>
          <span className="muted small">{offset + 1} to {offset + rows.length}</span>
          <button type="button" className="action-btn" disabled={!data.more} onClick={() => { setOpen(null); setOffset(offset + data.pageSize) }}>Older</button>
        </div>
      )}
    </section>
  )
}
