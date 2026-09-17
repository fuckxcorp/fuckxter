ALTER TABLE posts ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public';

CREATE INDEX posts_author_visibility_idx
  ON posts(author_id, visibility, created_at DESC);

CREATE TABLE blocks (
  blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE INDEX blocks_blocked_id_idx ON blocks(blocked_id);
