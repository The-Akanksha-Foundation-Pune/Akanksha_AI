// Dependency-free SVG charts: bar, hbar, line, pie. Colors come from CSS tokens so dark mode just works.
const SERIES = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)']
const fmt = (n) => (Math.abs(n) >= 1000 ? n.toLocaleString() : Number.isInteger(n) ? String(n) : n.toFixed(2))
const niceMax = (m) => { if (m <= 0) return 1; const p = 10 ** Math.floor(Math.log10(m)); const s = m / p; return (s <= 1 ? 1 : s <= 2 ? 2 : s <= 5 ? 5 : 10) * p }
const short = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

function Legend({ y }) {
  if (y.length < 2) return null
  return <div className="chart-legend">{y.map((name, i) => <span key={name} style={{ '--sw': SERIES[i] }}>{name}</span>)}</div>
}

function Bars({ spec, width }) {
  const { data, y } = spec
  const H = 220, mL = 44, mR = 8, mT = 8, mB = 44
  const W = Math.max(width, 240)
  const max = niceMax(Math.max(...data.flatMap((r) => r.slice(1))))
  const innerW = W - mL - mR, innerH = H - mT - mB
  const group = innerW / data.length, barW = Math.min(32, (group * 0.7) / y.length)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img">
      {ticks.map((t) => { const yy = mT + innerH - (t / max) * innerH; return <g key={t}><line x1={mL} x2={W - mR} y1={yy} y2={yy} className="grid" /><text x={mL - 6} y={yy} dy="0.35em" textAnchor="end" className="tick">{fmt(t)}</text></g> })}
      {data.map((r, i) => {
        const gx = mL + i * group + (group - barW * y.length) / 2
        return <g key={r[0]}>
          {y.map((_, s) => { const h = (r[s + 1] / max) * innerH; return <rect key={s} x={gx + s * barW} y={mT + innerH - h} width={barW - 2} height={Math.max(0, h)} rx="3" fill={SERIES[s]}><title>{`${r[0]} · ${y[s]}: ${fmt(r[s + 1])}`}</title></rect> })}
          {y.length === 1 && data.length <= 12 && <text x={gx + barW / 2 - 1} y={mT + innerH - (r[1] / max) * innerH - 4} textAnchor="middle" className="val">{fmt(r[1])}</text>}
          <text x={gx + (barW * y.length) / 2} y={H - mB + 14} textAnchor="middle" className="tick" transform={data.length > 6 ? `rotate(-30 ${gx + (barW * y.length) / 2} ${H - mB + 14})` : undefined}>{short(r[0], data.length > 6 ? 12 : 16)}</text>
        </g>
      })}
      <line x1={mL} x2={W - mR} y1={mT + innerH} y2={mT + innerH} className="axis" />
    </svg>
  )
}

function HBars({ spec, width }) {
  const { data, y } = spec
  const rowH = 22 * y.length + 6, mL = 120, mR = 56, mT = 6
  const W = Math.max(width, 240), H = mT + data.length * rowH + 6
  const max = Math.max(...data.flatMap((r) => r.slice(1))) || 1
  const innerW = W - mL - mR
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img">
      {data.map((r, i) => <g key={r[0]} transform={`translate(0,${mT + i * rowH})`}>
        <text x={mL - 8} y={rowH / 2} dy="0.35em" textAnchor="end" className="tick"><title>{r[0]}</title>{short(r[0], 18)}</text>
        {y.map((_, s) => { const w = (r[s + 1] / max) * innerW; const yy = 3 + s * 22; return <g key={s}><rect x={mL} y={yy} width={Math.max(0, w)} height="16" rx="3" fill={SERIES[s]}><title>{`${r[0]} · ${y[s]}: ${fmt(r[s + 1])}`}</title></rect><text x={mL + w + 6} y={yy + 8} dy="0.35em" className="val">{fmt(r[s + 1])}</text></g> })}
      </g>)}
    </svg>
  )
}

function Lines({ spec, width }) {
  const { data, y } = spec
  const H = 220, mL = 44, mR = 12, mT = 10, mB = 40
  const W = Math.max(width, 240)
  const max = niceMax(Math.max(...data.flatMap((r) => r.slice(1))))
  const innerW = W - mL - mR, innerH = H - mT - mB
  const px = (i) => mL + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW)
  const py = (v) => mT + innerH - (v / max) * innerH
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max)
  const every = Math.ceil(data.length / 8)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img">
      {ticks.map((t) => <g key={t}><line x1={mL} x2={W - mR} y1={py(t)} y2={py(t)} className="grid" /><text x={mL - 6} y={py(t)} dy="0.35em" textAnchor="end" className="tick">{fmt(t)}</text></g>)}
      {y.map((_, s) => <g key={s}>
        <path d={data.map((r, i) => `${i ? 'L' : 'M'}${px(i)},${py(r[s + 1])}`).join(' ')} fill="none" stroke={SERIES[s]} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {data.map((r, i) => <circle key={i} cx={px(i)} cy={py(r[s + 1])} r="3.5" fill={SERIES[s]}><title>{`${r[0]} · ${y[s]}: ${fmt(r[s + 1])}`}</title></circle>)}
      </g>)}
      {data.map((r, i) => i % every === 0 && <text key={r[0]} x={px(i)} y={H - mB + 16} textAnchor="middle" className="tick">{short(r[0], 10)}</text>)}
      <line x1={mL} x2={W - mR} y1={mT + innerH} y2={mT + innerH} className="axis" />
    </svg>
  )
}

function Pie({ spec, width }) {
  const { data } = spec
  const W = Math.max(width, 240), H = 220, R = 90, cx = Math.min(W / 3, 130), cy = H / 2
  const total = data.reduce((a, r) => a + r[1], 0) || 1
  let angle = -Math.PI / 2
  const arcs = data.map((r, i) => {
    const a0 = angle, a1 = angle + (r[1] / total) * Math.PI * 2; angle = a1
    const large = a1 - a0 > Math.PI ? 1 : 0
    const p = (a) => [cx + R * Math.cos(a), cy + R * Math.sin(a)]
    const [x0, y0] = p(a0), [x1, y1] = p(a1), [xi0, yi0] = [cx + R * 0.58 * Math.cos(a0), cy + R * 0.58 * Math.sin(a0)], [xi1, yi1] = [cx + R * 0.58 * Math.cos(a1), cy + R * 0.58 * Math.sin(a1)]
    return { d: `M${x0},${y0} A${R},${R} 0 ${large} 1 ${x1},${y1} L${xi1},${yi1} A${R * 0.58},${R * 0.58} 0 ${large} 0 ${xi0},${yi0} Z`, color: `hsl(${(i * 47 + 20) % 360} 55% 52%)`, r }
  })
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img">
      {arcs.map((a) => <path key={a.r[0]} d={a.d} fill={a.color} stroke="var(--surface)" strokeWidth="2"><title>{`${a.r[0]}: ${fmt(a.r[1])} (${Math.round((a.r[1] / total) * 100)}%)`}</title></path>)}
      <text x={cx} y={cy} dy="0.35em" textAnchor="middle" className="val big">{fmt(total)}</text>
      {arcs.map((a, i) => <g key={a.r[0]} transform={`translate(${cx + R + 24},${cy - arcs.length * 9 + i * 18})`}><rect width="10" height="10" rx="2" fill={a.color} /><text x="15" y="5" dy="0.35em" className="tick">{short(a.r[0], 22)} · {Math.round((a.r[1] / total) * 100)}%</text></g>)}
    </svg>
  )
}

export default function Chart({ spec, type, width = 640 }) {
  const t = type || spec.type
  if (t === 'line') return <><Legend y={spec.y} /><Lines spec={spec} width={width} /></>
  if (t === 'hbar') return <><Legend y={spec.y} /><HBars spec={spec} width={width} /></>
  if (t === 'pie') return <Pie spec={spec} width={width} />
  return <><Legend y={spec.y} /><Bars spec={spec} width={width} /></>
}
