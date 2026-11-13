-- 帖子全文索引。trigram 分词不依赖空格，中文、日文也能按子串搜。
-- 触发器只追加、不删除：按 post_id 删要扫整张索引表，注销账号时会被放大成 N×M。
-- 改过或删掉的帖子留下的旧行由查询时的 LIKE 复核挡掉，再由每天的定时任务清走。
CREATE VIRTUAL TABLE posts_fts USING fts5(
  post_id UNINDEXED,
  text,
  tokenize = 'trigram'
);

INSERT INTO posts_fts (post_id, text)
SELECT id, text FROM posts WHERE deleted_at IS NULL;

CREATE TRIGGER posts_fts_insert AFTER INSERT ON posts BEGIN
  INSERT INTO posts_fts (post_id, text) VALUES (NEW.id, NEW.text);
END;

CREATE TRIGGER posts_fts_update AFTER UPDATE OF text ON posts
WHEN OLD.text IS NOT NEW.text
BEGIN
  INSERT INTO posts_fts (post_id, text) VALUES (NEW.id, NEW.text);
END;
