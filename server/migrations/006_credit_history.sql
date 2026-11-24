-- History of credit changes: the role amount on first use, and every top-up or deduction by a super admin.
-- users.credit_usd stays the running total; this table records how it got there.
CREATE TABLE IF NOT EXISTS credit_grants (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     INT UNSIGNED NOT NULL,
  amount_usd  DECIMAL(10,4) NOT NULL COMMENT 'Positive adds credit, negative takes it away',
  kind        VARCHAR(20) NOT NULL COMMENT 'initial | topup | opening',
  granted_by  INT UNSIGNED NULL COMMENT 'users.id of the super admin; NULL for the automatic first grant',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_credit_grants_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- People who got credit before this table existed: one 'opening' row with the total they had been granted.
INSERT INTO credit_grants (user_id, amount_usd, kind, created_at)
SELECT id, credit_usd, 'opening', credit_started_at FROM users WHERE credit_started_at IS NOT NULL;
