-- Who is online, and messages between colleagues (server/src/modules/people). Same idea as Alumni Connect.
--
-- user_presence    one row per person who has opened the app. The browser reports in every 20 seconds; a
--                  person is "online" while last_seen is recent and left_at is empty.
-- direct_messages  one row per message between two people. read_at is set when the recipient opens the
--                  conversation.
--
-- Times are UTC. Names and pictures come from the users table, so nothing about a person is copied here.

CREATE TABLE IF NOT EXISTS user_presence (
  user_id    INT UNSIGNED NOT NULL,
  last_seen  DATETIME(3)  NOT NULL,
  left_at    DATETIME(3)  NULL,
  PRIMARY KEY (user_id),
  KEY idx_presence_seen (last_seen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS direct_messages (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  sender_id     INT UNSIGNED NOT NULL,
  recipient_id  INT UNSIGNED NOT NULL,
  body          TEXT         NOT NULL,
  sent_at       DATETIME(3)  NOT NULL,
  read_at       DATETIME(3)  NULL,
  PRIMARY KEY (id),
  KEY idx_dm_pair (sender_id, recipient_id, id),
  KEY idx_dm_unread (recipient_id, read_at, sender_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
