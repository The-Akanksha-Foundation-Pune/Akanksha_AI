import { useEffect, useState } from 'react'
import { renderStep } from './index.jsx'

// Shown while Claude is working. Rotates through classroom phrases instead of listing queries.
const PHRASES = [
  'Taking attendance…', 'Opening the register…', 'Checking the timetable…', 'Ringing the school bell…',
  'Counting heads in the classroom…', 'Sharpening the pencils…', 'Wiping the blackboard…', 'Collecting the worksheets…',
  'Marking the answer sheets…', 'Reading the report cards…', 'Lining up for assembly…', 'Asking the class teacher…',
  'Looking it up in the library…', 'Doing the sums…', 'Checking the homework…', 'Turning to the right page…',
  'Sorting the stationery cupboard…', 'Filling in the mark sheet…', 'Walking to the staff room…', 'Finding the right notebook…',
  'Writing it on the board…', 'Reviewing the lesson plan…', 'Checking the attendance sheet…', 'Adding up the marks…',
]

const pick = (prev) => { let p; do { p = PHRASES[Math.floor(Math.random() * PHRASES.length)] } while (p === prev && PHRASES.length > 1); return p }

export function WorkingLine({ tick }) {
  const [phrase, setPhrase] = useState(() => pick())
  useEffect(() => { setPhrase((p) => pick(p)) }, [tick])
  useEffect(() => {
    const id = setInterval(() => setPhrase((p) => pick(p)), 2400)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="working" aria-live="polite">
      <span className="working-dots"><i /><i /><i /></span>
      <span key={phrase} className="working-text">{phrase}</span>
    </div>
  )
}

// After the answer: one quiet line that expands to the query details.
export default function StepsBlock({ message }) {
  const steps = message.steps || []
  const running = steps.some((s) => s.status === 'running')
  const working = message.pending && (!message.content || running)
  if (working) return <WorkingLine tick={steps.length} />
  if (message.pending || !steps.length) return null
  const sql = steps.filter((s) => s.module === 'sql')
  const failed = steps.filter((s) => s.status === 'error').length
  const ms = sql.reduce((a, s) => a + (s.ui?.durationMs || 0), 0)
  const label = `${sql.length === steps.length ? `Ran ${sql.length} ${sql.length === 1 ? 'query' : 'queries'}` : `${steps.length} steps`}${ms ? ` · ${ms} ms` : ''}${failed ? ` · ${failed} failed` : ''}`
  return (
    <details className="steps-summary">
      <summary><span className={`step-dot ${failed ? 'error' : 'done'}`} />{label}</summary>
      <div className="steps-list">{steps.map(renderStep)}</div>
    </details>
  )
}
