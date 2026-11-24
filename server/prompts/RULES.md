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
