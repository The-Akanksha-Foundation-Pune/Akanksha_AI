import { useState } from 'react'

// The Prism mark ("Light into answers", chosen by the user on 24 Nov 2026): a beam of light enters a glass
// prism and comes out as a small chart. Pure SVG + CSS (styles in App.css under "Prism mark").
//
//   mode="once"  plays the entrance once and rests on the finished mark; hovering plays it again
//   mode="loop"  keeps cycling (sign-in page, and the sidebar while an answer is being written)
//   mode="still" no motion
//
// People who ask their device for reduced motion always get the still mark.
const BARS = [
  { x: 62, h: 34, c: '#ff6b6b' },
  { x: 76, h: 56, c: '#ffd43b' },
  { x: 90, h: 44, c: '#22b8cf' },
  { x: 104, h: 70, c: '#845ef7' },
]
const BASE = 98 // y of the chart's baseline
const EXIT = { x: 41, y: 60 } // where the light leaves the prism

export default function PrismMark({ size = 28, mode = 'once', title }) {
  const [run, setRun] = useState(0)
  const replay = mode === 'once' ? () => setRun((n) => n + 1) : undefined
  return (
    <svg
      key={run} className={`prism-mark ${mode}`} width={size} height={size} viewBox="0 0 120 120"
      role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} onMouseEnter={replay}
    >
      {BARS.map((b, i) => <line key={`r${i}`} className="pm-ray" x1={EXIT.x} y1={EXIT.y} x2={b.x + 5.5} y2={BASE - b.h} stroke={b.c} strokeWidth="3" strokeLinecap="round" />)}
      {BARS.map((b, i) => <rect key={`b${i}`} className="pm-bar" style={{ '--i': i }} x={b.x} y={BASE - b.h} width="11" height={b.h} rx="3" fill={b.c} />)}
      <line className="pm-in" x1="-6" y1="66" x2="19" y2="60" stroke="#ffb84d" strokeWidth="6" strokeLinecap="round" />
      <polygon className="pm-glass" points="30,38 8,82 52,82" strokeWidth="6" strokeLinejoin="round" />
    </svg>
  )
}
