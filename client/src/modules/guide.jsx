// "What can I ask?": the guide for people who use Prism (user request, 24 Nov 2026). Written for staff who
// are not technical: it names topics and the things recorded about them, never tables, columns or SQL.
// A topic is shown only when the person can see at least one of the databases behind it (`dbs`), so nobody
// is told about data their role cannot reach. Each example is a button that asks that question.
//
// Keep this in step with the data: when a new source is added, add a topic here and a line in the autodb
// module's DB_HINTS.
const TOPICS = [
  {
    id: 'students', title: 'Students and enrolment', dbs: ['AFDW'],
    about: 'Who is studying in Akanksha schools, and how that changes.',
    points: [
      'How many students there are in a school, grade or division, and how many are girls and boys',
      'Who is enrolled now and each student\'s current status',
      'Students who have left, and students marked as at risk of leaving',
      'How a student\'s school, grade or status has changed from year to year',
    ],
    examples: [
      'How many students are enrolled in each school this year, split by girls and boys?',
      'Which schools and grades had the most students leave last academic year?',
    ],
  },
  {
    id: 'attendance', title: 'Attendance', dbs: ['AFDW', 'Netsuite'],
    about: 'How regularly students come to school, month by month.',
    points: [
      'Each student\'s attendance percentage for every month, with working days and days present',
      'Attendance for a school, grade or division, and how it moves across the year',
      'Students or classes below a level you choose, for example below 75%',
      'Parents\' attendance at parent-teacher meetings',
      'Detailed records from 2023-24 onwards; simpler records go back to 2003-04',
    ],
    examples: [
      'Which schools\' attendance fell the most between August and October 2026? Show the monthly attendance for each',
      'List the grades with average attendance below 80% this year, school by school',
    ],
  },
  {
    id: 'assessments', title: 'Assessments', dbs: ['AFDW'],
    about: 'How students did in term assessments and unit tests.',
    points: [
      'Marks and percentages in term assessments such as the MOY, and in unit tests',
      'Results by subject, for a student, a division, a grade, a school or all schools',
      'Comparisons across years, between schools, or between girls and boys',
      'Competency levels, and how students did on individual questions',
      'Who was absent for an assessment',
    ],
    examples: [
      'Compare each school\'s MOY results with the previous year\'s MOY, subject by subject, and rank schools by improvement',
      'Where is the gap between girls and boys widest in the latest MOY assessment? Break it down by grade and subject',
    ],
  },
  {
    id: 'raz', title: 'Reading levels (RAZ)', dbs: ['AFDW'],
    about: 'Where each student is in reading, and whether that is where they should be.',
    points: [
      'The reading level each student was assessed at',
      'Accuracy and comprehension scores',
      'The level expected for the grade, and who is below, at or above it',
      'Results by school, grade and division for each assessment round',
    ],
    examples: [
      'In the MOY 2026-2027 RAZ assessment, what share of students in each grade are below their expected level, by school?',
      'Which divisions have the lowest average comprehension score in the latest RAZ round?',
    ],
  },
  {
    id: 'it-visits', title: 'IT visits to schools', dbs: ['tether_forms'],
    about: 'What the technology team found when they visited schools.',
    points: [
      'Which schools were visited, when, and by whom',
      'The type of visit and whether it was completed',
      'How the network was working',
      'Device problems reported and the applications in use',
      'Schools that have not been visited for a while',
    ],
    examples: [
      'Which schools have had no IT visit in the last 30 days, and which device issues came up most in visits this year?',
      'How many IT visits did each team member complete each month this year?',
    ],
  },
  {
    id: 'it-helpdesk', title: 'IT helpdesk tickets', dbs: ['IT_helpdesk'],
    about: 'IT problems raised by schools and how quickly they were solved.',
    points: [
      'Tickets raised, by school and by kind of problem',
      'Which are open, in progress or closed, and who is handling them',
      'How long tickets took to resolve, against the agreed time',
    ],
    examples: [
      'How many helpdesk tickets are open right now, by school, and which have been open longest?',
      'What share of tickets were resolved within the agreed time each month?',
    ],
  },
  {
    id: 'finance', title: 'Finance and budgets', dbs: ['Finance', 'Budget', 'pazy'],
    about: 'What was spent, on what, and how it compares with the budget.',
    points: [
      'Payment vouchers and where each one is in approval',
      'Payments made, and the vendors they went to',
      'Spending by cost centre and by expense head',
      'Budget against actual spending, including by donor',
      'Vendor invoices and staff expense claims',
    ],
    examples: [
      'Which cost centres have spent the largest share of their budget so far this year?',
      'How many payment vouchers are waiting for approval, and for how long, by approver?',
    ],
  },
  {
    id: 'alumni', title: 'Alumni', dbs: ['akanksha_production'],
    about: 'What students went on to do after leaving school.',
    points: [
      'Alumni by school and by the year they finished',
      'The college and course each alumnus is in, year by year',
      'Who has graduated',
      'Work after studies, by kind of job and sector',
    ],
    examples: [
      'How many alumni from each school are in college this year, and in which kinds of course?',
      'What share of each batch has graduated so far?',
    ],
  },
  {
    id: 'timetable', title: 'School timetables', dbs: ['TimeTable'],
    about: 'Who teaches what, to which class, and when.',
    points: [
      'Teachers, the subjects they teach and their classes',
      'Periods in the week for a class or a teacher',
      'How many periods each subject gets in each grade',
    ],
    examples: [
      'How many periods a week does each teacher have, school by school?',
      'Which classes have fewer Maths periods than the others in the same grade?',
    ],
  },
  {
    id: 'consultants', title: 'Consultants', dbs: ['consultant_mgmt'],
    about: 'Consultants working with Akanksha and the paperwork around them.',
    points: [
      'Current and past engagements, and their dates',
      'Work reports submitted and their approval',
      'Invoices raised and where they are in approval',
    ],
    examples: [
      'Which consultant engagements end in the next 60 days?',
      'How many consultant invoices are waiting for approval, and since when?',
    ],
  },
  {
    id: 'assets', title: 'Assets', dbs: ['fams_mysql_dev'],
    about: 'Equipment and where it is. This register is still being set up, so it is not complete.',
    points: [
      'Assets by type, condition and location',
      'IT details of devices',
      'Results of asset verification rounds',
    ],
    examples: [
      'How many assets of each type are recorded at each location?',
    ],
  },
]

const TIPS = [
  ['Say which school, grade and year', 'Without these, Prism has to guess or ask. "Grade 5 at one school in 2026-27" gets a sharper answer than "our students".'],
  ['Say what to measure', 'Average percentage, number of students, change from last year, the top ten. Name the measure you would put in your report.'],
  ['Ask one thing, then follow up', 'Start simple and build on it: "now only girls", "compare with last year", "show it as a table". Prism remembers the conversation.'],
  ['Answer its questions', 'When Prism offers you choices before answering, it is checking which year or measure you mean. Picking one takes a second and avoids a wrong answer.'],
  ['Check how it worked it out', 'Ask "how did you calculate this?" and it will explain in plain words. For anything important, check one figure you already know.'],
  ['Tell it when it is right or wrong', 'The thumbs under each answer teach Prism which answers were good, so it improves for everyone.'],
]

const LIMITS = [
  'It only answers from Akanksha\'s own records. It will say so if you ask about something else, such as general knowledge, news, or help writing a letter.',
  'It cannot add, change or delete anything. It only reads.',
  'It cannot tell you about things nobody recorded. If a school did not enter its data, Prism cannot see it.',
  'It is as up to date as the system the data comes from. Something entered today may not show until that system is next refreshed.',
  'It shows only what your role is allowed to see.',
  'It can make mistakes, most often by misunderstanding the question. Treat a surprising number as a reason to ask again, not as a fact.',
]

export default function Guide({ databases, onAsk, onClose }) {
  const visible = new Set((databases || []).map((d) => d.name))
  const topics = visible.size ? TOPICS.filter((t) => t.dbs.some((d) => visible.has(d))) : TOPICS
  const jump = (id) => document.getElementById(`guide-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <div className="guide-page">
      <div className="guide-head">
        <div>
          <h1>What can I ask?</h1>
          <p className="guide-lead">Prism answers questions from Akanksha's own records. Ask in your own words, the way you would ask a colleague who knows the data. Below is what it knows about, with questions you can try by clicking them.</p>
        </div>
        <button type="button" className="action-btn" onClick={onClose}>Back to chat</button>
      </div>

      <nav className="guide-jump" aria-label="Topics">
        {topics.map((t) => <button key={t.id} type="button" className="guide-chip" onClick={() => jump(t.id)}>{t.title}</button>)}
        <button type="button" className="guide-chip" onClick={() => jump('tips')}>Asking well</button>
        <button type="button" className="guide-chip" onClick={() => jump('limits')}>What Prism cannot do</button>
      </nav>

      <div className="guide-grid">
        {topics.map((t) => (
          <section key={t.id} id={`guide-${t.id}`} className="guide-card">
            <h2>{t.title}</h2>
            <p className="guide-about">{t.about}</p>
            <h3>You can ask about</h3>
            <ul>{t.points.map((p) => <li key={p}>{p}</li>)}</ul>
            <h3>Try asking</h3>
            <div className="guide-examples">
              {t.examples.map((q) => <button key={q} type="button" className="guide-example" onClick={() => onAsk(q)}>{q}</button>)}
            </div>
          </section>
        ))}
      </div>

      <section id="guide-tips" className="guide-card wide">
        <h2>How to get a good answer</h2>
        <div className="guide-tips">
          {TIPS.map(([title, text]) => <div key={title}><strong>{title}</strong><p>{text}</p></div>)}
        </div>
      </section>

      <section id="guide-limits" className="guide-card wide">
        <h2>What Prism cannot do</h2>
        <ul>{LIMITS.map((l) => <li key={l}>{l}</li>)}</ul>
        <p className="guide-about">If you need something that is not listed here, ask anyway. Prism will tell you plainly when it does not have the data.</p>
      </section>
    </div>
  )
}
