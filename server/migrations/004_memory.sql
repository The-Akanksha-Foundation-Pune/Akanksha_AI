-- Memory layers: notes about tables, per-user memory, confirmed insights, and column-level access rules.

-- Things the schema cannot say about a table ("refreshed nightly from the SIS", "rows before 2024 incomplete").
CREATE TABLE IF NOT EXISTS table_notes (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  database_name  VARCHAR(64) NOT NULL,
  table_name     VARCHAR(64) NOT NULL,
  note           TEXT NOT NULL,
  is_active      TINYINT(1) NOT NULL DEFAULT 1,
  created_by     INT UNSIGNED NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_table_note (database_name, table_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- What the assistant should remember about one person: preferences and short notes they confirmed.
CREATE TABLE IF NOT EXISTS user_memory (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     INT UNSIGNED NOT NULL,
  memory_key  VARCHAR(64) NOT NULL COMMENT 'e.g. answer_style, default_database, note',
  value       TEXT NOT NULL,
  source      ENUM('user','assistant') NOT NULL DEFAULT 'user',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_user_memory_user (user_id, memory_key),
  CONSTRAINT fk_user_memory_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Confirmed findings: a thumbs-up answer with the question, its headline and the SQL, dated.
CREATE TABLE IF NOT EXISTS insights (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  database_name  VARCHAR(64) NOT NULL,
  question       TEXT NOT NULL,
  headline       TEXT NOT NULL COMMENT 'first paragraph of the confirmed answer',
  sql_text       TEXT NULL,
  message_id     CHAR(36) NULL,
  user_id        INT UNSIGNED NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_insights_db_created (database_name, created_at),
  FULLTEXT KEY ft_insights (question, headline)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Column-level rules: hide one column of a table from a role (schema omits it; queries naming it are refused).
ALTER TABLE access_rules
  ADD COLUMN column_name VARCHAR(64) NULL COMMENT 'NULL = whole table' AFTER table_name;
ALTER TABLE access_rules DROP INDEX uq_access_rule;
ALTER TABLE access_rules ADD UNIQUE KEY uq_access_rule (role, database_name, table_name, column_name, effect);
