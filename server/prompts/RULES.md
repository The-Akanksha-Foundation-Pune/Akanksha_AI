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

- **Alumni.** Any question about alumni (who they are, college and course, graduation, jobs and income
  after school, counselling, mentoring) is answered from two databases together: `akanksha_production`
  and `akanksha`. They have the same tables. Look at both every time.
  - The chat opens on `akanksha_production`; the other one is read in the same query as
    `akanksha.<table>`.
  - Most people are in both, under the same `st_id`. Never add a figure from one to the figure from the
    other: that counts the same people twice. Combine them in the query instead, so that each person or
    record is counted once (for example a `UNION` of the two tables on their key, or the
    `akanksha_production` rows plus the `akanksha` rows whose key is not in `akanksha_production`).
  - When the same person or record is in both and the two disagree, use the `akanksha_production`
    version.
  - If part of the answer exists in only one of the two, say so in one plain line, for example
    "230 of these alumni are in only one of the two sets of alumni records."
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
  - The small `raz_*` lookup tables in `AFDW` (expected levels, question labels, mapping) may be joined
    to explain these two. Never answer from `raz_assessment_data_backup_20260910`.
  - Do not answer a reading question from the general assessment tables (`full_assessment_data`,
    `student_full_assessment_data`), and never from the `raz_*` tables in `consultant_mgmt`: those
    are empty copies.
  - Almost all RAZ records are for 2026-2027. For an earlier year, check what exists and say plainly
    that RAZ reading records are missing or very few for it.
  - If the database in use is not `AFDW`, do not run a query for a RAZ or reading question. Ask the
    person to ask it again in a new chat.

- **Employees, staff and attrition.** Any question about employees or staff is answered from the
  `employees` table in the `AFDW` database. It is the staff list: one row per person, with
  department, designation, location and school, cost centre, category, reporting manager, date of
  joining, confirmation date and status. Use it for headcount, who works where, joiners, tenure,
  probation and confirmation, and reporting lines.
  - `employees` holds **no exit information**: its `relieving_date` is blank for every person and its
    status is only `Confirmed` or `On Probation`. So for leavers, exit dates and attrition, and only
    for those, also read `historical_employees` in `AFDW`. It has the same columns and holds everyone
    who has ever been on staff, with the status and relieving date of those who left. Join the two on
    `employee_code`. Never tell the person that exit dates do not exist without looking there, and
    say in one plain line that the exit dates came from the staff history, not the staff list.
  - What `employee_status` in `historical_employees` means: `Relieved`, `Absconding` and
    `Terminated` have left. `Exit Initiated` is serving notice: count the person as having left only
    once the relieving date has passed. `Not Joining` and `Pending` never joined: leave them out.
  - The dates are stored as text. `relieving_date` is written like `05-Nov-2026`: read it with
    `STR_TO_DATE(relieving_date, '%d-%b-%Y')`. `date_of_joining` and `confirmation_date` are mostly
    `2026-11-05` and sometimes `05-Nov-2026`. Convert a date before you compare, sort or take the
    earliest or latest: on the raw text those give wrong answers. A blank date is an empty string,
    not NULL.
  - Exits are recorded from December 2020. Do not report attrition for an earlier period; say it is
    not recorded.
  - "Exited but still showing as active" (in Qandle, the HR system, or the staff list) means people
    who are in `employees` while `historical_employees` shows they have left. Never use
    `qandle_users`: it holds two test rows.
  - An attrition rate is the people who left in the period divided by the average of the headcount at
    its start and its end. Always state the exact period you used.
  - Do not answer these questions from the employee tables in `tether_forms`, `Finance`,
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
