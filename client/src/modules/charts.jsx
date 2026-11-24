import { useEffect, useRef, useState } from 'react'
import Chart from './Chart.jsx'

// One card per chartable query result in an answer. Nothing here touches the model.
function ChartCard({ step, index, onChange, defaultHidden }) {
  const spec = step.ui.chart
  const [type, setType] = useState(step.chartType || spec.type)
  const [hidden, setHidden] = useState(step.chartHidden ?? defaultHidden)
  const ref = useRef(null)
  const [width, setWidth] = useState(640)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [hidden])

  const pick = (t) => { setType(t); onChange?.({ chartType: t }) }
  const toggle = () => { setHidden((h) => { onChange?.({ chartHidden: !h }); return !h }) }
  const canPie = spec.y.length === 1 && spec.data.length <= 8 && spec.data.every((r) => r[1] >= 0)
  const title = `${spec.y.join(', ')} by ${spec.x}`

  return (
    <div className="chart-card">
      <div className="chart-head">
        <span className="chart-title" title={step.ui.sql}>{title}<em> · query {index + 1}, {spec.data.length} rows</em></span>
        <span className="chart-types">
          {!hidden && ['bar', 'hbar', 'line', ...(canPie ? ['pie'] : [])].map((t) => (
            <button key={t} type="button" className={`type-btn ${type === t ? 'on' : ''}`} onClick={() => pick(t)}>{{ bar: 'Bars', hbar: 'Rows', line: 'Line', pie: 'Pie' }[t]}</button>
          ))}
          <button type="button" className="type-btn" onClick={toggle}>{hidden ? 'Show chart' : 'Hide'}</button>
        </span>
      </div>
      {!hidden && <div className="chart-body" ref={ref}><Chart spec={spec} type={type} width={width} /></div>}
    </div>
  )
}

export default function ChartsBlock({ message, onStepChange }) {
  const steps = (message.steps || []).map((s, i) => [s, i]).filter(([s]) => s.module === 'sql' && s.status === 'done' && s.ui?.chart)
  if (!steps.length || message.pending) return null
  return (
    <div className="charts">
      {steps.map(([s, i], k) => <ChartCard key={s.id} step={s} index={i} defaultHidden={k < steps.length - 1} onChange={(patch) => onStepChange?.(s.id, patch)} />)}
    </div>
  )
}
