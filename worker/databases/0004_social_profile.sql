ALTER TABLE users ADD COLUMN avatar_media_id TEXT;

CREATE INDEX follows_followee_id_idx ON follows(followee_id);
CREATE INDEX posts_feed_idx
  ON posts(deleted_at, created_at DESC, id DESC);
CREATE INDEX comments_post_active_idx
  ON comments(post_id, deleted_at, created_at);
CREATE INDEX recovery_codes_user_active_idx
  ON recovery_codes(user_id, used_at);
