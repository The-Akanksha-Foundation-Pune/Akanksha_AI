-- Prepaid credits. credit_usd is the total granted to a person so far (role amount on first use + top-ups);
-- the balance is credit_usd minus that person's api_requests.cost_usd since credit_started_at.
ALTER TABLE users
  ADD COLUMN credit_usd        DECIMAL(10,4) NULL COMMENT 'Total dollars granted; NULL = nothing granted yet',
  ADD COLUMN credit_started_at DATETIME      NULL COMMENT 'Spend is counted from this moment';
