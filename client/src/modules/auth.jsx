import { useEffect, useState } from 'react'
import PrismMark from './PrismMark.jsx'

export async function fetchMe() {
  const r = await fetch('/api/modules/auth/me')
  return r.ok ? r.json() : { user: null, mode: 'dev' }
}

export async function logout() {
  await fetch('/api/modules/auth/logout', { method: 'POST' })
}

const SIGNIN_ERRORS = {
  wrong_domain: 'Please use your @akanksha.org Google account.',
  no_access: 'You have not been given access to Prism yet. Ask an admin to add you under Admin > Access, then sign in again.',
  google_cancelled: 'Google sign-in was cancelled.',
  google_state_mismatch: 'The sign-in took too long or was opened in another tab. Please try again.',
  google_not_configured: 'Google sign-in is not set up on this server.',
  google_failed: 'Google sign-in failed. Please try again.',
  // Arriving from the Prism card on Tether
  sso_expired: 'The link from Tether has expired. Open Prism from Tether again, or sign in with Google below.',
  sso_used: 'That link from Tether was already used. Open Prism from Tether again, or sign in with Google below.',
  sso_invalid: 'The link from Tether could not be checked. Open Prism from Tether again, or sign in with Google below.',
  sso_not_configured: 'Sign-in from Tether is not set up on this server. Sign in with Google below.',
  sso_failed: 'Sign-in from Tether failed. Please try again, or sign in with Google below.',
}

function GoogleMark() {
  return (
    <svg className="google-mark" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
      <path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.7 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  )
}

// Full-screen sign-in. Google when configured, otherwise a labelled dev sign-in by email.
export function SignIn({ info, onSignedIn }) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // The Google callback and the Tether hand-off send refused sign-ins back here as /?signin=<reason>.
  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get('signin')
    if (!reason) return
    setError(SIGNIN_ERRORS[reason] || 'Sign-in did not complete. Please try again.')
    window.history.replaceState({}, '', window.location.pathname)
  }, [])

  const devSignIn = async (e) => {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const r = await fetch('/api/modules/auth/dev', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Sign-in failed')
      onSignedIn(d.user)
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <div className="signin">
      <div className="signin-card">
        <div className="brand big"><PrismMark size={52} mode="loop" />Prism</div>
        <p className="muted">Ask questions about the foundation's data. Sign in with your {info.domain} account.</p>
        {info.mode === 'google' ? (
          <a className="google-btn" href={`${import.meta.env.BASE_URL}api/modules/auth/google`}><GoogleMark />Continue with Google</a>
        ) : (
          <form onSubmit={devSignIn} className="dev-form">
            <div className="dev-badge">Development sign-in · no password · set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to switch to Google</div>
            <input id="dev-email" type="email" placeholder={`you@${info.domain}`} value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            <button type="submit" className="send wide" disabled={busy || !email}>{busy ? 'Signing in…' : 'Sign in'}</button>
          </form>
        )}
        {error && <div className="error-text">{error}</div>}
      </div>
    </div>
  )
}

export function quotaLabel(q) {
  if (!q) return ''
  const { limits, used, remaining } = q
  if (!limits.per_day && !limits.per_hour) return `${used.today} prompts today`
  const parts = []
  if (limits.per_day) parts.push(`${remaining.day} of ${limits.per_day} left today`)
  if (limits.per_hour) parts.push(`${remaining.hour} of ${limits.per_hour} this hour`)
  return parts.join(' · ') + (limits.source === 'user' ? ' (personal limit)' : '')
}

// The person's Google profile picture; their initials when there is none yet or it does not load.
export function Avatar({ user }) {
  const [broken, setBroken] = useState(false)
  const initials = String(user.name || user.email || '?').split(/[\s.@]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')
  if (user.picture && !broken) return <img className="avatar" src={user.picture} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
  return <span className="avatar initials" aria-hidden="true">{initials}</span>
}

export function UserChip({ user, quota, credits, onLogout, onAdmin, adminOpen, onPreferences }) {
  const low = quota && ((quota.remaining.day != null && quota.remaining.day <= 3) || (quota.remaining.hour != null && quota.remaining.hour <= 2))
  return (
    <div className="user-chip">
      <div className="user-line">
        <Avatar user={user} />
        <span className="user-email" title={user.email}>{user.name || user.email}</span>
        <span className={`role-pill ${user.role}`}>{user.isSuperAdmin ? 'super admin' : user.role}</span>
      </div>
      {(quota || credits) && (
        <div className="user-line">
          {quota && <span className={`quota-line ${low ? 'low' : ''}`} title="Your prompt allowance">{quotaLabel(quota)}</span>}
          {credits && <span className={`quota-line ${credits.balance <= credits.granted * 0.1 ? 'low' : ''}`} title={`$${credits.spent.toFixed(2)} used of $${credits.granted.toFixed(2)}`}>{credits.balance <= 0 ? 'Credits over' : `$${credits.balance.toFixed(2)} credit left`}</span>}
        </div>
      )}
      <div className="user-line user-links">
        <button type="button" className="link-btn" onClick={onPreferences}>Preferences</button>
        {user.role === 'admin' && <button type="button" className={`link-btn ${adminOpen ? 'on' : ''}`} onClick={onAdmin}>{adminOpen ? 'Back to chat' : 'Admin'}</button>}
        <button type="button" className="link-btn" onClick={onLogout}>Sign out</button>
      </div>
    </div>
  )
}
