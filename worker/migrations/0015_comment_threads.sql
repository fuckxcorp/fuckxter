ALTER TABLE comments ADD COLUMN parent_id TEXT REFERENCES comments(id)
  ON DELETE SET NULL;

CREATE INDEX comments_parent_idx ON comments(parent_id);
