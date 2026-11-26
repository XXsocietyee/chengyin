-- 2026-11-22 FE 商家参与 P0-2:一个位置(章节)可承接多个一级商家品类。
-- cms_topic_chapter 增一列:
--   allowed_category_ids  逗号分隔的一级商家品类 id,category_id 始终排第一,如 '18,21'
-- 存量行回填口径:列为 NULL = 只认原来的 category_id(单品类),读侧按此解释,不改写任何存量数据。
-- 申请校验、可见性过滤、邀请候选、入驻校验都读 category_id + 本列的并集。
-- 只新增可空列,可重复执行;表不存在时跳过(局部建表的测试库只叠它需要的表)。
-- 回滚:DROP 这一列即可,旧代码不读它。生产执行须先只读预检并取得用户确认;本文件不连接生产数据库。

SET @ddl = IF((SELECT COUNT(*) FROM information_schema.tables
               WHERE table_schema = DATABASE() AND table_name = 'cms_topic_chapter') = 1
           AND (SELECT COUNT(*) FROM information_schema.columns
               WHERE table_schema = DATABASE() AND table_name = 'cms_topic_chapter' AND column_name = 'allowed_category_ids') = 0,
    'ALTER TABLE cms_topic_chapter ADD COLUMN allowed_category_ids VARCHAR(255) NULL COMMENT ''可承接的一级商家品类id,逗号分隔,category_id在首位;NULL=只认category_id''',
    'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
