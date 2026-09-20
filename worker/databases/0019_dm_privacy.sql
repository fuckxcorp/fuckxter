-- 私信权限：谁可以给我发私信。
-- everyone = 所有人（默认），mutual = 仅互相关注的人，nobody = 不接收私信
ALTER TABLE users ADD COLUMN dm_policy TEXT NOT NULL DEFAULT 'everyone';
