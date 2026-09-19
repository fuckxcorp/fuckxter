-- 推荐流已经改成按点赞量排序，这个按 view_count 建的索引不再被用到
DROP INDEX IF EXISTS posts_heat_idx;
