import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Avatar } from './auth.jsx'

// Who is online, and chat between colleagues (user request, 24 Nov 2026; modelled on Alumni Connect).
// The header shows the people who have Prism open right now: up to MAX_FACES faces, then a "+N" button that
// opens the full list. Clicking a face opens a conversation with that person. There is no socket: the app
// reports in every BEAT_MS and an open conversation checks for new messages every CHAT_MS.
const MAX_FACES = 5
const BEAT_MS = 20_000
const LIST_MS = 8_000
const CHAT_MS = 3_000
const MAX_MESSAGE = 2000
const TOAST_MS = 7_000

// Background requests: a failure here must never interrupt someone who is asking a question.
async function call(path, { method = 'GET', body } = {}) {
  const r = await fetch('/api/modules/people' + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
  let d = {}
  try { d = await r.json() } catch { d = {} }
  if (!r.ok) { const e = new Error(d.error || `Request failed (${r.status})`); e.status = r.status; e.unavailable = !!d.unavailable; throw e }
  return d
}

// Tab closed: tell the server now, so the face goes at once. sendBeacon is not fetch, so it needs the app's
// base path itself (see main.jsx).
function leave() {
  try { navigator.sendBeacon(`${import.meta.env.BASE_URL}api/modules/people/presence/leave`) } catch { /* the server times the person out instead */ }
}

const sameDay = (a, b) => a.toDateString() === b.toDateString()
const timeOf = (iso) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
function dayOf(iso) {
  const d = new Date(iso), now = new Date()
  if (sameDay(d, now)) return 'Today'
  if (sameDay(d, new Date(now.getTime() - 864e5))) return 'Yesterday'
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' })
}
const whenOf = (iso) => (dayOf(iso) === 'Today' ? timeOf(iso) : dayOf(iso))

// Reports "I am here" and keeps the list of who else is online and the unread counts.
function usePresence() {
  const [online, setOnline] = useState([])
  const [unread, setUnread] = useState([])
  const [available, setAvailable] = useState(true)
  const stopped = useRef(false)

  const beat = useCallback(async () => {
    if (stopped.current) return
    try {
      const d = await call('/presence', { method: 'POST' })
      setOnline(d.online || []); setUnread(d.unread || [])
    } catch (err) {
      // Not set up, signed out, or access removed: stop asking. Anything else is retried on the next beat.
      if (err.unavailable || err.status === 401 || err.status === 403) { stopped.current = true; if (err.unavailable) setAvailable(false); setOnline([]) }
    }
  }, [])

  useEffect(() => {
    beat()
    const timer = setInterval(beat, BEAT_MS)
    const onVisible = () => document.visibilityState === 'visible' && beat()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pageshow', onVisible)
    window.addEventListener('pagehide', leave)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pageshow', onVisible)
      window.removeEventListener('pagehide', leave)
    }
  }, [beat])

  const markRead = useCallback((id) => setUnread((list) => (list.some((u) => u.id === id) ? list.filter((u) => u.id !== id) : list)), [])
  return { online, unread, available, markRead }
}

function Face({ person, size }) {
  return <span className="face" style={size ? { '--face': `${size}px` } : undefined}><Avatar user={person} />{person.online && <i className="face-dot" aria-hidden="true" />}</span>
}

// The header piece: faces of the people online, "+N" for the rest, and the chat button with the unread count.
export default function OnlinePeople() {
  const { online, unread, available, markRead } = usePresence()
  const [panel, setPanel] = useState(null) // null: closed. { id: null }: the list. { id }: one conversation.
  const [toast, setToast] = useState(null)
  const known = useRef(new Map()) // sender -> newest unread message already announced
  const openId = panel?.id ?? null

  // A message arrived while its conversation is not on screen: say so once.
  useEffect(() => {
    const fresh = unread.filter((u) => u.lastId > (known.current.get(u.id) || 0) && u.id !== openId)
    known.current = new Map(unread.map((u) => [u.id, u.lastId]))
    if (!fresh.length) return undefined
    const newest = fresh.reduce((a, b) => (b.lastId > a.lastId ? b : a))
    setToast({ ...newest, text: newest.count > 1 ? `${newest.count} new messages` : 'sent you a message' })
    const timer = setTimeout(() => setToast(null), TOAST_MS)
    return () => clearTimeout(timer)
  }, [unread, openId])

  useEffect(() => {
    if (!panel) return undefined
    const onKey = (e) => e.key === 'Escape' && setPanel(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panel])

  if (!available) return null

  const open = (id) => { setPanel({ id }); setToast(null) }
  const countFor = (id) => unread.find((u) => u.id === id)?.count || 0
  const total = unread.reduce((n, u) => n + u.count, 0)
  const faces = online.slice(0, MAX_FACES)
  const extra = online.length - faces.length

  return (
    <div className="people">
      {online.length > 0 && (
        <div className="people-faces" role="group" aria-label={`${online.length} other ${online.length === 1 ? 'person' : 'people'} online`}>
          {faces.map((p) => (
            <button key={p.id} type="button" className="face-btn" onClick={() => open(p.id)} title={`${p.name} is online. Click to chat.`} aria-label={`Chat with ${p.name}`}>
              <Face person={p} />
              {countFor(p.id) > 0 && <span className="people-count">{countFor(p.id)}</span>}
            </button>
          ))}
          {extra > 0 && <button type="button" className="face-btn face-more" onClick={() => open(null)} title={`See all ${online.length} people online`} aria-label={`${extra} more people online`}>+{extra}</button>}
        </div>
      )}
      <button type="button" className={`people-chat ${panel ? 'on' : ''}`} onClick={() => (panel ? setPanel(null) : open(null))} aria-expanded={!!panel} aria-label={total ? `Chat, ${total} unread` : 'Chat'} title="Chat with colleagues">
        <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-8l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
        <span>Chat</span>
        {total > 0 && <span className="people-count">{total > 99 ? '99+' : total}</span>}
      </button>

      {panel && (
        <section className="people-panel" role="dialog" aria-label="Chat">
          {openId
            ? <Conversation key={openId} id={openId} online={online} onBack={() => open(null)} onClose={() => setPanel(null)} onRead={markRead} />
            : <PeopleList online={online} unread={unread} onOpen={open} onClose={() => setPanel(null)} />}
        </section>
      )}
      {toast && !panel && (
        <button type="button" className="people-toast" onClick={() => open(toast.id)}>
          <Face person={toast} />
          <span><strong>{toast.name}</strong><span>{toast.text}</span></span>
        </button>
      )}
    </div>
  )
}

function PeopleList({ online, unread, onOpen, onClose }) {
  const [people, setPeople] = useState(null)
  const [error, setError] = useState('')
  const [find, setFind] = useState('')

  useEffect(() => {
    let alive = true
    const load = () => call('/list').then((d) => { if (alive) { setPeople(d.people || []); setError('') } }).catch((err) => alive && setError(err.message))
    load()
    const timer = setInterval(load, LIST_MS)
    return () => { alive = false; clearInterval(timer) }
  }, [])

  // The header hears about arrivals and new messages sooner than this list does.
  const isOnline = (p) => online.some((o) => o.id === p.id) || p.online
  const unreadOf = (p) => unread.find((u) => u.id === p.id)?.count ?? p.unread ?? 0
  const q = find.trim().toLowerCase()
  const shown = (people || []).filter((p) => !q || p.name.toLowerCase().includes(q) || (p.team || '').toLowerCase().includes(q))
  const here = shown.filter(isOnline), away = shown.filter((p) => !isOnline(p))
  const row = (p) => (
    <button key={p.id} type="button" className="people-row" onClick={() => onOpen(p.id)}>
      <Face person={{ ...p, online: isOnline(p) }} size={34} />
      <span className="people-row-text">
        <span className="people-row-name">{p.name}</span>
        <span className="people-row-sub">{p.last ? `${p.last.mine ? 'You: ' : ''}${p.last.body}` : p.team || (isOnline(p) ? 'Online' : 'Not online')}</span>
      </span>
      {p.last && <span className="people-row-when">{whenOf(p.last.at)}</span>}
      {unreadOf(p) > 0 && <span className="people-count inline">{unreadOf(p)}</span>}
    </button>
  )

  return (
    <>
      <header className="people-head">
        <strong>Chat</strong>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close chat">✕</button>
      </header>
      {people && people.length > 6 && <input className="people-find" type="search" placeholder="Find a person or team" aria-label="Find a person or team" value={find} onChange={(e) => setFind(e.target.value)} />}
      <div className="people-list">
        {error && <div className="error-text small">{error}</div>}
        {!people && !error && <div className="muted small">Loading…</div>}
        {people && people.length === 0 && <div className="muted small">Nobody else has access to Prism yet.</div>}
        {here.length > 0 && <div className="people-group">Online now · {here.length}</div>}
        {here.map(row)}
        {away.length > 0 && <div className="people-group">{here.length ? 'Not online' : 'Nobody else is online'}</div>}
        {away.map(row)}
        {people && people.length > 0 && shown.length === 0 && <div className="muted small">Nobody matches "{find}".</div>}
      </div>
    </>
  )
}

function Conversation({ id, online, onBack, onClose, onRead }) {
  const [them, setThem] = useState(null)
  const [messages, setMessages] = useState(null)
  const [seen, setSeen] = useState(0)
  const [more, setMore] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lastId = useRef(0)
  const scroller = useRef(null)
  const stick = useRef(true) // stay at the bottom unless the person has scrolled up to read

  const add = useCallback((list) => {
    if (!list.length) return
    setMessages((cur) => {
      const have = new Set((cur || []).map((m) => m.id))
      const next = [...(cur || []), ...list.filter((m) => !have.has(m.id))].sort((a, b) => a.id - b.id)
      lastId.current = next.length ? next[next.length - 1].id : 0
      return next
    })
  }, [])

  useEffect(() => {
    let alive = true
    const load = (first) => call(`/chat/${id}${first || !lastId.current ? '' : `?after=${lastId.current}`}`)
      .then((d) => {
        if (!alive) return
        setThem(d.them); setSeen(d.seen || 0); setError('')
        if (first) { setMessages(d.messages || []); lastId.current = d.messages?.length ? d.messages[d.messages.length - 1].id : 0; setMore(!!d.more) }
        else add(d.messages || [])
        onRead(id)
      })
      .catch((err) => alive && setError(err.message))
    load(true)
    const timer = setInterval(() => load(false), CHAT_MS)
    return () => { alive = false; clearInterval(timer) }
  }, [id, add, onRead])

  useLayoutEffect(() => { const el = scroller.current; if (el && stick.current) el.scrollTop = el.scrollHeight }, [messages])

  const older = async () => {
    if (!messages?.length) return
    const el = scroller.current, before = el.scrollHeight
    try {
      const d = await call(`/chat/${id}?before=${messages[0].id}`)
      stick.current = false
      setMessages((cur) => [...(d.messages || []), ...(cur || [])]); setMore(!!d.more)
      requestAnimationFrame(() => { el.scrollTop = el.scrollHeight - before })
    } catch (err) { setError(err.message) }
  }

  const send = async (e) => {
    e?.preventDefault()
    const body = text.trim()
    if (!body || busy) return
    setBusy(true); setError('')
    try {
      const d = await call(`/chat/${id}`, { method: 'POST', body: { body } })
      stick.current = true
      add([d.message]); setText('')
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  const isOnline = online.some((o) => o.id === id) || them?.online
  const list = messages || []
  return (
    <>
      <header className="people-head">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="Back to the list">‹</button>
        {them && <Face person={{ ...them, online: isOnline }} size={30} />}
        <span className="people-head-text"><strong>{them?.name || '…'}</strong><span>{isOnline ? 'Online' : 'Not online'}{them?.team ? ` · ${them.team}` : ''}</span></span>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close chat">✕</button>
      </header>
      <div className="people-messages" ref={scroller} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40 }}>
        {more && <button type="button" className="link-btn people-older" onClick={older}>Show earlier messages</button>}
        {messages && messages.length === 0 && <div className="muted small people-empty">No messages yet. Say hello to {them?.name?.split(' ')[0] || 'them'}.</div>}
        {list.map((m, i) => {
          const d = dayOf(m.at), showDay = i === 0 || dayOf(list[i - 1].at) !== d
          return (
            <div key={m.id} className="people-msg-wrap">
              {showDay && <div className="people-day">{d}</div>}
              <div className={`people-msg ${m.mine ? 'mine' : ''}`}>
                <span className="people-msg-body">{m.body}</span>
                <span className="people-msg-meta">{timeOf(m.at)}{m.mine && m.id <= seen ? ' · Seen' : ''}</span>
              </div>
            </div>
          )
        })}
      </div>
      {error && <div className="error-text small people-error">{error}</div>}
      {them && !them.canMessage
        ? <div className="muted small people-error">{them.name} no longer has access to Prism, so you cannot send a message.</div>
        : (
          <form className="people-send" onSubmit={send}>
            <textarea
              rows={1} maxLength={MAX_MESSAGE} value={text} placeholder={`Message ${them?.name?.split(' ')[0] || ''}`.trim()} aria-label="Message"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            />
            <button type="submit" className="action-btn primary" disabled={busy || !text.trim()}>Send</button>
          </form>
        )}
    </>
  )
}
