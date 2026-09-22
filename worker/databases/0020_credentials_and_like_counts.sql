-- Authentication remains bound to the original identity when a handle changes.
ALTER TABLE users ADD COLUMN credential_id TEXT;
UPDATE users SET credential_id = id;
CREATE UNIQUE INDEX users_credential_id_idx ON users(credential_id);

ALTER TABLE posts ADD COLUMN like_count INTEGER NOT NULL DEFAULT 0;
UPDATE posts SET like_count = (SELECT COUNT(*) FROM likes WHERE likes.post_id = posts.id);
CREATE INDEX posts_likes_feed_idx ON posts(deleted_at, like_count DESC, created_at DESC, id DESC);

CREATE TRIGGER likes_insert_count AFTER INSERT ON likes BEGIN
  UPDATE posts SET like_count = like_count + 1 WHERE id = NEW.post_id;
END;
CREATE TRIGGER likes_delete_count AFTER DELETE ON likes BEGIN
  UPDATE posts SET like_count = like_count - 1 WHERE id = OLD.post_id;
END;
