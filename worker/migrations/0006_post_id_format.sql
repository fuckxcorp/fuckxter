CREATE TABLE _post_id_map (
  old_id TEXT PRIMARY KEY,
  new_id TEXT NOT NULL UNIQUE
);

INSERT INTO _post_id_map (old_id, new_id) VALUES
  ('5b79e05b-573e-4bcc-a8e1-65e6052bcb5c', '1789302834-356fbb'),
  ('d894fce1-24a7-463c-982f-d1ce2a8f608a', '1789304297-b68210'),
  ('2853f393-7cbc-4f7c-9901-4d3f2443a9f4', '1789305413-6d7f06'),
  ('3721aad4-69fc-40cb-8b37-03fd29dc5e1a', '1789309868-ee869e'),
  ('b9191a05-0d30-4302-867a-3df15fe94a6c', '1789311690-bf79ab'),
  ('09ac70f3-fe3d-40ca-96ca-c7117fbb396e', '1789312775-c772c4'),
  ('bf64ec82-3a91-4742-a896-a2fe2858ad4b', '1789313073-bbe6e4'),
  ('3a06382a-b9c1-4bf1-aa6f-b2f2a04ba7b4', '1789313092-f42bba'),
  ('f60b781f-5c88-4a50-bc12-443234064ee7', '1789318680-70c36c'),
  ('e055d904-c845-4fce-8cd2-c5c8bd2f7fc5', '1789319345-eb6591'),
  ('9a31082d-79c9-4ffa-9573-e44dbf08819a', '1789319708-d89c3a');

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
