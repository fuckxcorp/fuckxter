ALTER TABLE s3_configs RENAME TO s3_configs_legacy;

CREATE TABLE s3_configs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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

INSERT INTO s3_configs (
  id, user_id, name, endpoint, region, bucket, access_key_id,
  secret_ciphertext, path_style, is_default, created_at, updated_at
)
SELECT
  'legacy-' || user_id,
  user_id,
  'Default',
  endpoint,
  region,
  bucket,
  access_key_id,
  secret_ciphertext,
  path_style,
  1,
  created_at,
  updated_at
FROM s3_configs_legacy;

DROP TABLE s3_configs_legacy;

CREATE UNIQUE INDEX s3_configs_one_default_ux
  ON s3_configs(user_id)
  WHERE is_default = 1;
CREATE INDEX s3_configs_user_id_idx ON s3_configs(user_id);

ALTER TABLE media_objects ADD COLUMN storage_config_id TEXT;

UPDATE media_objects
SET storage_config_id = 'legacy-' || owner_id;

CREATE INDEX media_objects_storage_config_id_idx
  ON media_objects(storage_config_id);
