-- Akanksha AI application schema. Lives in its own database (AI_DB_NAME), never in the data databases.
-- Run with: npm run migrate --prefix server

CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email         VARCHAR(255) NOT NULL,
  name          VARCHAR(255) NULL,
  role          ENUM('admin','analyst','viewer') NOT NULL DEFAULT 'analyst',
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at  DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS conversations (
  id             CHAR(36) NOT NULL,
  user_id        INT UNSIGNED NULL,
  title          VARCHAR(255) NOT NULL DEFAULT 'New chat',
  database_name  VARCHAR(64) NOT NULL,
  model          VARCHAR(64) NULL,
  is_archived    TINYINT(1) NOT NULL DEFAULT 0,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_conversations_user (user_id, updated_at),
  KEY ix_conversations_db (database_name),
  CONSTRAINT fk_conversations_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS messages (
  id               CHAR(36) NOT NULL,
  conversation_id  CHAR(36) NOT NULL,
  role             ENUM('user','assistant','system') NOT NULL,
  content          MEDIUMTEXT NOT NULL,
  status           ENUM('complete','streaming','stopped','error') NOT NULL DEFAULT 'complete',
  error            TEXT NULL,
  focus_tables     JSON NULL,
  created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_messages_conversation (conversation_id, created_at),
  CONSTRAINT fk_messages_conversation FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- One row per call to the Claude API (an assistant reply with tool use makes several).
CREATE TABLE IF NOT EXISTS api_requests (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  message_id             CHAR(36) NULL,
  conversation_id        CHAR(36) NULL,
  user_id                INT UNSIGNED NULL,
  database_name          VARCHAR(64) NULL,
  model                  VARCHAR(64) NOT NULL,
  effort                 VARCHAR(16) NULL,
  round_no               TINYINT UNSIGNED NOT NULL DEFAULT 1,
  stop_reason            VARCHAR(32) NULL,
  input_tokens           INT UNSIGNED NOT NULL DEFAULT 0,
  cache_read_tokens      INT UNSIGNED NOT NULL DEFAULT 0,
  cache_write_tokens     INT UNSIGNED NOT NULL DEFAULT 0,
  output_tokens          INT UNSIGNED NOT NULL DEFAULT 0,
  thinking_tokens        INT UNSIGNED NOT NULL DEFAULT 0,
  cost_usd               DECIMAL(10,6) NOT NULL DEFAULT 0,
  latency_ms             INT UNSIGNED NULL,
  error                  TEXT NULL,
  created_at             DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_api_requests_created (created_at),
  KEY ix_api_requests_user (user_id, created_at),
  KEY ix_api_requests_message (message_id),
  KEY ix_api_requests_model (model, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Every SQL statement Claude ran through run_sql.
CREATE TABLE IF NOT EXISTS sql_runs (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  message_id       CHAR(36) NULL,
  conversation_id  CHAR(36) NULL,
  user_id          INT UNSIGNED NULL,
  database_name    VARCHAR(64) NOT NULL,
  sql_text         TEXT NOT NULL,
  tables_used      JSON NULL,
  row_count        INT UNSIGNED NULL,
  truncated        TINYINT(1) NOT NULL DEFAULT 0,
  duration_ms      INT UNSIGNED NULL,
  error            TEXT NULL,
  created_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_sql_runs_message (message_id),
  KEY ix_sql_runs_db_created (database_name, created_at),
  KEY ix_sql_runs_error (error(1), created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Thumbs up / down on an answer.
CREATE TABLE IF NOT EXISTS feedback (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  message_id  CHAR(36) NOT NULL,
  user_id     INT UNSIGNED NULL,
  rating      TINYINT NOT NULL COMMENT '1 = up, -1 = down',
  comment     TEXT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_feedback_message_user (message_id, user_id),
  CONSTRAINT fk_feedback_message FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Question -> SQL pairs that worked, injected into future prompts as examples.
CREATE TABLE IF NOT EXISTS learned_queries (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  database_name      VARCHAR(64) NOT NULL,
  question           TEXT NOT NULL,
  sql_text           TEXT NOT NULL,
  tables_used        JSON NULL,
  source_message_id  CHAR(36) NULL,
  created_by         INT UNSIGNED NULL,
  status             ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  use_count          INT UNSIGNED NOT NULL DEFAULT 0,
  last_used_at       DATETIME NULL,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_learned_db_status (database_name, status),
  FULLTEXT KEY ft_learned_question (question)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Shared vocabulary: what a term means and how to compute it.
CREATE TABLE IF NOT EXISTS metric_definitions (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  database_name  VARCHAR(64) NULL COMMENT 'NULL = applies to every database',
  term           VARCHAR(120) NOT NULL,
  definition     TEXT NOT NULL,
  sql_hint       TEXT NULL,
  is_active      TINYINT(1) NOT NULL DEFAULT 1,
  created_by     INT UNSIGNED NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_metric_term (database_name, term)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Price list used to compute cost_usd. One row per model and effective date.
CREATE TABLE IF NOT EXISTS model_pricing (
  id                     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  model                  VARCHAR(64) NOT NULL,
  input_per_mtok         DECIMAL(8,4) NOT NULL,
  cache_read_per_mtok    DECIMAL(8,4) NOT NULL,
  cache_write_per_mtok   DECIMAL(8,4) NOT NULL,
  output_per_mtok        DECIMAL(8,4) NOT NULL,
  effective_from         DATE NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pricing_model_date (model, effective_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- A saved question that can be re-run on a schedule and emailed.
CREATE TABLE IF NOT EXISTS saved_reports (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id        INT UNSIGNED NULL,
  name           VARCHAR(255) NOT NULL,
  question       TEXT NOT NULL,
  database_name  VARCHAR(64) NOT NULL,
  focus_tables   JSON NULL,
  schedule_cron  VARCHAR(64) NULL COMMENT 'NULL = run manually only',
  timezone       VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
  recipients     JSON NULL,
  format         ENUM('docx','markdown') NOT NULL DEFAULT 'docx',
  is_active      TINYINT(1) NOT NULL DEFAULT 1,
  last_run_at    DATETIME NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_saved_reports_active (is_active, schedule_cron)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS report_runs (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  saved_report_id  INT UNSIGNED NOT NULL,
  conversation_id  CHAR(36) NULL,
  status           ENUM('running','sent','failed') NOT NULL DEFAULT 'running',
  started_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at      DATETIME NULL,
  error            TEXT NULL,
  PRIMARY KEY (id),
  KEY ix_report_runs_report (saved_report_id, started_at),
  CONSTRAINT fk_report_runs_report FOREIGN KEY (saved_report_id) REFERENCES saved_reports (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Which databases and tables each role may see. No rows for a role = everything visible.
CREATE TABLE IF NOT EXISTS access_rules (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  role           ENUM('admin','analyst','viewer') NOT NULL,
  database_name  VARCHAR(64) NOT NULL,
  table_name     VARCHAR(64) NULL COMMENT 'NULL = whole database',
  effect         ENUM('allow','deny') NOT NULL DEFAULT 'allow',
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_access_rule (role, database_name, table_name, effect)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- App-wide key/value settings (default model, effort, limits) editable without a restart.
CREATE TABLE IF NOT EXISTS app_settings (
  setting_key    VARCHAR(64) NOT NULL,
  setting_value  TEXT NULL,
  description    VARCHAR(255) NULL,
  updated_by     INT UNSIGNED NULL,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS schema_migrations (
  name        VARCHAR(120) NOT NULL,
  applied_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Daily token and cost roll-up for the usage dashboard.
CREATE OR REPLACE VIEW v_daily_usage AS
SELECT DATE(created_at)                     AS day,
       model,
       COUNT(*)                             AS requests,
       COUNT(DISTINCT conversation_id)      AS conversations,
       SUM(input_tokens)                    AS input_tokens,
       SUM(cache_read_tokens)               AS cache_read_tokens,
       SUM(cache_write_tokens)              AS cache_write_tokens,
       SUM(output_tokens)                   AS output_tokens,
       SUM(thinking_tokens)                 AS thinking_tokens,
       ROUND(SUM(cost_usd), 4)              AS cost_usd,
       ROUND(AVG(latency_ms))               AS avg_latency_ms
FROM api_requests
GROUP BY DATE(created_at), model;

-- Seed: current Anthropic list prices (USD per million tokens).
INSERT IGNORE INTO model_pricing (model, input_per_mtok, cache_read_per_mtok, cache_write_per_mtok, output_per_mtok, effective_from) VALUES
  ('claude-opus-5-5',   4.00, 0.20, 5.00,  20.00, '2026-01-01'),
  ('claude-sonnet-5-5', 2.00, 0.20, 2.50,  10.00, '2026-01-01'),
  ('claude-haiku-5-5',  0.10, 0.01, 0.125,  0.50, '2026-01-01'),
  ('claude-fable-5-1', 10.00, 0.25, 12.50, 50.00, '2026-01-01');

INSERT IGNORE INTO app_settings (setting_key, setting_value, description) VALUES
  ('default_model',        'claude-opus-5-5', 'Model used when a request does not name one'),
  ('default_effort',       'medium',          'Thinking effort: low, medium, high, xhigh, max'),
  ('max_tool_rounds',      '8',               'How many SQL queries Claude may run for one answer'),
  ('max_rows_per_query',   '200',             'Rows returned to Claude from run_sql'),
  ('history_turns',        '10',              'How many past turns are sent with each question');
