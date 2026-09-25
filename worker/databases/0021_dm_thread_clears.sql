CREATE TABLE dm_thread_clears (
  thread_id TEXT NOT NULL REFERENCES dm_threads(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cleared_at TEXT NOT NULL,
  PRIMARY KEY (thread_id, user_id)
);
