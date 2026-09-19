CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL REFERENCES users(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  actor_id TEXT REFERENCES users(id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('reply', 'like', 'repost', 'follow', 'system')),
  post_id TEXT REFERENCES posts(id) ON DELETE CASCADE,
  comment_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
  event_key TEXT NOT NULL UNIQUE,
  data_json TEXT NOT NULL DEFAULT '{}',
  read_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX notifications_recipient_created_idx
  ON notifications(recipient_id, created_at DESC, id DESC);
CREATE INDEX notifications_recipient_unread_idx
  ON notifications(recipient_id, read_at, created_at DESC);
CREATE INDEX notifications_actor_idx ON notifications(actor_id);
