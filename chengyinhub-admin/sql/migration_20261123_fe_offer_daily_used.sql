-- 2026-11-23 自由探索门店权益：每日名额与开始日期在核销时生效（业主 2026-11-22）。
-- merchant_chapter_offer 增两列，记「这一天已核销几份」：
--   daily_used_date  daily_used 所属的日期（Asia/Shanghai 的自然日）；NULL = 还没核销过
--   daily_used       该日期当天已成功核销的份数；日期不是今天时按 0 读，下一次核销时重置为 1
-- 核销事务先锁这一行供给（SELECT ... FOR UPDATE），再比对 daily_capacity 并累加，
-- 与核销流水同一事务提交 / 回滚；撤销当天的核销时同事务减 1。
-- daily_capacity / valid_start 两列由 migration_20261122_fe_offer_shop_terms 增加，本文件不改它们。
-- 只新增可空 / 带默认值的列，可重复执行；表不存在时跳过。不涉及任何资金表。
-- 回滚：DROP 这两列即可（旧代码不读它们）。生产执行须先只读预检并取得用户确认；本文件不连接生产数据库。

SET @ddl = IF((SELECT COUNT(*) FROM information_schema.tables
               WHERE table_schema = DATABASE() AND table_name = 'merchant_chapter_offer') = 1
           AND (SELECT COUNT(*) FROM information_schema.columns
               WHERE table_schema = DATABASE() AND table_name = 'merchant_chapter_offer' AND column_name = 'daily_used_date') = 0,
    'ALTER TABLE merchant_chapter_offer ADD COLUMN daily_used_date DATE NULL COMMENT ''daily_used 所属日期(Asia/Shanghai) NULL未核销过''',
    'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = IF((SELECT COUNT(*) FROM information_schema.tables
               WHERE table_schema = DATABASE() AND table_name = 'merchant_chapter_offer') = 1
           AND (SELECT COUNT(*) FROM information_schema.columns
               WHERE table_schema = DATABASE() AND table_name = 'merchant_chapter_offer' AND column_name = 'daily_used') = 0,
    'ALTER TABLE merchant_chapter_offer ADD COLUMN daily_used INT NOT NULL DEFAULT 0 COMMENT ''daily_used_date 当天已成功核销份数''',
    'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
