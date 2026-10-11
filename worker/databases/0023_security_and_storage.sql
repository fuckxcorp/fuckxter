ALTER TABLE users ADD COLUMN pending_totp_secret TEXT;
ALTER TABLE users ADD COLUMN pending_totp_session TEXT;
ALTER TABLE users ADD COLUMN pending_totp_expires INTEGER;
ALTER TABLE s3_configs ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX rate_limits_expiry_idx ON rate_limits(expires_at);

CREATE TABLE upload_tickets (
  object_key TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
  storage_config_id TEXT NOT NULL,
  original_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX upload_tickets_expiry_idx ON upload_tickets(expires_at);

CREATE TRIGGER post_views_insert_count AFTER INSERT ON post_views BEGIN
  UPDATE posts SET view_count = view_count + 1 WHERE id = NEW.post_id;
END;
