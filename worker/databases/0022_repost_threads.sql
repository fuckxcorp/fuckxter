ALTER TABLE posts ADD COLUMN source_post_id TEXT REFERENCES posts(id) ON DELETE SET NULL;
ALTER TABLE posts ADD COLUMN repost_kind TEXT;
ALTER TABLE reposts ADD COLUMN thread_post_id TEXT REFERENCES posts(id) ON DELETE SET NULL;
CREATE INDEX posts_source_post_id_idx ON posts(source_post_id);
CREATE UNIQUE INDEX reposts_thread_post_id_idx ON reposts(thread_post_id);

CREATE TABLE _repost_threads AS
SELECT r.user_id, r.post_id, r.created_at, lower(hex(randomblob(16))) AS thread_id, p.text, p.media_json
FROM reposts r
JOIN posts p ON p.id = r.post_id AND p.deleted_at IS NULL AND p.visibility = 'public'
JOIN users a ON a.id = p.author_id AND a.deleted_at IS NULL
JOIN users u ON u.id = r.user_id AND u.deleted_at IS NULL;
INSERT INTO posts (id, slug, author_id, text, media_json, visibility, created_at, updated_at, source_post_id, repost_kind)
SELECT thread_id, thread_id, user_id, text, media_json, 'public', created_at, created_at, post_id, 'repost'
FROM _repost_threads;
UPDATE reposts SET thread_post_id = (
  SELECT thread_id FROM _repost_threads t WHERE t.user_id = reposts.user_id AND t.post_id = reposts.post_id
);
DROP TABLE _repost_threads;
