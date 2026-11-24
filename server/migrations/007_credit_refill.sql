-- Monthly credit refill (setting credits.monthly_refill): when a person was last refilled, so a month is refilled once.
ALTER TABLE users
  ADD COLUMN credit_refilled_at DATETIME NULL COMMENT 'Last monthly refill check; NULL = never, credit_started_at is used instead';
