CREATE TABLE _user_id_map (
  old_id TEXT PRIMARY KEY,
  new_id TEXT NOT NULL UNIQUE
);

INSERT INTO _user_id_map (old_id, new_id)
SELECT id, handle_key FROM users;

CREATE TABLE _users_new (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  name TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  bio TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  gender TEXT NOT NULL DEFAULT '',
  birthday TEXT NOT NULL DEFAULT '',
  totp_secret TEXT,
  two_factor_enabled INTEGER NOT NULL DEFAULT 0,
  avatar_media_id TEXT,
  avatar_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO _users_new (
  id, handle, email, password_hash, password_salt, name, verified,
  bio, region, gender, birthday, totp_secret, two_factor_enabled,
  avatar_media_id, avatar_key, created_at, updated_at
)
SELECT
  map.new_id, users.handle, users.email, users.password_hash,
  users.password_salt, users.name, users.verified, users.bio, users.region,
  users.gender, users.birthday, users.totp_secret, users.two_factor_enabled,
  users.avatar_media_id, users.avatar_key, users.created_at, users.updated_at
FROM users
JOIN _user_id_map map ON map.old_id = users.id;

CREATE TABLE _sessions_data AS
SELECT sessions.id, map.new_id AS user_id, sessions.token_hash,
       sessions.expires_at, sessions.created_at
FROM sessions
JOIN _user_id_map map ON map.old_id = sessions.user_id;

CREATE TABLE _posts_data AS
SELECT posts.id, posts.slug, map.new_id AS author_id, posts.text,
       posts.media_json, posts.created_at, posts.updated_at, posts.deleted_at
FROM posts
JOIN _user_id_map map ON map.old_id = posts.author_id;

CREATE TABLE _follows_data AS
SELECT follower_map.new_id AS follower_id,
       followee_map.new_id AS followee_id,
       follows.created_at
FROM follows
JOIN _user_id_map follower_map ON follower_map.old_id = follows.follower_id
JOIN _user_id_map followee_map ON followee_map.old_id = follows.followee_id;

CREATE TABLE _likes_data AS
SELECT map.new_id AS user_id, likes.post_id, likes.created_at
FROM likes
JOIN _user_id_map map ON map.old_id = likes.user_id;

CREATE TABLE _reposts_data AS
SELECT map.new_id AS user_id, reposts.post_id, reposts.created_at
FROM reposts
JOIN _user_id_map map ON map.old_id = reposts.user_id;

CREATE TABLE _bookmarks_data AS
SELECT map.new_id AS user_id, bookmarks.post_id, bookmarks.created_at
FROM bookmarks
JOIN _user_id_map map ON map.old_id = bookmarks.user_id;

CREATE TABLE _comments_data AS
SELECT comments.id, comments.post_id, map.new_id AS author_id, comments.text,
       comments.created_at, comments.deleted_at
FROM comments
JOIN _user_id_map map ON map.old_id = comments.author_id;

CREATE TABLE _recovery_codes_data AS
SELECT recovery_codes.id, map.new_id AS user_id, recovery_codes.code_hash,
       recovery_codes.used_at, recovery_codes.created_at
FROM recovery_codes
JOIN _user_id_map map ON map.old_id = recovery_codes.user_id;

CREATE TABLE _s3_configs_data AS
SELECT
  CASE
    WHEN s3_configs.id = 'legacy-' || s3_configs.user_id
      THEN 'legacy-' || map.new_id
    ELSE s3_configs.id
  END AS id,
  map.new_id AS user_id,
  s3_configs.name,
  s3_configs.endpoint,
  s3_configs.region,
  s3_configs.bucket,
  s3_configs.access_key_id,
  s3_configs.secret_ciphertext,
  s3_configs.path_style,
  s3_configs.is_default,
  s3_configs.created_at,
  s3_configs.updated_at
FROM s3_configs
JOIN _user_id_map map ON map.old_id = s3_configs.user_id;

CREATE TABLE _media_objects_data AS
SELECT
  media_objects.id,
  map.new_id AS owner_id,
  CASE
    WHEN media_objects.storage_config_id = 'legacy-' || media_objects.owner_id
      THEN 'legacy-' || map.new_id
    ELSE media_objects.storage_config_id
  END AS storage_config_id,
  media_objects.object_key,
  media_objects.original_name,
  media_objects.content_type,
  media_objects.sha256,
  media_objects.byte_size,
  media_objects.status,
  media_objects.created_at,
  media_objects.updated_at
FROM media_objects
JOIN _user_id_map map ON map.old_id = media_objects.owner_id;

DROP TABLE likes;
DROP TABLE reposts;
DROP TABLE bookmarks;
DROP TABLE comments;
DROP TABLE follows;
DROP TABLE sessions;
DROP TABLE recovery_codes;
DROP TABLE s3_configs;
DROP TABLE media_objects;
DROP TABLE posts;
DROP TABLE users;

ALTER TABLE _users_new RENAME TO users;

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE posts (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  author_id TEXT NOT NULL REFERENCES users(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  text TEXT NOT NULL,
  media_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX posts_author_id_created_at_idx
  ON posts(author_id, created_at DESC);
CREATE INDEX posts_created_at_idx ON posts(created_at DESC);
CREATE INDEX posts_feed_idx
  ON posts(deleted_at, created_at DESC, id DESC);

CREATE TABLE follows (
  follower_id TEXT NOT NULL REFERENCES users(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  followee_id TEXT NOT NULL REFERENCES users(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (follower_id, followee_id)
);

CREATE INDEX follows_followee_id_idx ON follows(followee_id);

CREATE TABLE likes (
  user_id TEXT NOT NULL REFERENCES users(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, post_id)
);

CREATE INDEX likes_post_id_idx ON likes(post_id);

CREATE TABLE reposts (
  user_id TEXT NOT NULL REFERENCES users(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, post_id)
);

CREATE INDEX reposts_post_id_idx ON reposts(post_id);

CREATE TABLE bookmarks (
  user_id TEXT NOT NULL REFERENCES users(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, post_id)
);

CREATE INDEX bookmarks_user_id_created_at_idx
  ON bookmarks(user_id, created_at DESC);

CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX comments_post_id_created_at_idx
  ON comments(post_id, created_at);
CREATE INDEX comments_post_active_idx
  ON comments(post_id, deleted_at, created_at);

CREATE TABLE recovery_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX recovery_codes_user_id_idx ON recovery_codes(user_id);
CREATE INDEX recovery_codes_user_active_idx
  ON recovery_codes(user_id, used_at);

CREATE TABLE s3_configs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  name TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  region TEXT NOT NULL,
  bucket TEXT NOT NULL,
  access_key_id TEXT NOT NULL,
  secret_ciphertext TEXT NOT NULL,
  path_style INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, name)
);

CREATE UNIQUE INDEX s3_configs_one_default_ux
  ON s3_configs(user_id)
  WHERE is_default = 1;
CREATE INDEX s3_configs_user_id_idx ON s3_configs(user_id);

CREATE TABLE media_objects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  storage_config_id TEXT,
  object_key TEXT NOT NULL,
  original_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX media_objects_owner_id_idx ON media_objects(owner_id);
CREATE INDEX media_objects_sha256_idx ON media_objects(sha256);
CREATE INDEX media_objects_storage_config_id_idx
  ON media_objects(storage_config_id);

INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
SELECT id, user_id, token_hash, expires_at, created_at
FROM _sessions_data;

INSERT INTO posts (
  id, slug, author_id, text, media_json, created_at, updated_at, deleted_at
)
SELECT posts.id, posts.slug, posts.author_id, posts.text, posts.media_json,
       posts.created_at, posts.updated_at, posts.deleted_at
FROM _posts_data posts;

INSERT INTO follows (follower_id, followee_id, created_at)
SELECT follower_id, followee_id, created_at
FROM _follows_data;

INSERT INTO likes (user_id, post_id, created_at)
SELECT user_id, post_id, created_at
FROM _likes_data;

INSERT INTO reposts (user_id, post_id, created_at)
SELECT user_id, post_id, created_at
FROM _reposts_data;

INSERT INTO bookmarks (user_id, post_id, created_at)
SELECT user_id, post_id, created_at
FROM _bookmarks_data;

INSERT INTO comments (
  id, post_id, author_id, text, created_at, deleted_at
)
SELECT id, post_id, author_id, text, created_at, deleted_at
FROM _comments_data;

INSERT INTO recovery_codes (id, user_id, code_hash, used_at, created_at)
SELECT id, user_id, code_hash, used_at, created_at
FROM _recovery_codes_data;

INSERT INTO s3_configs (
  id, user_id, name, endpoint, region, bucket, access_key_id,
  secret_ciphertext, path_style, is_default, created_at, updated_at
)
SELECT id, user_id, name, endpoint, region, bucket, access_key_id,
       secret_ciphertext, path_style, is_default, created_at, updated_at
FROM _s3_configs_data;

INSERT INTO media_objects (
  id, owner_id, storage_config_id, object_key, original_name, content_type,
  sha256, byte_size, status, created_at, updated_at
)
SELECT id, owner_id, storage_config_id, object_key, original_name,
       content_type, sha256, byte_size, status, created_at, updated_at
FROM _media_objects_data;

DROP TABLE _sessions_data;
DROP TABLE _posts_data;
DROP TABLE _follows_data;
DROP TABLE _likes_data;
DROP TABLE _reposts_data;
DROP TABLE _bookmarks_data;
DROP TABLE _comments_data;
DROP TABLE _recovery_codes_data;
DROP TABLE _s3_configs_data;
DROP TABLE _media_objects_data;
DROP TABLE _user_id_map;
