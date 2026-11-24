import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MESSAGE_ACTIONS, MESSAGE_BLOCKS } from './modules/index.jsx'
import StepsBlock from './modules/steps.jsx'
import { fetchMe, logout, SignIn, UserChip } from './modules/auth.jsx'
import AdminPage from './modules/admin.jsx'
import PreferencesPanel from './modules/preferences.jsx'
import AnswerMeta from './modules/answerMeta.jsx'
import PromptFooter from './modules/promptFooter.jsx'
import ClarifyDialog from './modules/clarify.jsx'
import './App.css'

const STORAGE_KEY = 'akanksha_ai_conversations'
const MODEL_LABELS = { 'claude-sonnet-5-5': 'Claude Sonnet 5.5', 'claude-opus-5-5': 'Claude Opus 5.5', 'claude-haiku-5-5': 'Claude Haiku 5.5', 'claude-fable-5-1': 'Claude Fable 5.1' }

const SUGGESTIONS = [
  'Which tables have the most rows?',
  'How many students are enrolled per school?',
  'Show the 10 most recent finance entries',
  'Describe the columns in the epv table',
]

const uid = () => Math.random().toString(36).slice(2, 10)

// A chat that exists only in the browser until its first message is sent.
function newConversation() {
  return { id: `local-${uid()}`, local: true, title: 'New chat', messages: [], createdAt: Date.now() }
}

async function fetchConversations() {
  const r = await fetch('/api/modules/chats')
  if (!r.ok) return []
  const d = await r.json()
  return (d.conversations || []).map((c) => ({ id: c.id, title: c.title, database: c.database_name, model: c.model, messages: undefined, messageCount: Number(c.message_count) || 0, updatedAt: c.updated_at }))
}

async function fetchMessages(id) {
  const r = await fetch(`/api/modules/chats/${id}`)
  if (!r.ok) return []
  return (await r.json()).messages || []
}

export default function App() {
  const [auth, setAuth] = useState(null) // { user, mode, googleClientId, domain }
  useEffect(() => { fetchMe().then(setAuth) }, [])
  if (!auth) return <div className="signin"><div className="muted">Loading…</div></div>
  if (!auth.user) return <SignIn info={auth} onSignedIn={(user) => setAuth({ ...auth, user })} />
  return <ChatApp key={auth.user.id} user={auth.user} onLogout={async () => { await logout(); setAuth({ ...auth, user: null }) }} />
}

function ChatApp({ user, onLogout }) {
  const [adminOpen, setAdminOpen] = useState(false)
  const [prefsOpen, setPrefsOpen] = useState(false)
  const [quota, setQuota] = useState(null)
  const loadQuota = () => fetch('/api/modules/quota/me').then((r) => (r.ok ? r.json() : null)).then((q) => q && setQuota(q)).catch(() => {})
  const [credits, setCredits] = useState(null) // { granted, spent, balance }, or null when no credit limit applies
  const loadCredits = () => fetch('/api/modules/credits/me').then((r) => (r.ok ? r.json() : null)).then((d) => d && setCredits(d.credits)).catch(() => {})
  useEffect(() => { loadQuota(); loadCredits() }, [])
  const creditsOver = !!credits && credits.balance <= 0
  const [conversations, setConversations] = useState(() => [newConversation()])
  const [activeId, setActiveId] = useState(() => conversations[0].id)
  useEffect(() => {
    fetchConversations().then((list) => setConversations((prev) => [...prev.filter((c) => c.local), ...list]))
  }, [])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  // On narrow screens the sidebar overlays the chat, so it starts closed there.
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 720)
  const [tables, setTables] = useState([])
  const [tablesError, setTablesError] = useState('')
  const [tablesLoading, setTablesLoading] = useState(false)
  const [tablesLoadedAt, setTablesLoadedAt] = useState(null)
  const [databases, setDatabases] = useState([])
  const [dbName, setDbName] = useState(() => { try { return localStorage.getItem('akanksha_ai_db') || '' } catch { return '' } })
  // Auto: the server picks the database for each new chat from its first question.
  // Only admins may choose a database by hand; everyone else always runs in Auto (user request, 24 Nov 2026).
  const canPickDb = user.role === 'admin'
  const [autoDbPref, setAutoDb] = useState(() => { try { return localStorage.getItem('akanksha_ai_db_auto') !== '0' } catch { return true } })
  const autoDb = !canPickDb || autoDbPref
  useEffect(() => { if (canPickDb) { try { localStorage.setItem('akanksha_ai_db_auto', autoDbPref ? '1' : '0') } catch { /* ignore */ } } }, [autoDbPref, canPickDb])
  const [dbError, setDbError] = useState('')
  const [modelId, setModelId] = useState('')
  const [routing, setRouting] = useState(null) // { lookup, aggregate, analysis } model ids when routing is on
  const [selected, setSelected] = useState(() => new Set())
  const abortRef = useRef(null)
  const bottomRef = useRef(null)
  const textareaRef = useRef(null)

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) || conversations[0],
    [conversations, activeId],
  )
  useEffect(() => {
    if (!active || active.local || active.messages !== undefined) return
    fetchMessages(active.id).then((messages) => updateConversation(active.id, (c) => ({ ...c, messages })))
  }, [active?.id])
  const activeMessages = active?.messages || []


  const loadDatabases = async (refresh = false) => {
    setDbError('')
    try {
      const r = await fetch(`/api/chat/databases${refresh ? '?refresh=1' : ''}`)
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`)
      setDatabases(d.databases)
      setModelId(d.model || '')
      setRouting(d.routing ? d.tiers : null)
      setDbName((cur) => (cur && d.databases.some((x) => x.name === cur) ? cur : d.default || d.databases[0]?.name || ''))
    } catch (e) {
      setDbError(e.message || 'Could not load databases')
    }
  }

  const loadTables = async (db, refresh = false) => {
    if (!db) return
    setTablesLoading(true)
    setTablesError('')
    try {
      const r = await fetch(`/api/chat/tables?db=${encodeURIComponent(db)}${refresh ? '&refresh=1' : ''}`)
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`)
      setTables(d.tables)
      setTablesLoadedAt(d.loadedAt)
      setSelected((prev) => new Set([...prev].filter((n) => d.tables.some((t) => t.name === n))))
    } catch (e) {
      setTablesError(e.message || 'Could not load tables')
    } finally {
      setTablesLoading(false)
    }
  }

  useEffect(() => { loadDatabases() }, [])
  useEffect(() => {
    if (!dbName) return
    try { localStorage.setItem('akanksha_ai_db', dbName) } catch { /* ignore */ }
    setTables([])
    setSelected(new Set())
    loadTables(dbName)
  }, [dbName])

  const refreshAll = async () => {
    await loadDatabases(true)
    await loadTables(dbName, true)
  }

  // Switching database starts a fresh chat if the current one already has messages for another database.
  const chooseDatabase = (name) => {
    if (name === dbName) return
    const chatDb = active.database || dbName
    setDbName(name)
    if (((active.messages || []).length || active.messageCount) && chatDb !== name) createChat()
  }


  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [active?.messages, streaming])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [input])

  const updateConversation = (id, updater) =>
    setConversations((prev) => prev.map((c) => (c.id === id ? updater(c) : c)))

  // Reuse an empty chat if there is one, so "New chat" never piles up blank conversations.
  const createChat = () => {
    const empty = conversations.find((c) => c.local && c.messages.length === 0)
    if (empty) {
      setActiveId(empty.id)
    } else {
      const c = newConversation()
      setConversations((prev) => [c, ...prev])
      setActiveId(c.id)
    }
    setInput('')
    textareaRef.current?.focus()
  }

  // Sidebar shows the five most recent chats that have messages (plus the active one if it is older).
  const RECENT = 5
  const recentChats = useMemo(() => {
    const withMessages = conversations.filter((c) => (c.local ? c.messages.length > 0 : (c.messageCount > 0 || (c.messages || []).length > 0)))
    const list = withMessages.slice(0, RECENT)
    const act = withMessages.find((c) => c.id === activeId)
    if (act && !list.includes(act)) list.push(act)
    return list
  }, [conversations, activeId])

  const deleteChat = (id) => {
    if (!id.startsWith('local-')) fetch(`/api/modules/chats/${id}`, { method: 'DELETE' }).catch(() => {})
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id)
      const result = next.length ? next : [newConversation()]
      if (id === activeId) setActiveId(result[0].id)
      return result
    })
  }


  const stop = () => abortRef.current?.abort()

  const send = async (textOverride, opts = {}) => {
    const text = (textOverride ?? input).trim()
    if (!text || streaming) return
    let convId = active.id
    setInput('')
    setStreaming(true)

    // Auto mode asks the server which database fits the question: always for a new chat, and for a follow-up so the
    // chat can move when the question is about other data. Any failure keeps the chat's database (or the last one used).
    let database = active.database || (autoDb ? '' : dbName)
    let switchDatabase = false
    if (autoDb && (!database || !opts.keepDb)) {
      try {
        const previous = [...(active.messages || [])].reverse().find((m) => m.role === 'user')?.content || ''
        const r = await fetch('/api/modules/autodb/pick', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: text, current: database, previous }) })
        const d = await r.json()
        if (r.ok && d.database && d.database !== database) {
          switchDatabase = !!database
          database = d.database
        }
      } catch { /* fall through */ }
    }
    if (!database) database = dbName
    if (database !== dbName) setDbName(database)

    // First message of a browser-only chat: create it on the server and swap the id.
    if (active.local) {
      try {
        const r = await fetch('/api/modules/chats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ database }) })
        const d = await r.json()
        if (!r.ok) throw new Error(d.error || 'Could not start a chat')
        const serverId = d.conversation.id
        const localId = convId // captured now: the updater below runs later, after convId has been reassigned
        setConversations((prev) => prev.map((c) => (c.id === localId ? { ...c, id: serverId, local: false, database, messageCount: 0 } : c)))
        setActiveId(serverId)
        convId = serverId
      } catch (err) {
        setStreaming(false)
        updateConversation(convId, (c) => ({ ...c, messages: [...(c.messages || []), { id: uid(), role: 'assistant', content: '', error: err.message, steps: [] }] }))
        return
      }
    }

    const userMsg = { id: crypto.randomUUID(), role: 'user', content: text, createdAt: Date.now() }
    const assistantMsg = { id: crypto.randomUUID(), role: 'assistant', content: '', steps: [], pending: true }
    const history = [...(active.messages || []), userMsg]

    updateConversation(convId, (c) => ({
      ...c,
      title: (c.messages || []).length === 0 ? text.slice(0, 80) : c.title,
      database,
      messageCount: (c.messageCount || 0) + 2,
      messages: [...history, assistantMsg],
    }))

    const controller = new AbortController()
    abortRef.current = controller

    const patchAssistant = (fn) =>
      updateConversation(convId, (c) => ({
        ...c,
        messages: c.messages.map((m) => (m.id === assistantMsg.id ? { ...m, ...(typeof fn === 'function' ? fn(m) : fn) } : m)),
      }))

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history.map(({ role, content }) => ({ role, content })),
          database,
          tables: [...selected],
          conversationId: convId,
          messageId: assistantMsg.id,
          userMessageId: userMsg.id,
          switchDatabase,
        }),
        signal: controller.signal,
      })
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}))
        if (res.status === 429 && err.quota) setQuota(err.quota)
        if (err.credits) setCredits(err.credits)
        throw new Error(res.status === 401 ? 'Your session has expired. Sign out and sign in again.' : err.error || `Request failed (${res.status})`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let full = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const frames = buffer.split('\n\n')
        buffer = frames.pop() ?? ''
        for (const frame of frames) {
          let event = 'message'
          let data = ''
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim()
            else if (line.startsWith('data:')) data += line.slice(5).trim()
          }
          if (!data) continue
          const payload = JSON.parse(data)
          if (event === 'text') {
            full += payload.text
            patchAssistant({ content: full })
          } else if (event === 'clarify') {
            patchAssistant({ clarify: { questions: payload.questions, open: true } })
          } else if (event === 'tool') {
            if (payload.module === 'clarify') continue // shown as a dialog, not as a step
            patchAssistant((m) => ({ steps: [...(m.steps || []), { id: payload.id, module: payload.module, tool: payload.tool, ui: payload.ui || {}, status: 'running' }] }))
          } else if (event === 'tool_result') {
            patchAssistant((m) => ({
              steps: (m.steps || []).map((s) => (s.id === payload.id ? { ...s, status: payload.error ? 'error' : 'done', error: payload.error, ui: { ...s.ui, ...(payload.ui || {}) } } : s)),
            }))
          } else if (event === 'error') {
            patchAssistant({ error: payload.message })
          } else if (event === 'done') {
            if (payload.quota) setQuota(payload.quota)
            if (payload.credits) setCredits(payload.credits)
            if (payload.cached) patchAssistant({ cached: payload.cachedAt || true })
            if (payload.model) patchAssistant({ model: payload.model, route: payload.route, meta: { model: payload.model, route: payload.route, effort: payload.effort, costUsd: payload.costUsd, latencyMs: payload.latencyMs, rounds: payload.rounds } })
            if (payload.stop_reason === 'max_tokens') patchAssistant({ cutOff: true })
            if (payload.refusal) patchAssistant({ error: `Claude declined this request (${payload.refusal.category || 'policy'}).` })
          }
        }
      }
      patchAssistant({ pending: false })
    } catch (err) {
      if (err.name === 'AbortError') patchAssistant({ pending: false })
      else patchAssistant({ pending: false, error: err.message })
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="app">
      <aside className={`sidebar ${sidebarOpen ? '' : 'collapsed'}`}>
        <div className="sidebar-header">
          <div className="brand"><span className="brand-dot" />Akanksha AI</div>
          <button className="icon-btn" onClick={() => setSidebarOpen(false)} title="Hide sidebar">‹</button>
        </div>
        <button className="new-chat" onClick={createChat}>＋ New chat</button>

        <div className="conv-list">
          {recentChats.map((c) => (
            <button
              key={c.id}
              className={`conv-item ${c.id === active.id ? 'active' : ''}`}
              onClick={() => setActiveId(c.id)}
            >
              <span className="title" title={c.title}>{c.title}</span>
              <span className="del" title="Delete" onClick={(e) => { e.stopPropagation(); deleteChat(c.id) }}>✕</span>
            </button>
          ))}
        </div>

      </aside>

      <main className="main">
        <header className="topbar">
          {!sidebarOpen && (
            <button className="icon-btn" onClick={() => setSidebarOpen(true)} title="Show sidebar">☰</button>
          )}
          <div className="topbar-title">{adminOpen ? 'Admin' : active.title}</div>
          {!adminOpen && (
            <span className="db-picker" title={canPickDb ? 'Auto picks the database from your question. Choose one yourself to fix it; changing it starts a new chat.' : 'The database is picked automatically for each question.'}>
              <select
                id="db-select"
                className="db-select"
                value={active.database || (autoDb ? '__auto__' : dbName)}
                onChange={(e) => {
                  const v = e.target.value
                  if (v === '__auto__') {
                    setAutoDb(true)
                    if ((active.messages || []).length || active.messageCount) createChat()
                  } else {
                    setAutoDb(false)
                    chooseDatabase(v)
                  }
                }}
                aria-label="Database"
                disabled={!canPickDb}
                title={canPickDb ? undefined : 'The database is picked automatically for each question'}
              >
                <option value="__auto__">Auto</option>
                {!(databases.some((d) => d.name === (active.database || dbName))) && (active.database || dbName) && <option value={active.database || dbName}>{active.database || dbName}</option>}
                {databases.map((d) => <option key={d.name} value={d.name}>{autoDb && d.name === active.database ? `Auto · ${d.name}` : d.name}</option>)}
              </select>
              <button type="button" className={`icon-btn refresh ${tablesLoading ? 'spinning' : ''}`} onClick={refreshAll} disabled={tablesLoading} title="Reload databases and tables" aria-label="Refresh databases">↻</button>
              {dbError && <span className="error-text small">{dbError}</span>}
            </span>
          )}
          {!adminOpen && (routing
            ? <div className="model-pill" title={`Lookups: ${MODEL_LABELS[routing.lookup] || routing.lookup}\nAggregates: ${MODEL_LABELS[routing.aggregate] || routing.aggregate}\nAnalysis: ${MODEL_LABELS[routing.analysis] || routing.analysis}`}>Auto · {(MODEL_LABELS[routing.lookup] || routing.lookup).replace('Claude ', '')} → {(MODEL_LABELS[routing.analysis] || routing.analysis).replace('Claude ', '')}</div>
            : <div className="model-pill" title={modelId}>{MODEL_LABELS[modelId] || modelId || "Model"}</div>)}
          <UserChip user={user} quota={quota} credits={credits} onLogout={onLogout} adminOpen={adminOpen} onAdmin={() => { setAdminOpen((o) => !o); loadQuota(); loadCredits() }} onPreferences={() => setPrefsOpen(true)} />
        </header>
        {(() => {
          const last = activeMessages[activeMessages.length - 1]
          if (!last?.clarify?.open || last.pending || streaming) return null
          const close = () => updateConversation(active.id, (c) => ({ ...c, messages: c.messages.map((x) => (x.id === last.id ? { ...x, clarify: { ...x.clarify, open: false } } : x)) }))
          return <ClarifyDialog questions={last.clarify.questions} onClose={close} onSubmit={(text) => { close(); send(text, { keepDb: true }) }} />
        })()}
        {prefsOpen && <PreferencesPanel databases={databases} onClose={() => setPrefsOpen(false)} />}
        {adminOpen ? <AdminPage user={user} databases={databases} /> : (<>

        <section className="messages">
          {activeMessages.length === 0 ? (
            <div className="empty">
              <h1>Ask about your data</h1>
              <p>{autoDb ? 'Claude picks the right database for your question and runs read-only queries to answer.' : `Claude can see every table in ${dbName || 'the database'} and runs read-only queries to answer.`}</p>
              <div className="suggestions">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="suggestion" onClick={() => send(s)}>{s}</button>
                ))}
              </div>
            </div>
          ) : (
            <div className="messages-inner">
              {activeMessages.map((m) => (
                <div key={m.id} className={`msg ${m.role}`}>
                  {m.role === 'assistant' && <div className="avatar">AI</div>}
                  <div className="bubble">
                    {m.role === 'assistant' ? (
                      <>
                        <StepsBlock message={m} />
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                        {m.pending && m.content && <span className="cursor" />}
                        <AnswerMeta message={m} isAdmin={user.role === 'admin'} defaultModel={modelId} />
                        {m.cached && <div className="cached-note">Reused your earlier answer to this exact question{typeof m.cached === 'string' ? ` from ${new Date(m.cached).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}. No tokens used.</div>}
                        {MESSAGE_BLOCKS.map((Block, i) => (
                          <Block
                            key={i}
                            message={m}
                            onStepChange={(stepId, patch) => updateConversation(active.id, (c) => ({ ...c, messages: c.messages.map((x) => (x.id === m.id ? { ...x, steps: (x.steps || []).map((st) => (st.id === stepId ? { ...st, ...patch } : st)) } : x)) }))}
                          />
                        ))}
                        {m.cutOff && !m.pending && (
                          <div className="cached-note">
                            This answer reached the length limit and stops here.{' '}
                            {m.id === activeMessages[activeMessages.length - 1].id && (
                              <button className="link-btn" disabled={streaming} onClick={() => send('Continue exactly where you stopped. Do not repeat what you already wrote; if you are in the middle of a table, repeat only its header row.')}>Continue</button>
                            )}
                          </div>
                        )}
                        {m.error && <div className="error-text">{m.error}</div>}
                        {m.clarify && !m.pending && m.id === activeMessages[activeMessages.length - 1].id && (
                          <div className="msg-actions">
                            <button className="action-btn primary" onClick={() => updateConversation(active.id, (c) => ({ ...c, messages: c.messages.map((x) => (x.id === m.id ? { ...x, clarify: { ...x.clarify, open: true } } : x)) }))}>Answer these</button>
                          </div>
                        )}
                        {!m.pending && m.content && !m.clarify && (
                          <div className="msg-actions">
                            {MESSAGE_ACTIONS.map((Action, i) => (
                              <Action
                                key={i}
                                conversation={active}
                                message={m}
                                database={active.database || dbName}
                                modelLabel={MODEL_LABELS[modelId] || modelId}
                                onMessageChange={(patch) => updateConversation(active.id, (c) => ({ ...c, messages: c.messages.map((x) => (x.id === m.id ? { ...x, ...patch } : x)) }))}
                              />
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="prompt-text">{m.content}</div>
                        {(() => {
                          const next = activeMessages[activeMessages.findIndex((x) => x.id === m.id) + 1]
                          const status = !next ? 'sent' : next.pending ? 'working' : next.error && !next.content ? 'failed' : 'answered'
                          return <PromptFooter message={m} status={status} canRetry={!streaming} onRetry={(text) => send(text)} />
                        })()}
                      </>
                    )}
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </section>

        <footer className="composer">
          <div className="composer-inner">
            <textarea
              ref={textareaRef}
              rows={1}
              placeholder={creditsOver ? 'Your credits are over. Please ask an admin to add more.' : `Ask a question about ${active.database || (autoDb ? '' : dbName) || 'your data'}…`}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={streaming || creditsOver}
            />
            <div className="composer-row">
              {creditsOver
                ? <span className="hint credits-over">Your credits are over. {credits.monthlyRefill ? 'They refill on the 1st of next month, or ask an admin to add more.' : 'Please ask an admin to add more credits to keep using Akanksha AI.'}</span>
                : <span className="hint">Enter to send · Shift+Enter for a new line</span>}
              {streaming ? (
                <button className="send stop" onClick={stop} title="Stop">■</button>
              ) : (
                <button className="send" onClick={() => send()} disabled={!input.trim() || creditsOver} title="Send">↑</button>
              )}
            </div>
          </div>
        </footer>
        </>)}
      </main>
    </div>
  )
}
