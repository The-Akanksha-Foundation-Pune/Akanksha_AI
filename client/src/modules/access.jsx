import { useEffect, useState } from 'react'

// Admin > Access: give someone access. People are picked from the employee directory by team, then name
// (same flow as Alumni Connect); the server copies their details from the directory. Without a directory
// the form takes a typed work email instead.
const ROLE_HELP = {
  viewer: 'Viewer: can ask questions, with the smallest prompt and credit allowance.',
  analyst: 'Analyst: can ask questions, with the standard prompt and credit allowance.',
  admin: 'Admin: no limits, and can open this Admin page.',
}

export default function GiveAccess({ users, roles, domain = 'akanksha.org', onChanged }) {
  const [teams, setTeams] = useState(null) // null = loading, false = no directory
  const [team, setTeam] = useState('')
  const [members, setMembers] = useState([])
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState('analyst')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/modules/auth/directory/teams').then((r) => r.json()).then((d) => setTeams(d.available ? d.teams : false)).catch(() => setTeams(false))
  }, [])

  useEffect(() => {
    if (!team) { setMembers([]); return }
    setLoadingMembers(true)
    fetch(`/api/modules/auth/directory/members?team=${encodeURIComponent(team)}`).then((r) => r.json())
      .then((d) => setMembers(d.members || [])).catch(() => setMembers([])).finally(() => setLoadingMembers(false))
  }, [team])

  const have = new Map((users || []).map((u) => [String(u.email).toLowerCase(), u]))
  const existing = have.get(email.toLowerCase())
  const directory = Array.isArray(teams)
  const picked = members.find((m) => m.email === email)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setError(''); setNote('')
    try {
      const r = await fetch('/api/modules/auth/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, name, role }) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Could not give access')
      setNote(`${d.name} now has ${d.role} access.`)
      setEmail(''); setName('') // keep the team: admins usually add several people from one team
      onChanged?.()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  const status = (m) => { const u = have.get(m.email); return u ? ` (${u.is_active ? `has ${u.role} access` : 'access removed'})` : '' }

  return (
    <form className="access-form" onSubmit={submit}>
      <div className="access-fields">
        {directory ? (
          <>
            <label>Team
              <select value={team} onChange={(e) => { setTeam(e.target.value); setEmail('') }} required>
                <option value="">Select a team…</option>
                {teams.map((t) => <option key={t.team} value={t.team}>{t.team} ({t.members})</option>)}
              </select>
            </label>
            <label>Team member
              <select value={email} onChange={(e) => setEmail(e.target.value)} required disabled={!team || loadingMembers}>
                <option value="">{!team ? 'Choose a team first' : loadingMembers ? 'Loading…' : 'Select a person…'}</option>
                {members.map((m) => <option key={m.email} value={m.email}>{m.name}{m.designation ? ` · ${m.designation}` : ''}{status(m)}</option>)}
              </select>
            </label>
          </>
        ) : (
          <>
            <label>Work email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={`name@${domain}`} required disabled={teams === null} />
            </label>
            <label>Name
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={160} disabled={teams === null} />
            </label>
          </>
        )}
        <label>Role
          <select value={role} onChange={(e) => setRole(e.target.value)} required>
            {roles.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <button type="submit" className="action-btn primary" disabled={busy || !email}>{busy ? 'Saving…' : existing ? 'Update access' : 'Give access'}</button>
      </div>
      <div className="note">
        {teams === false && 'The employee directory is not connected, so type the person\'s work email. '}
        {picked ? `${picked.email}. ` : ''}{ROLE_HELP[role]}
      </div>
      {note && <div className="hint ok">{note}</div>}
      {error && <div className="error-text small">{error}</div>}
    </form>
  )
}
