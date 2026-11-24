// Client-side module registry: how each server module's tool steps and message actions render.
import SqlStep from './sql.jsx'
import ExportAction from './export.jsx'
import FeedbackAction from './feedback.jsx'
import ChartsBlock from './charts.jsx'

function GenericStep({ step }) {
  const { status, error, tool, ui = {} } = step
  return (
    <details className={`step ${status}`} open={status === 'running'}>
      <summary><span className="step-dot" />{status === 'running' ? `Running ${tool}…` : status === 'error' ? `${tool} failed` : `${tool} done`}</summary>
      <pre><code>{JSON.stringify(ui, null, 2)}</code></pre>
      {error && <div className="error-text small">{error}</div>}
    </details>
  )
}

export const STEP_RENDERERS = { sql: SqlStep }
export const MESSAGE_ACTIONS = [FeedbackAction, ExportAction]
// Blocks rendered after an answer's text (charts, tables, files).
export const MESSAGE_BLOCKS = [ChartsBlock]

export function renderStep(step) {
  const Renderer = STEP_RENDERERS[step.module] || GenericStep
  return <Renderer key={step.id} step={step} />
}
