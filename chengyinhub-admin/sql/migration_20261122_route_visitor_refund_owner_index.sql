-- R7 路线与站点到访报告：refund_application(owner_type, owner_id, reviewed_at) 索引补缺。
--
-- 为什么必须新增：refund_application 现有索引只有 PRIMARY、uk_refund_idempotency、uk_refund_no、
--   idx_source(source_type, source_id)、idx_merchant_status(merchant_id, status)、idx_refund_payout_status(payout_status)，
--   没有任何索引以 owner_type/owner_id 为左前缀。到访报告按主题取「审核通过的报名退款」
--   （BizFunnelDailyMapper.selectRouteVisitorRefundDaily：owner_type=1 且 owner_id=主题，或 owner_type=2 且 owner_id∈该主题活动，
--   reviewed_at 落在查询窗口内），没有本索引就是全表扫描。
--   同表其余报告读面（topic_route_session / player_node_progress / cms_topic_node / redemption）已有可用左前缀，不在本文件加。
--
-- 只新增索引：不改列、不回填、不动任何数据；不执行生产 DDL，须走 chengyin-db-migrate 只读预检。
-- 回滚：ALTER TABLE refund_application DROP INDEX idx_refund_owner_reviewed;
-- runner: assert=scalar-true
SELECT CAST(IF(DATABASE() IS NOT NULL
  AND (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()
    AND table_name='refund_application' AND UPPER(engine)='INNODB')=1
  AND (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE()
    AND table_name='refund_application' AND column_name IN ('owner_type','owner_id','reviewed_at'))=3
  AND (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE()
    AND table_name='refund_application' AND index_name='idx_refund_owner_reviewed')=0,
  1,JSON_EXTRACT('ASSERT_FAILED_refund_owner_reviewed_index_preflight','$')) AS UNSIGNED) AS assertion_ok;

ALTER TABLE refund_application
  ADD KEY idx_refund_owner_reviewed (owner_type, owner_id, reviewed_at);

-- runner: assert=scalar-true
SELECT CAST(IF(
  (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE()
    AND table_name='refund_application' AND index_name='idx_refund_owner_reviewed')=3
  AND (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE()
    AND table_name='refund_application' AND index_name='idx_refund_owner_reviewed'
    AND seq_in_index=1 AND column_name='owner_type' AND non_unique=1)=1
  AND (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE()
    AND table_name='refund_application' AND index_name='idx_refund_owner_reviewed'
    AND seq_in_index=2 AND column_name='owner_id')=1
  AND (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE()
    AND table_name='refund_application' AND index_name='idx_refund_owner_reviewed'
    AND seq_in_index=3 AND column_name='reviewed_at')=1,
  1,JSON_EXTRACT('ASSERT_FAILED_refund_owner_reviewed_index_readback','$')) AS UNSIGNED) AS assertion_ok;
