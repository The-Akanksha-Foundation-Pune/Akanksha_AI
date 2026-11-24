// Renders a run_sql step: query text, row count, timing.
export default function SqlStep({ step }) {
  const { ui = {}, status, error } = step
  const label =
    status === 'running' ? 'Running query…'
    : status === 'error' ? 'Query failed'
    : `Query returned ${ui.rowCount ?? 0} row${ui.rowCount === 1 ? '' : 's'}${ui.truncated ? ' (truncated)' : ''}${ui.durationMs != null ? ` · ${ui.durationMs} ms` : ''}`
  return (
    <details className={`step ${status}`} open={status === 'running'}>
      <summary><span className="step-dot" />{label}</summary>
      <pre><code>{ui.sql || '(no SQL)'}</code></pre>
      {error && <div className="error-text small">{error}</div>}
    </details>
  )
}
