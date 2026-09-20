-- 没配置 FUCKXTER_SECRET 时，Worker 会在这里自动存一把随机主密钥，
-- 用来加密 TOTP 密钥之类的敏感字段。
CREATE TABLE IF NOT EXISTS app_secrets (
  id TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL
);
