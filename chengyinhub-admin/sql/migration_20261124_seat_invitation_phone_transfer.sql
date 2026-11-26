-- DEC-F12 B(2026-11-24 业主拍板):已付多人票的空闲席位可「按手机号转赠」给同伴。
-- 执行方式:走 chengyin-db-migrate,只读预检后确认。部署新 jar 前先落库(新 jar 读写这三列)。
-- 语义:复用 cms_registration_seat_invitation(同一席位唯一键、领取 CAS、撤销/过期/释放/退款口径全不变),
--       只给「按手机号转赠」的那一行补收件人事实:
--   recipient_name          购票人填写的同伴称呼(只回给购票人本人);
--   recipient_phone_hash    规范化大陆手机号的 HMAC-SHA256(服务端密钥),用于与领取人「已验证手机号」精确匹配;明文永不落库;
--   recipient_phone_masked  138****0000,只用于给购票人展示。
--   分享链接邀请行三列均为 NULL。不回填、不改存量行。
-- 可重复执行:加列/加索引先查 information_schema;表形状不对就失败关闭。

-- 预检:原表必须存在且带本迁移依赖的列(registration_id/seat_no/status/expires_at)。
-- runner: assert=scalar-true
SELECT (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema=DATABASE() AND table_name='cms_registration_seat_invitation'
        AND column_name IN ('registration_id','seat_no','status','expires_at','owner_member_id'))=5 AS seat_invitation_phone_precheck;
SET @sipt_base_ok := (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema=DATABASE() AND table_name='cms_registration_seat_invitation'
        AND column_name IN ('registration_id','seat_no','status','expires_at','owner_member_id'))=5;
SET @sipt_guard_sql := IF(@sipt_base_ok, 'SELECT 1', 'SELECT * FROM information_schema.__seat_invitation_phone_precheck_failed__');
PREPARE sipt_guard FROM @sipt_guard_sql;
EXECUTE sipt_guard;
DEALLOCATE PREPARE sipt_guard;

-- 已存在的同名列若形状不对,同样失败关闭(不静默沿用坏列)。
SET @sipt_shape_bad := (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema=DATABASE() AND table_name='cms_registration_seat_invitation'
        AND ((column_name='recipient_name' AND NOT (column_type='varchar(32)' AND is_nullable='YES'))
          OR (column_name='recipient_phone_hash' AND NOT (column_type='char(64)' AND is_nullable='YES'))
          OR (column_name='recipient_phone_masked' AND NOT (column_type='varchar(16)' AND is_nullable='YES'))));
SET @sipt_shape_sql := IF(@sipt_shape_bad=0, 'SELECT 1', 'SELECT * FROM information_schema.__seat_invitation_phone_shape_failed__');
PREPARE sipt_shape FROM @sipt_shape_sql;
EXECUTE sipt_shape;
DEALLOCATE PREPARE sipt_shape;

SET @sipt_name_exists := (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema=DATABASE() AND table_name='cms_registration_seat_invitation' AND column_name='recipient_name');
SET @sipt_name_sql := IF(@sipt_name_exists=0,
    'ALTER TABLE cms_registration_seat_invitation ADD COLUMN recipient_name VARCHAR(32) NULL COMMENT ''按手机号转赠:购票人填写的同伴称呼;只回购票人'' AFTER claimed_at',
    'SELECT 1');
PREPARE sipt_name_stmt FROM @sipt_name_sql;
EXECUTE sipt_name_stmt;
DEALLOCATE PREPARE sipt_name_stmt;

SET @sipt_hash_exists := (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema=DATABASE() AND table_name='cms_registration_seat_invitation' AND column_name='recipient_phone_hash');
SET @sipt_hash_sql := IF(@sipt_hash_exists=0,
    'ALTER TABLE cms_registration_seat_invitation ADD COLUMN recipient_phone_hash CHAR(64) NULL COMMENT ''按手机号转赠:规范化手机号 HMAC-SHA256;明文不落库'' AFTER recipient_name',
    'SELECT 1');
PREPARE sipt_hash_stmt FROM @sipt_hash_sql;
EXECUTE sipt_hash_stmt;
DEALLOCATE PREPARE sipt_hash_stmt;

SET @sipt_mask_exists := (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema=DATABASE() AND table_name='cms_registration_seat_invitation' AND column_name='recipient_phone_masked');
SET @sipt_mask_sql := IF(@sipt_mask_exists=0,
    'ALTER TABLE cms_registration_seat_invitation ADD COLUMN recipient_phone_masked VARCHAR(16) NULL COMMENT ''按手机号转赠:脱敏号 138****0000,只回购票人'' AFTER recipient_phone_hash',
    'SELECT 1');
PREPARE sipt_mask_stmt FROM @sipt_mask_sql;
EXECUTE sipt_mask_stmt;
DEALLOCATE PREPARE sipt_mask_stmt;

SET @sipt_idx_exists := (SELECT COUNT(*) FROM information_schema.statistics
      WHERE table_schema=DATABASE() AND table_name='cms_registration_seat_invitation' AND index_name='idx_seat_invitation_phone');
SET @sipt_idx_sql := IF(@sipt_idx_exists=0,
    'ALTER TABLE cms_registration_seat_invitation ADD KEY idx_seat_invitation_phone (recipient_phone_hash, status)',
    'SELECT 1');
PREPARE sipt_idx_stmt FROM @sipt_idx_sql;
EXECUTE sipt_idx_stmt;
DEALLOCATE PREPARE sipt_idx_stmt;

-- 回读断言:三列形状 + 索引齐全。
-- runner: assert=scalar-true
SELECT (SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema=DATABASE() AND table_name='cms_registration_seat_invitation'
        AND ((column_name='recipient_name' AND column_type='varchar(32)' AND is_nullable='YES')
          OR (column_name='recipient_phone_hash' AND column_type='char(64)' AND is_nullable='YES')
          OR (column_name='recipient_phone_masked' AND column_type='varchar(16)' AND is_nullable='YES')))=3
   AND (SELECT COUNT(*) FROM information_schema.statistics
      WHERE table_schema=DATABASE() AND table_name='cms_registration_seat_invitation'
        AND index_name='idx_seat_invitation_phone' AND column_name='recipient_phone_hash' AND seq_in_index=1)=1
   AS seat_invitation_phone_ready;

-- 回退:保留列与索引(旧 jar 不读它们)。禁止 DROP —— 会丢掉待领取的转赠事实。
