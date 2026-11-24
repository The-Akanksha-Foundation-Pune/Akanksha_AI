import { useState } from 'react'

// "Download as Word" action for a finished answer. Calls the export module on the server.
export default function ExportAction({ conversation, message, database, modelLabel }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const download = async () => {
    const idx = conversation.messages.findIndex((m) => m.id === message.id)
    const question = [...conversation.messages.slice(0, idx)].reverse().find((m) => m.role === 'user')?.content || ''
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/modules/export/docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: conversation.title, question, markdown: message.content, database, model: modelLabel }),
      })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `Export failed (${res.status})`) }
      const blob = await res.blob()
      const name = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || 'report.docx'
      const url = URL.createObjectURL(blob)
      const link = Object.assign(document.createElement('a'), { href: url, download: name })
      document.body.appendChild(link); link.click(); link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" className="action-btn" onClick={download} disabled={busy} title="Download this answer as a Word document">
        {busy ? 'Preparing…' : '⬇ Download as Word'}
      </button>
      {error && <span className="error-text small">{error}</span>}
    </>
  )
}
