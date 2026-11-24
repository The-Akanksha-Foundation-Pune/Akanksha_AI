-- Per-user prompt limits. NULL means "use the role's limit".
ALTER TABLE users
  ADD COLUMN quota_per_day  INT UNSIGNED NULL COMMENT 'NULL = role default, 0 = unlimited' AFTER role,
  ADD COLUMN quota_per_hour INT UNSIGNED NULL COMMENT 'NULL = role default, 0 = unlimited' AFTER quota_per_day;
