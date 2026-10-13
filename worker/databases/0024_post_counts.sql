ALTER TABLE posts ADD COLUMN reply_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE posts ADD COLUMN repost_count INTEGER NOT NULL DEFAULT 0;

UPDATE posts
SET reply_count = (
  SELECT COUNT(*) FROM comments
  WHERE comments.post_id = posts.id AND comments.deleted_at IS NULL
);

UPDATE posts
SET repost_count = (
  SELECT COUNT(*) FROM reposts WHERE reposts.post_id = posts.id
);

CREATE TRIGGER comments_insert_count
AFTER INSERT ON comments
WHEN NEW.deleted_at IS NULL
BEGIN
  UPDATE posts SET reply_count = reply_count + 1 WHERE id = NEW.post_id;
END;

CREATE TRIGGER comments_delete_count
AFTER DELETE ON comments
WHEN OLD.deleted_at IS NULL
BEGIN
  UPDATE posts SET reply_count = MAX(reply_count - 1, 0) WHERE id = OLD.post_id;
END;

CREATE TRIGGER comments_hide_count
AFTER UPDATE OF deleted_at ON comments
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
BEGIN
  UPDATE posts SET reply_count = MAX(reply_count - 1, 0) WHERE id = NEW.post_id;
END;

CREATE TRIGGER comments_restore_count
AFTER UPDATE OF deleted_at ON comments
WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL
BEGIN
  UPDATE posts SET reply_count = reply_count + 1 WHERE id = NEW.post_id;
END;

CREATE TRIGGER reposts_insert_count AFTER INSERT ON reposts BEGIN
  UPDATE posts SET repost_count = repost_count + 1 WHERE id = NEW.post_id;
END;

CREATE TRIGGER reposts_delete_count AFTER DELETE ON reposts BEGIN
  UPDATE posts SET repost_count = MAX(repost_count - 1, 0) WHERE id = OLD.post_id;
END;
