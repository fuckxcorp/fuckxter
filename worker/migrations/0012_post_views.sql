ALTER TABLE posts ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS post_views (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  viewer_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (post_id, viewer_key)
);

CREATE INDEX IF NOT EXISTS post_views_post_id_idx ON post_views(post_id);

CREATE INDEX IF NOT EXISTS posts_heat_idx
  ON posts(deleted_at, view_count DESC, created_at DESC, id DESC);
