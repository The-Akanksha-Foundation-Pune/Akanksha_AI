import { useEffect, useState } from 'react'

// Under each prompt: relative time, a tick (sent) or double tick (answered), copy, and retry.
function relative(ts, now) {
  const s = Math.max(0, Math.round((now - new Date(ts).getTime()) / 1000))
  if (s < 10) return 'just now'
  if (s < 60) return `${s} seconds ago`
  const m = Math.round(s / 60); if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`
  const h = Math.round(m / 60); if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`
  const d = Math.round(h / 24); if (d < 7) return `${d} day${d === 1 ? '' : 's'} ago`
  return new Date(ts).toLocaleDateString('en-IN', { dateStyle: 'medium' })
}

const Check = ({ double }) => (
  <svg width="18" height="14" viewBox="0 0 22 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M1.5 7.5l4 4L12 4" />
    {double && <path d="M9 11.5l1.5 1.5L20 4" />}
  </svg>
)
const CopyIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </svg>
)
const RetryIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" />
  </svg>
)

export default function PromptFooter({ message, status, onRetry, canRetry }) {
  const [now, setNow] = useState(Date.now())
  const [copied, setCopied] = useState(false)
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id) }, [])

  const copy = async () => {
    try { await navigator.clipboard.writeText(message.content) } catch {
      const ta = document.createElement('textarea'); ta.value = message.content; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy') } catch { /* ignore */ } ta.remove()
    }
    setCopied(true); setTimeout(() => setCopied(false), 1500)
  }

  const statusTitle = status === 'answered' ? 'Answered' : status === 'failed' ? 'The answer failed' : status === 'working' ? 'Being answered' : 'Sent'
  return (
    <div className="prompt-footer">
      {message.createdAt && <span className="prompt-time" title={new Date(message.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}>{relative(message.createdAt, now)}</span>}
      <span className={`prompt-status ${status}`} title={statusTitle}><Check double={status === 'answered'} /></span>
      <button type="button" className="prompt-btn" onClick={copy} title={copied ? 'Copied' : 'Copy prompt'} aria-label="Copy prompt">{copied ? <span className="copied">Copied</span> : <CopyIcon />}</button>
      <button type="button" className="prompt-btn" onClick={() => onRetry(message.content)} disabled={!canRetry} title="Ask this again" aria-label="Ask this again"><RetryIcon /></button>
    </div>
  )
}
