CREATE TABLE dm_threads (
  id TEXT PRIMARY KEY,
  user_low_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_high_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  last_message_at TEXT NOT NULL,
  UNIQUE (user_low_id, user_high_id)
);

CREATE INDEX dm_threads_low_idx
  ON dm_threads(user_low_id, last_message_at DESC);
CREATE INDEX dm_threads_high_idx
  ON dm_threads(user_high_id, last_message_at DESC);

CREATE TABLE dm_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES dm_threads(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at TEXT
);

CREATE INDEX dm_messages_thread_idx
  ON dm_messages(thread_id, created_at, id);
CREATE INDEX dm_messages_unread_idx
  ON dm_messages(thread_id, read_at);
