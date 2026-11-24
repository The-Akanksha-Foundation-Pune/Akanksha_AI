-- Feedback can arrive before chats are stored server-side, so message_id is a plain reference for now.
ALTER TABLE feedback DROP FOREIGN KEY fk_feedback_message;

-- Keep the question and the database with each feedback row so it is useful without the messages table.
ALTER TABLE feedback
  ADD COLUMN conversation_id CHAR(36) NULL AFTER message_id,
  ADD COLUMN database_name VARCHAR(64) NULL AFTER conversation_id,
  ADD COLUMN question TEXT NULL AFTER database_name;

INSERT IGNORE INTO app_settings (setting_key, setting_value, description) VALUES
  ('learned.max_examples', '3', 'How many past question/SQL pairs to show Claude per question'),
  ('learned.auto_approve', '1', '1 = a thumbs up makes the query usable immediately; 0 = needs approval');

-- Starter glossary. Edit or delete from the app.
INSERT IGNORE INTO metric_definitions (database_name, term, definition, sql_hint) VALUES
  ('tether_forms', 'IT visit', 'One row in it_visit_submissions whose school is not a test school.', "school_name NOT LIKE 'TEST%' AND visit_date IS NOT NULL"),
  ('tether_forms', 'completed visit', 'An IT visit where the technician marked the visit as fully completed.', "visit_completed = 'Yes'"),
  ('AFDW', 'active student', 'A student whose status in active_student_data begins with Active (Enrolled, Promoted or Potential Dropout).', "status LIKE 'Active%'");
