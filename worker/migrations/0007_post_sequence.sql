CREATE TABLE post_sequence (
  id INTEGER PRIMARY KEY AUTOINCREMENT
);

INSERT INTO post_sequence DEFAULT VALUES;
INSERT INTO post_sequence DEFAULT VALUES;
INSERT INTO post_sequence DEFAULT VALUES;
INSERT INTO post_sequence DEFAULT VALUES;
INSERT INTO post_sequence DEFAULT VALUES;
INSERT INTO post_sequence DEFAULT VALUES;
INSERT INTO post_sequence DEFAULT VALUES;
INSERT INTO post_sequence DEFAULT VALUES;
INSERT INTO post_sequence DEFAULT VALUES;
INSERT INTO post_sequence DEFAULT VALUES;
INSERT INTO post_sequence DEFAULT VALUES;

CREATE TABLE _post_id_map (
  old_id TEXT PRIMARY KEY,
  new_id TEXT NOT NULL UNIQUE
);

INSERT INTO _post_id_map (old_id, new_id) VALUES
  ('1789302834-356fbb', '20260913123354-1'),
  ('1789304297-b68210', '20260913125817-2'),
  ('1789305413-6d7f06', '20260913131653-3'),
  ('1789309868-ee869e', '20260913143108-4'),
  ('1789311690-bf79ab', '20260913150130-5'),
  ('1789312775-c772c4', '20260913151935-6'),
  ('1789313073-bbe6e4', '20260913152433-7'),
  ('1789313092-f42bba', '20260913152452-8'),
  ('1789318680-70c36c', '20260913165800-9'),
  ('1789319345-eb6591', '20260913170905-10'),
  ('1789319708-d89c3a', '20260913171508-11');

INSERT INTO posts (
  id, slug, author_id, text, media_json,
  created_at, updated_at, deleted_at
)
SELECT
  map.new_id,
  map.new_id,
  posts.author_id,
  posts.text,
  posts.media_json,
  posts.created_at,
  posts.updated_at,
  posts.deleted_at
FROM posts
JOIN _post_id_map map ON map.old_id = posts.id;

UPDATE likes
SET post_id = (SELECT new_id FROM _post_id_map WHERE old_id = likes.post_id)
WHERE post_id IN (SELECT old_id FROM _post_id_map);

UPDATE reposts
SET post_id = (SELECT new_id FROM _post_id_map WHERE old_id = reposts.post_id)
WHERE post_id IN (SELECT old_id FROM _post_id_map);

UPDATE bookmarks
SET post_id = (
  SELECT new_id FROM _post_id_map WHERE old_id = bookmarks.post_id
)
WHERE post_id IN (SELECT old_id FROM _post_id_map);

UPDATE comments
SET post_id = (
  SELECT new_id FROM _post_id_map WHERE old_id = comments.post_id
)
WHERE post_id IN (SELECT old_id FROM _post_id_map);

DELETE FROM posts
WHERE id IN (SELECT old_id FROM _post_id_map);

DROP TABLE _post_id_map;
