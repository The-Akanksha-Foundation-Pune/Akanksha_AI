# Prism rules

Rules given by the people who own the data. Prism reads this file before every answer, and before it
chooses which database a question goes to. A rule here beats table names, database descriptions and
your own judgement. If a rule and a question seem to conflict, follow the rule and say what you did.

## Which records answer which topic

- **Consultants.** Any question about consultants is answered from the `consultant_mgmt` database, and
  only from it. That covers who the consultants are, their engagements and contracts, rates, work
  reports, invoices, payments to them, and the approvals on any of these.
  - Never use `consultant_mgmt_test`: it holds test data.
  - `AFDW` also has tables whose names start with `consultant_`. They are old copies. Never answer a
    consultant question from them, even if they look complete.
  - If the database in use is not `consultant_mgmt`, do not run a query for a consultant question.
    Say that consultant questions are answered from the consultant records, and ask the person to ask
    it again in a new chat so that those records are opened.

- **Alumni.** Any question about alumni is answered from two databases together:
  `akanksha_production` and `alumni_connect`. Look at both every time. Never use the `akanksha`
  database: it is not the live one.
  - `akanksha_production` is alumni tracking: who the alumni are, their school and cohort, college
    and course year by year, graduation, employment and income after school, counselling and
    mentoring.
  - `alumni_connect` is the Alumni Connect programme: each student's journey (strengths,
    aspirations, junior college and degree details, marks), events and who attended, sessions held
    in classes, partners, opportunities and applications to them, internships, career outcomes and
    college tiers.
  - The chat opens on `akanksha_production`; the other is read in the same query as
    `alumni_connect.<table>`. A person is the same in both when `st_id` matches, so join on `st_id`
    to put the two together. Rows in `alumni_connect` whose `st_id` is blank have not been matched
    to a person yet: count them separately and say so.
  - Many `alumni_connect` tables are still empty or nearly empty. When the one a question needs has
    no rows, say that this is not recorded yet; do not answer as if the count were zero.
  - If the database in use is neither of these, do not run a query for an alumni question. Ask the
    person to ask it again in a new chat so that the alumni records are opened.

- **RAZ and reading.** Any question about RAZ, reading, reading levels, reading accuracy or reading
  comprehension is answered from the `AFDW` database, from these two tables:
  - `raz_assessment_data`: one row per student per RAZ assessment, with the level assessed, the
    expected level, errors and words read, the accuracy and comprehension scores, the verdict and the
    intervention flag.
  - `raz_assessment_comprehension`: the marks for each comprehension question of an assessment. Use it
    whenever the question is about comprehension in any detail (which questions or skills are weak),
    joined to `raz_assessment_data` on `student_id`, `assessment_id` and `generated_id`.
  - **A comprehension score of 0 usually means "not assessed", not "understood nothing".**
    Comprehension questions are given only from level A upwards. A child assessed at level `AA`, or
    marked `Not AA` (not yet reading at the lowest level), is not asked them: for those rows the
    `comprehension` column is NULL, and `comprehension_score` holds 0 only as a placeholder. Most
    Junior KG and Senior KG children are at these levels. So:
    - For any comprehension average, total, ranking or comparison, count only the rows where
      `comprehension IS NOT NULL`, and say in the answer how many children were assessed and how
      many were left out because they were at level AA or below.
    - Write the average as `AVG(CASE WHEN comprehension IS NOT NULL THEN comprehension_score END)`,
      or put `comprehension IS NOT NULL` in the WHERE clause. A plain `AVG(comprehension_score)` is
      wrong even when the query also counts the assessed children or filters groups with HAVING:
      the placeholder zeros are still inside the average and pull it down.
    - Children who were absent (`attendance` = 'A') have no scores at all. Leave them out of every
      RAZ figure and, when it matters, give them as a separate count of absent children; do not
      count them as "at level AA or below".
    - Never rank or describe a grade, school or division as weak in comprehension because of these
      zeros. If a group has no assessed children, or only a handful, say comprehension was not
      assessed for it instead of giving a figure.
    - A real zero does exist: `comprehension` = 0 (not NULL) means the child was asked and got none
      right.
    - The same goes for accuracy on `Not AA` rows: they have no words read (`total_words` = 0) and
      an `accuracy_score` of 0 that is a placeholder. Leave them out of accuracy averages and report
      them as a count of children not yet reading at level AA.
  - The small `raz_*` lookup tables in `AFDW` (expected levels, question labels, mapping) may be joined
    to explain these two. Never answer from `raz_assessment_data_backup_20260910`.
  - Do not answer a reading question from the general assessment tables (`full_assessment_data`,
    `student_full_assessment_data`), and never from the `raz_*` tables in `consultant_mgmt`: those
    are empty copies.
  - Almost all RAZ records are for 2026-2027. For an earlier year, check what exists and say plainly
    that RAZ reading records are missing or very few for it.
  - If the database in use is not `AFDW`, do not run a query for a RAZ or reading question. Ask the
    person to ask it again in a new chat.

- **Employees, staff and attrition.** Any question about employees or staff (headcount, who works
  where, joiners, leavers, attrition, retention, tenure, probation, reporting lines) is answered
  from the `historical_employees` table in the `AFDW` database, and only from it. This is the same
  table the HR dashboard on Kaleidoscope uses.
  - Whatever its name suggests, `historical_employees` holds **everyone who has ever been on staff,
    current and former**, one row per `employee_code`, with department, designation, location and
    school, cost centre, category, reporting manager, date of joining, confirmation date, status and
    relieving date.
  - Do not use the `employees` table for now, even when the person names it: it has no relieving
    dates and still lists people who have left. If asked for something "from the employees table",
    answer from `historical_employees` and say in one plain line that you did.
  - **Current staff** are the rows whose `relieving_date` is blank (NULL or an empty string), leaving
    out the status `Not Joining` and `Pending` (people who never joined). Use exactly this test for
    any headcount.
  - **People who have left** are the rows with a relieving date that has passed. A row with a
    relieving date in the future is someone serving notice: they are not in the current-staff count
    and not yet a leaver. Mention how many there are only when it matters to the answer.
  - `employee_status` describes the person further: `Confirmed`, `On Probation`, `Relieved`,
    `Absconding`, `Terminated`, `Exit Initiated`. Leave `Not Joining` and `Pending` out of every
    staff figure.
  - The dates are stored as text. `relieving_date` is written like `05-Nov-2026`: read it with
    `STR_TO_DATE(relieving_date, '%d-%b-%Y')`. `date_of_joining` and `confirmation_date` are written
    like `2026-11-05`. Convert a date before you compare, sort or take the earliest or latest: on
    the raw text those give wrong answers.
  - Exits are recorded from December 2020. Do not report attrition for an earlier period; say it is
    not recorded.
  - An attrition rate is the people who left in the period divided by the average of the headcount at
    its start and its end. Always state the exact period you used.
  - Never use `qandle_users` (two test rows), nor the employee tables in `tether_forms`, `Finance`,
    `fams_mysql_dev` or `consultant_mgmt`. If the database in use is not `AFDW`, ask the person to
    ask again in a new chat.

## Say what the records cover, and what they do not

The records are not complete for every school, year and topic. A programme or a system usually started
in a few schools and reached the others later, so an early year can hold far fewer schools than a
later one. The person asking does not know this. Tell them.

- **Check coverage before you answer.** When a question is about several schools, years, grades,
  subjects or assessment rounds, find out which of them have rows at all: count the distinct schools
  (or years, rounds) in the same query or in one beside it, and compare with what was asked.
- **Say what is there and what is not.** If something asked for has no rows, or far fewer than the
  rest, the answer says so in plain words before or right after the figures: which schools or years
  are covered, which are missing, and that a missing one means "not recorded here", not zero.
  Example: "Attendance for 2023-2024 is recorded for 13 schools only; the other schools have no
  attendance records for that year."
- **Do not present part of the picture as the whole.** A total, an average or a ranking is labelled
  with what it covers ("across the 13 schools with records"). Do not compare a year that has a few
  schools with a year that has all of them as if they were alike: compare the schools that are in
  both, or say plainly that the two years do not cover the same schools.
- **Never fill a gap.** Do not estimate, carry a figure over from another year, or show a school with
  no records as 0 or 0%. Leave it out of the figures and list it as not recorded.
- **If nothing is recorded** for what was asked, say that, then say what the closest thing on record
  is (the years, schools or rounds that do exist) so the person can ask again.

Known gaps (the check above still applies to everything else):

- **2023-2024, attendance and assessments.** Only about 10 to 13 schools were on Edustems that year,
  so the 2023-2024 records cover those schools only. From 2024-2025 onwards most schools are covered.
