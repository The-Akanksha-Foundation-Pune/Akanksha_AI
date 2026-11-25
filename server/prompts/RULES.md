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
