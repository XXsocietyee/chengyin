-- 俱乐部帖隐藏来源。举报无效只恢复 hide_lane=REPORT 的行。
-- AUTHOR 覆盖作者删除，以及仍走同一条软删语句的内容安全下架。
-- 执行方式:走 chengyin-db-migrate，只读预检后确认。部署新 jar 前先落库。
-- 可重复执行:加列先查 information_schema。不回填存量行，存量已删帖保持 NULL，举报无效不会把它们捞回。

SET @club_post_hide_lane_exists := (
    SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'club_post' AND column_name = 'hide_lane');
SET @club_post_hide_lane_sql := IF(@club_post_hide_lane_exists = 0,
    'ALTER TABLE club_post ADD COLUMN hide_lane VARCHAR(16) NULL COMMENT ''AUTHOR 作者或内容安全删除，REPORT 举报下架'' AFTER del_flag',
    'SELECT 1');
PREPARE club_post_hide_lane_stmt FROM @club_post_hide_lane_sql;
EXECUTE club_post_hide_lane_stmt;
DEALLOCATE PREPARE club_post_hide_lane_stmt;

-- runner: assert=scalar-true
SELECT (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'club_post' AND column_name = 'hide_lane') = 1 AS club_post_hide_lane_ready;

-- 回退:保留列。禁止 DROP。
