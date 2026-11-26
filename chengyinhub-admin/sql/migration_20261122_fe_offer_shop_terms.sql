-- 2026-11-22 自由探索商家参与缺口(P1-2 / P1-3 / P1-7 / 门店照片)。
-- merchant_chapter_offer 增七列:
--   daily_capacity      每日可接待份数(只做玩家可见展示,不参与容量 / 核销判定)
--   valid_start         权益开始日期(只做展示)
--   sold_out_rule_text  售罄或替代规则说明(只做展示)
--   storefront_img      门店照片;作为该位置的玩家卡图,缺省回落主题封面
--   terms_agreed_at     承接方提交权益前勾选同意条款(与主办方线下结算 / 核销规则 / 退出规则)的时间
--   sale_paused         承接方暂停新售:1 = 该供给剩余份数不再计入可售容量;已售票照常核销
--   removed_by          主办方移除该供给的操作人 member_id(status=0 + withdraw_reason 仍是退出事实的真源)
-- 店铺与主办方线下结算;本文件不涉及任何资金表。
-- 只新增可空 / 带默认值的列,可重复执行;表不存在时跳过(局部建表的测试库只叠它需要的表)。
-- 回滚:DROP 这七列即可,旧代码不读它们。生产执行须先只读预检并取得用户确认;本文件不连接生产数据库。

SET @ddl = IF((SELECT COUNT(*) FROM information_schema.tables
               WHERE table_schema = DATABASE() AND table_name = 'merchant_chapter_offer') = 1
           AND (SELECT COUNT(*) FROM information_schema.columns
               WHERE table_schema = DATABASE() AND table_name = 'merchant_chapter_offer' AND column_name = 'daily_capacity') = 0,
    'ALTER TABLE merchant_chapter_offer ADD COLUMN daily_capacity INT NULL COMMENT ''每日可接待份数(玩家可见展示) NULL未声明''',
    'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = IF((SELECT COUNT(*) FROM information_schema.tables
               WHERE table_schema = DATABASE() AND table_name = 'merchant_chapter_offer') = 1
           AND (SELECT COUNT(*) FROM information_schema.columns
               WHERE table_schema = DATABASE() AND table_name = 'merchant_chapter_offer' AND column_name = 'valid_start') = 0,
    'ALTER TABLE merchant_chapter_offer ADD COLUMN valid_start DATE NULL COMMENT ''权益开始日期(玩家可见展示) NULL=即日起''',
    'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = IF((SELECT COUNT(*) FROM information_schema.tables
               WHERE table_schema = DATABASE() AND table_name = 'merchant_chapter_offer') = 1
           AND (SELECT COUNT(*) FROM information_schema.columns
               WHERE table_schema = DATABASE() AND table_name = 'merchant_chapter_offer' AND column_name = 'sold_out_rule_text') = 0,
    'ALTER TABLE merchant_chapter_offer ADD COLUMN sold_out_rule_text VARCHAR(100) NULL COMMENT ''售罄或替代规则说明''',
    'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = IF((SELECT COUNT(*) FROM information_schema.tables
               WHERE table_schema = DATABASE() AND table_name = 'merchant_chapter_offer') = 1
           AND (SELECT COUNT(*) FROM information_schema.columns
               WHERE table_schema = DATABASE() AND table_name = 'merchant_chapter_offer' AND column_name = 'storefront_img') = 0,
    'ALTER TABLE merchant_chapter_offer ADD COLUMN storefront_img VARCHAR(500) NULL COMMENT ''门店照片，作为该位置的玩家卡图''',
    'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = IF((SELECT COUNT(*) FROM information_schema.tables
               WHERE table_schema = DATABASE() AND table_name = 'merchant_chapter_offer') = 1
           AND (SELECT COUNT(*) FROM information_schema.columns
               WHERE table_schema = DATABASE() AND table_name = 'merchant_chapter_offer' AND column_name = 'terms_agreed_at') = 0,
    'ALTER TABLE merchant_chapter_offer ADD COLUMN terms_agreed_at DATETIME NULL COMMENT ''承接方勾选同意条款的时间''',
    'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = IF((SELECT COUNT(*) FROM information_schema.tables
               WHERE table_schema = DATABASE() AND table_name = 'merchant_chapter_offer') = 1
           AND (SELECT COUNT(*) FROM information_schema.columns
               WHERE table_schema = DATABASE() AND table_name = 'merchant_chapter_offer' AND column_name = 'sale_paused') = 0,
    'ALTER TABLE merchant_chapter_offer ADD COLUMN sale_paused TINYINT NOT NULL DEFAULT 0 COMMENT ''承接方暂停新售 1暂停 0正常；不影响已售票核销''',
    'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @ddl = IF((SELECT COUNT(*) FROM information_schema.tables
               WHERE table_schema = DATABASE() AND table_name = 'merchant_chapter_offer') = 1
           AND (SELECT COUNT(*) FROM information_schema.columns
               WHERE table_schema = DATABASE() AND table_name = 'merchant_chapter_offer' AND column_name = 'removed_by') = 0,
    'ALTER TABLE merchant_chapter_offer ADD COLUMN removed_by BIGINT NULL COMMENT ''主办方移除该供给时的操作人 member_id；商家自行退出为 NULL''',
    'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
