import { useEffect, useState } from 'react'
import Chart from './Chart.jsx'
import SettingsPanel from './settings.jsx'
import ScopePanel from './scope.jsx'
import InsightsPanel from './insights.jsx'
import TableNotesPanel from './tablenotes.jsx'
import GlossaryAdmin from './glossaryAdmin.jsx'
import GiveAccess from './access.jsx'
import QuestionsPanel from './questions.jsx'

const money = (v) => `$${Number(v || 0).toFixed(v >= 10 ? 2 : 4)}`
const num = (v) => Number(v || 0).toLocaleString()
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '')

// The Admin page is split into sections, one job each, picked from the list on the left.
const TABS = [
  { id: 'overview', label: 'Overview', about: 'How much Prism is being used, what it costs, and anything that needs attention.' },
  { id: 'people', label: 'People', about: 'Who can sign in to Prism, and with which role.' },
  { id: 'limits', label: 'Limits & credits', about: 'How much each person may use: prompts per day and hour, and dollar credit.' },
  { id: 'data', label: 'Data access', about: 'Which tables Prism may read at all, and what each role is allowed to see.' },
  { id: 'knowledge', label: 'Knowledge', about: 'What Prism has been taught: approved example queries, definitions, notes about tables and confirmed findings.' },
  { id: 'usage', label: 'Usage detail', about: 'Cost by person and by model, and the slowest and failed queries.' },
  { id: 'questions', label: 'Questions', about: 'What each person asked Prism and what it answered. Super admins only.', superOnly: true },
  { id: 'settings', label: 'Settings', about: 'Which model answers, how answers behave, and when the Overview shows a warning.' },
]
const TAB_KEY = 'akanksha_ai_admin_tab'

function Tile({ k, v, s }) { return <div className="iv-tile"><span className="k">{k}</span><span className="v">{v}</span>{s && <span className="s">{s}</span>}</div> }

function Section({ title, note, children }) {
  return <section className="admin-card"><h2>{title}</h2>{note && <p className="note">{note}</p>}{children}</section>
}

function Table({ cols, rows, empty = 'Nothing yet' }) {
  if (!rows?.length) return <div className="muted small">{empty}</div>
  return (
    <div className="admin-table-wrap"><table className="rows">
      <thead><tr>{cols.map((c) => <th key={c.k}>{c.h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={r.id ?? i}>{cols.map((c) => <td key={c.k} className={c.num ? 'num' : ''} title={c.title?.(r)}>{c.f ? c.f(r) : r[c.k]}</td>)}</tr>)}</tbody>
    </table></div>
  )
}

export default function AdminPage({ user, databases }) {
  const [days, setDays] = useState(30)
  const [data, setData] = useState(null)
  const [users, setUsers] = useState([])
  const [rules, setRules] = useState([])
  const [roles, setRoles] = useState([])
  const [userQuotas, setUserQuotas] = useState(false)
  const [roleLimits, setRoleLimits] = useState({})
  const [credits, setCredits] = useState({ enabled: false, users: {} })
  const [creditLog, setCreditLog] = useState({ enabled: false, history: [] })
  const [error, setError] = useState('')
  const [rule, setRule] = useState({ role: 'analyst', database_name: '', table_name: '', column_name: '', effect: 'allow' })
  // a section marked superOnly is listed, and can be opened, only by a super admin (the server enforces it too)
  const tabs = TABS.filter((x) => !x.superOnly || user.isSuperAdmin)
  const [tab, setTab] = useState(() => { try { const t = localStorage.getItem(TAB_KEY); return tabs.some((x) => x.id === t) ? t : 'overview' } catch { return 'overview' } })
  const openTab = (id) => { setTab(id); try { localStorage.setItem(TAB_KEY, id) } catch { /* ignore */ } }

  const load = async () => {
    setError('')
    try {
      fetch('/api/modules/credits/users').then((x) => (x.ok ? x.json() : null)).then((c) => c && setCredits(c)).catch(() => {})
      fetch('/api/modules/credits/history').then((x) => (x.ok ? x.json() : null)).then((c) => c && setCreditLog(c)).catch(() => {})
      const [s, u, r, st] = await Promise.all([
        fetch(`/api/modules/admin/summary?days=${days}`).then((x) => x.json()),
        fetch('/api/modules/auth/users').then((x) => x.json()),
        fetch('/api/modules/auth/rules').then((x) => x.json()),
        fetch('/api/modules/admin/settings').then((x) => x.json()),
      ])
      if (s.error) throw new Error(s.error)
      setData(s); setUsers(u.users || []); setRoles(u.roles || []); setUserQuotas(!!u.userQuotas); setRules(r.rules || []); setRoleLimits(Object.fromEntries((st.settings || []).filter((x) => x.role).map((x) => [x.key, x.value])))
    } catch (e) { setError(e.message) }
  }
  useEffect(() => { load() }, [days])

  const setStatus = async (id, status) => { await fetch(`/api/modules/learned/${id}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }); load() }
  const removeLearned = async (id) => { await fetch(`/api/modules/learned/${id}`, { method: 'DELETE' }); load() }
  const setRole = async (id, role) => { const r = await fetch(`/api/modules/auth/users/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) }); if (!r.ok) setError((await r.json()).error); load() }
  const setUserQuota = async (id, field, raw) => {
    const r = await fetch(`/api/modules/auth/users/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [field]: raw === '' ? null : Number(raw) }) })
    if (!r.ok) setError((await r.json()).error); else setError('')
    load()
  }
  const addCredit = async (id, raw) => {
    const r = await fetch(`/api/modules/credits/users/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ add: Number(raw) }) })
    if (!r.ok) setError((await r.json()).error); else setError('')
    load()
  }
  const creditCell = (r) => {
    if (!credits.enabled) return <span className="muted" title="Run migration 005 to enable credits">–</span>
    const c = credits.users[r.id]
    if (!c) return <span className="muted" title={r.role === 'admin' ? 'Admins have no credit limit' : 'No credit limit for this role'}>no limit</span>
    return (
      <span className="credit-cell">
        <span className={c.balance <= 0 ? 'error-text' : ''} title={c.pending ? 'Granted on their first prompt' : `$${c.spent.toFixed(2)} used of $${c.granted.toFixed(2)}`}>${c.balance.toFixed(2)}{c.pending ? ' (not started)' : ''}</span>
        {user.isSuperAdmin && (
          <input
            type="number" step="any" className="quota-input" placeholder="+ $" title="Dollars to add. A negative amount takes credit away. Press Enter."
            onKeyDown={(e) => { if (e.key === 'Enter' && e.target.value) { addCredit(r.id, e.target.value); e.target.value = '' } }}
          />
        )}
      </span>
    )
  }
  const roleDefault = (role, field) => roleLimits[`quota.${role}.${field}`] ?? ''
  const quotaCell = (r, field) => userQuotas ? (
    <input
      type="number" min={0} className="quota-input" placeholder={`role: ${roleDefault(r.role, field) === '0' ? '∞' : roleDefault(r.role, field)}`}
      defaultValue={r[`quota_${field}`] ?? ''}
      disabled={!user.isSuperAdmin}
      title="Blank = role limit. 0 = unlimited."
      onBlur={(e) => { if (String(r[`quota_${field}`] ?? '') !== e.target.value) setUserQuota(r.id, `quota_${field}`, e.target.value) }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }}
    />
  ) : <span className="muted" title="Run migration 003 to enable per-user limits">role</span>
  const setActive = async (id, is_active) => { const r = await fetch(`/api/modules/auth/users/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active }) }); if (!r.ok) setError((await r.json()).error); load() }
  const addRule = async (e) => { e.preventDefault(); const r = await fetch('/api/modules/auth/rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...rule, table_name: rule.table_name || null, column_name: rule.column_name || null }) }); const d = await r.json(); if (!r.ok) setError(d.error); else { setRules(d.rules); setRule({ ...rule, table_name: '', column_name: '' }) } }
  const delRule = async (id) => { const r = await fetch(`/api/modules/auth/rules/${id}`, { method: 'DELETE' }); const d = await r.json(); if (r.ok) setRules(d.rules) }

  if (error && !data) return <div className="admin-wait"><div className="error-text">{error}</div></div>
  if (!data) return <div className="admin-wait"><div className="muted">Loading…</div></div>

  const t = data.totals, fb = data.feedback
  const upRate = fb.total ? Math.round((100 * fb.up) / fb.total) : null
  const dailyChart = data.daily.length >= 2 ? { type: 'bar', x: 'day', y: ['cost_usd'], data: data.daily.map((d) => [d.day.slice(5), Number(d.cost_usd)]) } : null
  const tokenChart = data.daily.length >= 2 ? { type: 'bar', x: 'day', y: ['input_tokens', 'output_tokens'], data: data.daily.map((d) => [d.day.slice(5), Number(d.input_tokens), Number(d.output_tokens)]) } : null
  const pending = data.queue.filter((q) => q.status === 'pending')
  const others = data.queue.filter((q) => q.status !== 'pending')

  const current = tabs.find((x) => x.id === tab) || tabs[0]
  const badges = { overview: data.alerts?.length || 0, knowledge: pending.length }
  const person = (r) => <span title={r.email}>{r.name || r.email}</span>

  return (
    <div className="admin-page">
      <nav className="admin-nav" aria-label="Admin sections">
        <div className="admin-nav-title">Admin</div>
        {tabs.map((x) => (
          <button key={x.id} type="button" className={`admin-nav-btn ${x.id === tab ? 'on' : ''}`} aria-current={x.id === tab ? 'page' : undefined} onClick={() => openTab(x.id)}>
            <span>{x.label}</span>{badges[x.id] > 0 && <em title={x.id === 'overview' ? 'Warnings' : 'Waiting for approval'}>{badges[x.id]}</em>}
          </button>
        ))}
      </nav>

      <div className="admin-main" key={tab}>
        <div className="admin-head">
          <div>
            <h1>{current.label}</h1>
            <p className="admin-about">{current.about}</p>
          </div>
          {(tab === 'overview' || tab === 'usage') && (
            <div className="iv-filters">
              <label htmlFor="admin-days">Period</label>
              <select id="admin-days" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                {[7, 14, 30, 90].map((d) => <option key={d} value={d}>Last {d} days</option>)}
              </select>
              <button type="button" className="action-btn" onClick={load}>Refresh</button>
            </div>
          )}
        </div>
        {error && <div className="error-text">{error}</div>}

        {tab === 'overview' && (<>
          {data.alerts?.length > 0 && (
            <div className="alerts">
              {data.alerts.map((a, i) => <div key={i} className={`alert ${a.level}`}>{a.text}</div>)}
            </div>
          )}
          <div className="iv-tiles">
            <Tile k="Spend" v={money(t.cost_usd)} s={`${num(t.requests)} API calls`} />
            <Tile k="Answers" v={num(t.answers)} s={`${num(t.conversations)} chats`} />
            <Tile k="Thumbs up rate" v={upRate == null ? '—' : `${upRate}%`} s={`${fb.up} up · ${fb.down} down`} />
            <Tile k="Cache hit" v={t.cache_hit_pct == null ? '—' : `${t.cache_hit_pct}%`} s="of input tokens served from cache" />
            <Tile k="Avg latency" v={t.avg_latency_ms ? `${(t.avg_latency_ms / 1000).toFixed(1)}s` : '—'} s="per API call" />
            <Tile k="Queries" v={num(data.sql.runs)} s={`${num(data.sql.failed)} failed · avg ${data.sql.avg_ms || 0} ms`} />
          </div>
          <div className="admin-grid">
            <Section title="Daily spend" note="USD per day, all models.">
              {dailyChart ? <div className="chart-body"><Chart spec={dailyChart} type="bar" width={560} /></div> : <Table cols={[{ k: 'day', h: 'Day' }, { k: 'requests', h: 'Calls', num: 1 }, { k: 'cost_usd', h: 'USD', num: 1, f: (r) => money(r.cost_usd) }]} rows={data.daily} />}
            </Section>
            <Section title="Daily tokens" note="Input (incl. cached) and output tokens.">
              {tokenChart ? <div className="chart-body"><Chart spec={tokenChart} type="bar" width={560} /></div> : <div className="muted small">Need at least two days of data.</div>}
            </Section>
          </div>
        </>)}

        {tab === 'people' && (
          <Section title="People with access" note={user.isSuperAdmin ? 'Only people listed here can sign in; everyone else is told they have no access yet. To add someone, pick their team, then the person, then a role. Untick Active to remove access. Super admins always stay admins.' : 'Only people listed here can sign in. Only a super admin can add people or change roles.'}>
            {user.isSuperAdmin && <GiveAccess users={users} roles={roles} onChanged={load} />}
            <Table cols={[
              { k: 'name', h: 'Name', f: (r) => r.name || <span className="muted">–</span>, title: (r) => r.designation || '' },
              { k: 'email', h: 'Email' },
              { k: 'team', h: 'Team', f: (r) => r.team || <span className="muted">–</span>, title: (r) => (r.added_by ? `Added by ${r.added_by}` : '') },
              { k: 'role', h: 'Role', f: (r) => user.isSuperAdmin && !r.isSuperAdmin ? <select value={r.role} onChange={(e) => setRole(r.id, e.target.value)}>{roles.map((x) => <option key={x} value={x}>{x}</option>)}</select> : <span className="pill">{r.isSuperAdmin ? 'super admin' : r.role}</span> },
              { k: 'is_active', h: 'Active', f: (r) => user.isSuperAdmin && !r.isSuperAdmin ? <input type="checkbox" checked={!!r.is_active} onChange={(e) => setActive(r.id, e.target.checked)} aria-label={`${r.name || r.email} is active`} /> : (r.is_active ? 'yes' : 'no') },
              { k: 'last_seen_at', h: 'Last seen', f: (r) => when(r.last_seen_at) || <span className="muted">never</span> },
            ]} rows={users} />
          </Section>
        )}

        {tab === 'limits' && (<>
          <SettingsPanel canEdit={user.isSuperAdmin} onSaved={load} only={['Prompt limits', 'Credits']} title="Limits for each role" note="These apply to everyone with that role. Admins have no credit limit." />
          <Section title="Limits for one person" note={`${userQuotas ? 'A number here replaces the role limit for that person: blank means the role limit, 0 means unlimited. ' : 'Per-person prompt limits appear after migration 003 is applied. '}${credits.enabled && user.isSuperAdmin ? 'To add credit, type the dollars next to the balance and press Enter; a negative amount takes credit away.' : ''}`}>
            <Table cols={[
              { k: 'name', h: 'Person', f: person },
              { k: 'role', h: 'Role', f: (r) => <span className="pill">{r.isSuperAdmin ? 'super admin' : r.role}</span> },
              { k: 'quota_per_day', h: 'Prompts per day', f: (r) => quotaCell(r, 'per_day') },
              { k: 'quota_per_hour', h: 'Prompts per hour', f: (r) => quotaCell(r, 'per_hour') },
              { k: 'credit', h: 'Credit left', f: creditCell },
            ]} rows={users.filter((u) => u.is_active)} empty="Nobody has access yet." />
          </Section>
          {credits.enabled && (
            <Section title="Credit history" note={creditLog.enabled ? 'Every change to a person\'s credit, newest first: the starting amount on their first prompt, monthly refills, and each amount a super admin added or took away.' : 'Credit history appears after migration 006 is applied.'}>
              <Table empty="No credit has been granted yet." cols={[
                { k: 'created_at', h: 'When', f: (r) => when(r.created_at) },
                { k: 'person', h: 'Person', title: (r) => r.email },
                { k: 'amount_usd', h: 'Amount', num: true, f: (r) => <span className={Number(r.amount_usd) < 0 ? 'error-text' : ''}>{Number(r.amount_usd) < 0 ? '−' : '+'}${Math.abs(Number(r.amount_usd)).toFixed(2)}</span> },
                { k: 'kind', h: 'Type', f: (r) => ({ initial: 'Starting credit', refill: 'Monthly refill', topup: Number(r.amount_usd) < 0 ? 'Taken away' : 'Top-up', opening: 'Balance before history began' }[r.kind] || r.kind) },
                { k: 'granted_by', h: 'By', f: (r) => r.granted_by || <span className="muted">automatic</span> },
              ]} rows={creditLog.history} />
            </Section>
          )}
        </>)}

        {tab === 'data' && (<>
          <ScopePanel canEdit={user.isSuperAdmin} databases={databases} />
          <Section title="What each role may see" note="With no rules, analysts and viewers see everything Prism may read. An allow rule on a database limits the role to the allowed databases; a table rule narrows further; a column rule hides that column. Admins always see everything.">
            <Table empty="No rules yet: every role sees every database." cols={[
              { k: 'role', h: 'Role' }, { k: 'database_name', h: 'Database' }, { k: 'table_name', h: 'Table', f: (r) => r.table_name || <em className="muted">whole database</em> }, { k: 'column_name', h: 'Column', f: (r) => r.column_name || '' },
              { k: 'effect', h: 'Effect', f: (r) => <span className={`pill ${r.effect === 'allow' ? 'ok' : 'bad'}`}>{r.effect}</span> },
              { k: 'actions', h: '', f: (r) => user.isSuperAdmin && <button type="button" className="type-btn" onClick={() => delRule(r.id)}>Delete</button> },
            ]} rows={rules} />
            {user.isSuperAdmin && (
              <form className="rule-form" onSubmit={addRule}>
                <select id="rule-role" aria-label="Role" value={rule.role} onChange={(e) => setRule({ ...rule, role: e.target.value })}>{roles.filter((x) => x !== 'admin').map((x) => <option key={x} value={x}>{x}</option>)}</select>
                <select id="rule-db" aria-label="Database" value={rule.database_name} onChange={(e) => setRule({ ...rule, database_name: e.target.value })} required>
                  <option value="">database…</option>{databases.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
                </select>
                <input id="rule-table" aria-label="Table" placeholder="table (optional)" value={rule.table_name} onChange={(e) => setRule({ ...rule, table_name: e.target.value })} />
                <input id="rule-column" aria-label="Column" placeholder="column (optional, hides it)" value={rule.column_name} onChange={(e) => setRule({ ...rule, column_name: e.target.value, effect: e.target.value ? 'deny' : rule.effect })} />
                <select id="rule-effect" aria-label="Effect" value={rule.effect} disabled={!!rule.column_name} onChange={(e) => setRule({ ...rule, effect: e.target.value })}><option value="allow">allow</option><option value="deny">deny</option></select>
                <button type="submit" className="action-btn" disabled={!rule.database_name}>Add rule</button>
              </form>
            )}
          </Section>
        </>)}

        {tab === 'knowledge' && (<>
          <Section title={pending.length ? `Example queries · ${pending.length} waiting for approval` : 'Example queries'} note="A thumbs up on an answer saves its question and SQL here. Approved examples are shown to Prism when a similar question is asked. Reject anything wrong.">
            <Table empty="No examples yet. A thumbs up on an answer creates one." cols={[
              { k: 'status', h: 'Status', f: (r) => <span className={`pill ${r.status === 'approved' ? 'ok' : r.status === 'rejected' ? 'bad' : 'warn'}`}>{r.status}</span> },
              { k: 'database_name', h: 'DB' },
              { k: 'question', h: 'Question' },
              { k: 'sql_text', h: 'SQL', f: (r) => <code className="sql">{r.sql_text}</code>, title: (r) => r.sql_text },
              { k: 'use_count', h: 'Used', num: 1 },
              { k: 'email', h: 'By' },
              { k: 'actions', h: '', f: (r) => <span className="row-actions">
                {r.status !== 'approved' && <button type="button" className="type-btn" onClick={() => setStatus(r.id, 'approved')}>Approve</button>}
                {r.status !== 'rejected' && <button type="button" className="type-btn" onClick={() => setStatus(r.id, 'rejected')}>Reject</button>}
                <button type="button" className="type-btn" onClick={() => removeLearned(r.id)}>Delete</button></span> },
            ]} rows={[...pending, ...others]} />
          </Section>
          <SettingsPanel canEdit={user.isSuperAdmin} onSaved={load} only={['Learning']} title="How examples are used" />
          <GlossaryAdmin canEdit={user.isSuperAdmin} databases={databases} />
          <div className="admin-grid">
            <TableNotesPanel canEdit={user.isSuperAdmin} databases={databases} />
            <InsightsPanel databases={databases} />
          </div>
        </>)}

        {tab === 'usage' && (
          <div className="admin-grid">
            <Section title="Cost per person" note="Who is asking, and what it costs.">
              <Table cols={[{ k: 'user', h: 'User' }, { k: 'requests', h: 'Calls', num: 1 }, { k: 'conversations', h: 'Chats', num: 1 }, { k: 'cost_usd', h: 'USD', num: 1, f: (r) => money(r.cost_usd) }, { k: 'last_request', h: 'Last', f: (r) => when(r.last_request) }]} rows={data.byUser} />
            </Section>
            <Section title="By model" note="Which model answered. Simple questions go to the cheaper models; harder ones to the stronger model.">
              <Table cols={[{ k: 'model', h: 'Model' }, { k: 'answers', h: 'Answers', num: 1 }, { k: 'requests', h: 'Calls', num: 1 }, { k: 'cost_usd', h: 'USD', num: 1, f: (r) => money(r.cost_usd) }, { k: 'cost_per_answer', h: 'Per answer', num: 1, f: (r) => money(r.cost_per_answer) }, { k: 'avg_latency_ms', h: 'Avg s', num: 1, f: (r) => (Number(r.avg_latency_ms) / 1000).toFixed(1) }]} rows={data.byModel} />
            </Section>
            <Section title="Slowest queries" note="Top 10 by duration.">
              <Table cols={[{ k: 'duration_ms', h: 'ms', num: 1 }, { k: 'row_count', h: 'Rows', num: 1 }, { k: 'database_name', h: 'DB' }, { k: 'sql_text', h: 'SQL', f: (r) => <code className="sql">{r.sql_text}</code>, title: (r) => r.sql_text }, { k: 'email', h: 'User' }]} rows={data.slowest} />
            </Section>
            <Section title="Failed queries" note="Most recent 10. Errors Prism saw and usually recovered from.">
              <Table cols={[{ k: 'created_at', h: 'When', f: (r) => when(r.created_at) }, { k: 'database_name', h: 'DB' }, { k: 'error', h: 'Error', f: (r) => <span className="error-text small">{r.error}</span> }, { k: 'sql_text', h: 'SQL', f: (r) => <code className="sql">{r.sql_text}</code>, title: (r) => r.sql_text }]} rows={data.failed} />
            </Section>
          </div>
        )}

        {tab === 'questions' && user.isSuperAdmin && <QuestionsPanel />}

        {tab === 'settings' && <SettingsPanel canEdit={user.isSuperAdmin} onSaved={load} only={['Model', 'Answers', 'Alerts']} title="Settings" />}
      </div>
    </div>
  )
}
