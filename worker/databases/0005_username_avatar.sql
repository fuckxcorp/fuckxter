ALTER TABLE users ADD COLUMN handle_key TEXT;
ALTER TABLE users ADD COLUMN avatar_key TEXT;

UPDATE users SET handle_key = lower(handle);

CREATE UNIQUE INDEX users_handle_key_ux ON users(handle_key);
