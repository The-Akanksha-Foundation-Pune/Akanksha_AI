import { useEffect, useState } from 'react'

// Admin settings: categories on the left, one clean row per setting, a single save bar.
// `only` limits the panel to some groups (each Admin section shows the settings that belong to it);
// with a single group the category list is left out.
export default function SettingsPanel({ canEdit, onSaved, only, title = 'Settings', note: about }) {
  const [groups, setGroups] = useState([])
  const [settings, setSettings] = useState([])
  const [group, setGroup] = useState('')
  const [edits, setEdits] = useState({})
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const r = await fetch('/api/modules/admin/settings')
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Could not load settings')
      const shown = only ? d.groups.filter((g) => only.includes(g)) : d.groups
      setGroups(shown); setSettings(d.settings.filter((x) => shown.includes(x.group))); setEdits({})
      setGroup((g) => (shown.includes(g) ? g : shown[0]))
    } catch (e) { setError(e.message) }
  }
  useEffect(() => { load() }, [])

  const valueOf = (s) => (edits[s.key] !== undefined ? edits[s.key] : s.value)
  const change = (s, v) => setEdits((e) => (String(v) === String(s.value) ? Object.fromEntries(Object.entries(e).filter(([k]) => k !== s.key)) : { ...e, [s.key]: v }))
  const dirty = Object.keys(edits).length

  const save = async () => {
    if (!dirty) return
    setBusy(true); setError(''); setNote('')
    try {
      const r = await fetch('/api/modules/admin/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: edits }) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Save failed')
      setSettings(d.settings.filter((x) => groups.includes(x.group))); setEdits({}); setNote('Saved. Changes apply to the next prompt.')
      onSaved?.()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const control = (s) => {
    const v = valueOf(s)
    if (s.kind === 'boolean') {
      const on = String(v) === '1'
      return (
        <button type="button" role="switch" aria-checked={on} className={`switch ${on ? 'on' : ''}`} disabled={!canEdit} onClick={() => change(s, on ? '0' : '1')} id={`set-${s.key}`}>
          <i /><span>{on ? 'On' : 'Off'}</span>
        </button>
      )
    }
    if (s.kind === 'select') {
      return <select id={`set-${s.key}`} value={v} disabled={!canEdit} onChange={(e) => change(s, e.target.value)}>{s.options.map((o) => <option key={o} value={o}>{o}</option>)}</select>
    }
    return <input id={`set-${s.key}`} type="number" min={s.min ?? 0} max={s.max} value={v} disabled={!canEdit} onChange={(e) => change(s, e.target.value)} />
  }

  const inGroup = settings.filter((s) => s.group === group)
  const isQuota = group === 'Prompt limits'
  const rolesInGroup = [...new Set(inGroup.map((s) => s.role).filter(Boolean))]

  return (
    <section className="admin-card settings-card">
      <div className="settings-head">
        <div>
          <h2>{title}</h2>
          <p className="note">{about ? `${about} ` : ''}{canEdit ? 'Changes apply within 30 seconds of saving.' : 'Only a super admin can change these.'}</p>
        </div>
        {canEdit && (
          <div className="settings-actions">
            {note && !dirty && <span className="hint ok">{note}</span>}
            {dirty > 0 && <button type="button" className="action-btn" onClick={() => setEdits({})} disabled={busy}>Discard</button>}
            <button type="button" className="action-btn primary" onClick={save} disabled={busy || !dirty}>{busy ? 'Saving…' : dirty ? `Save ${dirty} change${dirty === 1 ? '' : 's'}` : 'Saved'}</button>
          </div>
        )}
      </div>
      {error && <div className="error-text small">{error}</div>}
      <div className={`settings-body ${groups.length < 2 ? 'single' : ''}`}>
        {groups.length > 1 && <nav className="settings-nav" aria-label="Setting categories">
          {groups.map((g) => {
            const n = settings.filter((s) => s.group === g && edits[s.key] !== undefined).length
            return <button key={g} type="button" className={`settings-tab ${g === group ? 'on' : ''}`} onClick={() => setGroup(g)}>{g}{n > 0 && <em>{n}</em>}</button>
          })}
        </nav>}
        <div className="settings-rows">
          {isQuota ? (
            <>
              <p className="note">How many prompts each role may send. 0 means unlimited. Days reset at midnight India time; hours are rolling. One person can be given their own limit in the table below.</p>
              <table className="rows quota-table"><thead><tr><th>Role</th><th>Per day</th><th>Per hour</th></tr></thead><tbody>
                {rolesInGroup.map((role) => (
                  <tr key={role}>
                    <td className="role-name">{role}</td>
                    {['per_day', 'per_hour'].map((f) => { const s = inGroup.find((x) => x.role === role && x.field === f); return <td key={f}>{s && control(s)}</td> })}
                  </tr>
                ))}
              </tbody></table>
            </>
          ) : inGroup.map((s) => (
            <div key={s.key} className={`setting-row ${edits[s.key] !== undefined ? 'changed' : ''}`}>
              <div className="setting-text">
                <label htmlFor={`set-${s.key}`}>{s.label}</label>
                {s.help && <div className="setting-help">{s.help}</div>}
              </div>
              <div className="setting-control">{control(s)}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
