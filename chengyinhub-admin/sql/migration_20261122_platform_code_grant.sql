-- 2026-11-22 平台自发兑换码（owner 决策：方案 B）。
-- 1) marketing_channel_voucher 允许“平台发行方”：issuer_type 1=PLATFORM 2=CHANNEL（存量全部回填为 2）。
--    只有 PLATFORM 行允许 account_id / verification_id 为空，CHANNEL 行仍必须绑定已验证外部订单（CHECK 约束）。
--    新增批次号 batch_no + 批内序号 batch_seq、仅管理端可见备注 admin_note。有效期沿用原 expires_at（NOT NULL）。
-- 2) 新表 marketing_code_grant：码授权可玩事实（“凭码解锁”），不是付款、不是注册单、不进收入队列。
--    cms_registration 与全部支付/收入表不动。
-- 依赖：marketing_z_channel_voucher_20261108、z_channel_voucher_snapshot_20261109（批外，已在 master）。
-- Source-only ordered migration。不执行生产 DDL：须走 chengyin-db-migrate 只读预检并由 owner 决定落库时点。
-- 回滚：DROP TABLE marketing_code_grant，删除新增列与约束，再把两列改回 NOT NULL（须先确认没有 PLATFORM 行）。

-- runner: assert=scalar-true
SELECT CAST(IF(DATABASE() IS NOT NULL
  AND (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()
    AND table_name='marketing_channel_voucher')=1
  AND (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE()
    AND table_name='marketing_channel_voucher' AND column_name='grant_snapshot_json')=1
  AND (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE()
    AND table_name='marketing_channel_voucher'
    AND column_name IN ('issuer_type','batch_no','batch_seq','admin_note'))=0
  AND (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()
    AND table_name='marketing_code_grant')=0,
  1,JSON_EXTRACT('ASSERT_FAILED_platform_code_grant_preflight','$')) AS UNSIGNED) AS assertion_ok;

ALTER TABLE marketing_channel_voucher
    ADD COLUMN issuer_type TINYINT NOT NULL DEFAULT 2 COMMENT '1 PLATFORM 平台自发 2 CHANNEL 外部渠道（存量回填 2）' AFTER id,
    ADD COLUMN batch_no VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '平台发码批次号；CHANNEL 行为空' AFTER issuer_type,
    ADD COLUMN batch_seq INT NULL COMMENT '批内序号 1..N' AFTER batch_no,
    ADD COLUMN admin_note VARCHAR(200) NULL COMMENT '仅管理端可见备注，不下发玩家' AFTER batch_seq;

ALTER TABLE marketing_channel_voucher
    MODIFY COLUMN account_id BIGINT UNSIGNED NULL COMMENT '渠道主体；仅 PLATFORM 行可为空',
    MODIFY COLUMN verification_id BIGINT UNSIGNED NULL COMMENT '已验证外部订单；仅 PLATFORM 行可为空';

ALTER TABLE marketing_channel_voucher
    ADD CONSTRAINT ck_channel_voucher_issuer CHECK (
        (issuer_type = 2 AND account_id IS NOT NULL AND verification_id IS NOT NULL
            AND batch_no IS NULL AND batch_seq IS NULL)
        OR (issuer_type = 1 AND account_id IS NULL AND verification_id IS NULL
            AND batch_no IS NOT NULL AND batch_seq IS NOT NULL AND batch_seq > 0)),
    ADD UNIQUE KEY uk_channel_voucher_batch (batch_no, batch_seq),
    ADD KEY idx_channel_voucher_issuer (issuer_type, status, issued_at);

CREATE TABLE IF NOT EXISTS marketing_code_grant (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    voucher_id BIGINT UNSIGNED NOT NULL COMMENT '来源码 marketing_channel_voucher.id（issuer_type=1）',
    member_id BIGINT NOT NULL COMMENT '兑换人',
    product_id BIGINT NOT NULL,
    product_revision BIGINT NOT NULL,
    topic_id BIGINT NOT NULL COMMENT '可玩范围：自玩域主题 id（cms_registration.owner_type=1 同口径）',
    content_revision BIGINT NULL COMMENT '发码时冻结的内容修订；空=沿用当前发布',
    quantity INT NOT NULL,
    seat_count INT NOT NULL COMMENT '商品席位 x 数量',
    status TINYINT NOT NULL DEFAULT 0 COMMENT '0 ACTIVE 1 REVOKED；撤销只停后续可玩，不回滚已完成内容',
    valid_from DATETIME NULL,
    valid_to DATETIME NULL COMMENT '空=不过期（随商品有效期口径）',
    granted_at DATETIME NOT NULL,
    revoked_at DATETIME NULL,
    revoke_reason VARCHAR(120) NULL,
    request_id VARCHAR(64) NOT NULL COMMENT '玩家兑换请求键',
    request_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    idempotency_key VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'PCG:voucherId:topicId',
    create_time DATETIME NOT NULL,
    update_time DATETIME NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_code_grant_idem (idempotency_key),
    UNIQUE KEY uk_code_grant_voucher_topic (voucher_id, topic_id),
    KEY idx_code_grant_member_topic (member_id, topic_id, status),
    KEY idx_code_grant_member_request (member_id, request_id),
    CONSTRAINT fk_code_grant_voucher FOREIGN KEY (voucher_id)
        REFERENCES marketing_channel_voucher (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CONSTRAINT ck_code_grant_status CHECK (status IN (0,1)),
    CONSTRAINT ck_code_grant_revoke CHECK (status <> 1 OR revoked_at IS NOT NULL),
    CONSTRAINT ck_code_grant_counts CHECK (quantity > 0 AND seat_count > 0),
    CONSTRAINT ck_code_grant_window CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_to > valid_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='平台码授权可玩事实；非付款、非注册单、不计站内收入';

-- runner: assert=scalar-true
SELECT CAST(IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE()
    AND table_name='marketing_channel_voucher'
    AND column_name IN ('issuer_type','batch_no','batch_seq','admin_note'))=4
  AND (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE()
    AND table_name='marketing_channel_voucher'
    AND column_name IN ('account_id','verification_id') AND is_nullable='YES')=2
  AND (SELECT COUNT(*) FROM information_schema.table_constraints WHERE constraint_schema=DATABASE()
    AND table_name='marketing_channel_voucher'
    AND constraint_name='ck_channel_voucher_issuer' AND constraint_type='CHECK')=1
  AND (SELECT COUNT(*) FROM marketing_channel_voucher WHERE issuer_type <> 2)=0
  AND (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()
    AND table_name='marketing_code_grant')=1
  AND (SELECT COUNT(*) FROM information_schema.table_constraints WHERE constraint_schema=DATABASE()
    AND table_name='marketing_code_grant' AND constraint_type='CHECK'
    AND constraint_name IN ('ck_code_grant_status','ck_code_grant_revoke','ck_code_grant_counts','ck_code_grant_window'))=4
  AND (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE()
    AND table_name='marketing_code_grant' AND index_name='uk_code_grant_voucher_topic' AND non_unique=0)=2,
  1,JSON_EXTRACT('ASSERT_FAILED_platform_code_grant_readback','$')) AS UNSIGNED) AS assertion_ok;
