-- 每个平台自营自玩主题的双人票 / 四人小队票回填（owner 2026-11-24）。
-- 规则与 Java 唯一实现一致：com.chengyinhub.business.service.support.SeatTicketPricing（价格）与
-- TopicSeatProducts（可售条件、编码、名称、绑定、状态）。SeatProductBackfillMySqlIT 在真 MySQL 上
-- 跑本文件，再对同一批主题跑 Java 同步，逐列比对两者结果，并验证重跑零变化。
--
-- 价格（全程整数分）：list = 单人自玩价(分) × 人数；target = ceil(list × 折扣百分数 / 100)；
--   售价 = min(target 向上取到分位为 90 的最小值, list)。折扣：2 人 83，4 人 75。
-- 可售主题：未删除、内容槽 PLATFORM、self_play=1、self_play_price>0、有平台费率快照、start/end 齐且 end 不早于 start。
-- 身份：product_code = SEAT2-T<主题id> / SEAT4-T<主题id>，只绑定该主题一行 marketing_product_item。
-- 幂等：缺则建；价格/名称/绑定快照变化则改并 revision+1；主题不再可售则 status 1→0；不删任何行。
--   owner 手工停售（status=2）的行保持 2。编码被别的形状占用的行（非单主题自玩路线）一概不动。
-- 只写 product_code 以 SEAT2-T / SEAT4-T 开头且形状吻合的行，不碰任何其它商品。
-- 生产执行须走 chengyin-db-migrate 只读预检并由 owner 决定落库时点。

-- runner: assert=scalar-true
SELECT (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()
          AND table_name IN ('cms_topic', 'product_role', 'marketing_product', 'marketing_product_item')) = 4
   AND (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE()
          AND table_name = 'cms_topic'
          AND column_name IN ('self_play', 'self_play_price', 'fee_platform_rate', 'published_config_version',
                              'start_date', 'end_date', 'del_flag', 'name')) = 8
   AS seat_backfill_preflight;

-- 1) 缺的多人票商品：每个可售主题 × {2, 4} 人。
INSERT INTO marketing_product
    (product_code, product_name, product_kind, purchase_kind, explore_capacity,
     fulfillment_route, ticket_id, sale_city, parent_product_id,
     cash_price, points_price, validity_kind, valid_days, fixed_valid_from, fixed_valid_to,
     seat_count, gift_allowed, gift_claim_days, status, sale_start_at, sale_end_at,
     terms_version, revision, create_time, update_time)
SELECT CONCAT('SEAT', s.seats, '-T', t.id),
       IF(TRIM(COALESCE(t.name, '')) = '', s.suffix,
              CONCAT(LEFT(TRIM(t.name), 119 - CHAR_LENGTH(s.suffix)), '·', s.suffix)),
       1, 2, 0,
       1, NULL, NULL, NULL,
       (LEAST(CEIL((CAST(ROUND(t.self_play_price * 100) AS SIGNED) * s.seats) * s.rate / 100) + MOD(190 - MOD(CEIL((CAST(ROUND(t.self_play_price * 100) AS SIGNED) * s.seats) * s.rate / 100), 100), 100), (CAST(ROUND(t.self_play_price * 100) AS SIGNED) * s.seats)) / 100), NULL, 0, NULL, NULL, NULL,
       s.seats, 0, NULL, 1, NULL, NULL,
       'SEAT_SELF_PLAY_20261124', 1, NOW(), NOW()
  FROM cms_topic t
  CROSS JOIN (SELECT 2 AS seats, 83 AS rate, '双人票' AS suffix
             UNION ALL SELECT 4, 75, '四人小队票') s
 WHERE (t.del_flag IS NULL OR t.del_flag <> 2)
      AND t.self_play = 1
      AND t.self_play_price > 0
      AND t.fee_platform_rate IS NOT NULL
      AND t.start_date IS NOT NULL AND t.end_date IS NOT NULL
      AND DATE(t.end_date) >= DATE(t.start_date)
      AND EXISTS (SELECT 1 FROM product_role r
                  WHERE r.topic_id = t.id AND r.slot = 'CONTENT' AND r.status = 1
                    AND r.entity_type = 'PLATFORM')
   AND NOT EXISTS (SELECT 1 FROM marketing_product existing WHERE existing.product_code = CONCAT('SEAT', s.seats, '-T', t.id));

-- 2) 只绑定该主题：给还没有绑定行的多人票补一行（本文件刚建的，或上次中断留下的）。
INSERT INTO marketing_product_item (product_id, topic_id, topic_title, content_revision, sort_no, create_time)
SELECT p.id, t.id,
       LEFT(TRIM(COALESCE(t.name, '')), 160),
       IF(t.published_config_version > 0, t.published_config_version, 1),
       0, NOW()
  FROM marketing_product p
  JOIN cms_topic t ON p.product_code = CONCAT('SEAT', p.seat_count, '-T', t.id)
 WHERE p.seat_count IN (2, 4)
   AND p.product_kind = 1 AND p.fulfillment_route = 1 AND p.ticket_id IS NULL AND p.parent_product_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM marketing_product_item i WHERE i.product_id = p.id);

-- 3) 仍可售：价格/名称/上架状态/绑定快照任一变化则改，revision + 1（报价签名随之失效）。
UPDATE marketing_product p
  JOIN (SELECT product_id, COUNT(*) AS item_count, MIN(topic_id) AS topic_id
         FROM marketing_product_item GROUP BY product_id) one ON one.product_id = p.id
  JOIN marketing_product_item i ON i.product_id = p.id
  JOIN cms_topic t ON t.id = one.topic_id
  JOIN (SELECT 2 AS seats, 83 AS rate, '双人票' AS suffix
             UNION ALL SELECT 4, 75, '四人小队票') s ON s.seats = p.seat_count
   SET p.product_name = IF(TRIM(COALESCE(t.name, '')) = '', s.suffix,
              CONCAT(LEFT(TRIM(t.name), 119 - CHAR_LENGTH(s.suffix)), '·', s.suffix)),
       p.cash_price = (LEAST(CEIL((CAST(ROUND(t.self_play_price * 100) AS SIGNED) * s.seats) * s.rate / 100) + MOD(190 - MOD(CEIL((CAST(ROUND(t.self_play_price * 100) AS SIGNED) * s.seats) * s.rate / 100), 100), 100), (CAST(ROUND(t.self_play_price * 100) AS SIGNED) * s.seats)) / 100),
       p.status = IF(p.status = 2, 2, 1),
       p.revision = p.revision + 1,
       p.update_time = NOW()
 WHERE p.product_code = CONCAT('SEAT', s.seats, '-T', t.id)
   AND p.product_kind = 1 AND p.fulfillment_route = 1 AND p.ticket_id IS NULL
      AND p.parent_product_id IS NULL AND one.item_count = 1
   AND (t.del_flag IS NULL OR t.del_flag <> 2)
      AND t.self_play = 1
      AND t.self_play_price > 0
      AND t.fee_platform_rate IS NOT NULL
      AND t.start_date IS NOT NULL AND t.end_date IS NOT NULL
      AND DATE(t.end_date) >= DATE(t.start_date)
      AND EXISTS (SELECT 1 FROM product_role r
                  WHERE r.topic_id = t.id AND r.slot = 'CONTENT' AND r.status = 1
                    AND r.entity_type = 'PLATFORM')
   AND (p.product_name <> (IF(TRIM(COALESCE(t.name, '')) = '', s.suffix,
              CONCAT(LEFT(TRIM(t.name), 119 - CHAR_LENGTH(s.suffix)), '·', s.suffix))) COLLATE utf8mb4_bin
        OR p.cash_price <> (LEAST(CEIL((CAST(ROUND(t.self_play_price * 100) AS SIGNED) * s.seats) * s.rate / 100) + MOD(190 - MOD(CEIL((CAST(ROUND(t.self_play_price * 100) AS SIGNED) * s.seats) * s.rate / 100), 100), 100), (CAST(ROUND(t.self_play_price * 100) AS SIGNED) * s.seats)) / 100)
        OR p.status = 0
        OR i.topic_title <> (LEFT(TRIM(COALESCE(t.name, '')), 160)) COLLATE utf8mb4_bin
        OR i.content_revision <> IF(t.published_config_version > 0, t.published_config_version, 1));

-- 4) 绑定快照跟随主题当前名称与发布修订（第 3 步已为此递增 revision）。
UPDATE marketing_product_item i
  JOIN (SELECT product_id, COUNT(*) AS item_count, MIN(topic_id) AS topic_id
         FROM marketing_product_item GROUP BY product_id) one ON one.product_id = i.product_id
  JOIN marketing_product p ON p.id = i.product_id
  JOIN cms_topic t ON t.id = i.topic_id
  JOIN (SELECT 2 AS seats, 83 AS rate, '双人票' AS suffix
             UNION ALL SELECT 4, 75, '四人小队票') s ON s.seats = p.seat_count
   SET i.topic_title = LEFT(TRIM(COALESCE(t.name, '')), 160),
       i.content_revision = IF(t.published_config_version > 0, t.published_config_version, 1)
 WHERE p.product_code = CONCAT('SEAT', s.seats, '-T', t.id)
   AND p.product_kind = 1 AND p.fulfillment_route = 1 AND p.ticket_id IS NULL
      AND p.parent_product_id IS NULL AND one.item_count = 1
   AND (t.del_flag IS NULL OR t.del_flag <> 2)
      AND t.self_play = 1
      AND t.self_play_price > 0
      AND t.fee_platform_rate IS NOT NULL
      AND t.start_date IS NOT NULL AND t.end_date IS NOT NULL
      AND DATE(t.end_date) >= DATE(t.start_date)
      AND EXISTS (SELECT 1 FROM product_role r
                  WHERE r.topic_id = t.id AND r.slot = 'CONTENT' AND r.status = 1
                    AND r.entity_type = 'PLATFORM')
   AND (i.topic_title <> (LEFT(TRIM(COALESCE(t.name, '')), 160)) COLLATE utf8mb4_bin
        OR i.content_revision <> IF(t.published_config_version > 0, t.published_config_version, 1));

-- 5) 不再可售（含主题已物理删除）：在售的多人票置 0（草稿），revision + 1。不删行，订单会引用。
UPDATE marketing_product p
  JOIN (SELECT product_id, COUNT(*) AS item_count, MIN(topic_id) AS topic_id
         FROM marketing_product_item GROUP BY product_id) one ON one.product_id = p.id
  LEFT JOIN cms_topic t ON t.id = one.topic_id
   SET p.status = 0,
       p.revision = p.revision + 1,
       p.update_time = NOW()
 WHERE p.status = 1
   AND p.seat_count IN (2, 4)
   AND p.product_code = CONCAT('SEAT', p.seat_count, '-T', one.topic_id)
   AND p.product_kind = 1 AND p.fulfillment_route = 1 AND p.ticket_id IS NULL
      AND p.parent_product_id IS NULL AND one.item_count = 1
   AND COALESCE(t.id IS NOT NULL
      AND (t.del_flag IS NULL OR t.del_flag <> 2)
      AND t.self_play = 1
      AND t.self_play_price > 0
      AND t.fee_platform_rate IS NOT NULL
      AND t.start_date IS NOT NULL AND t.end_date IS NOT NULL
      AND DATE(t.end_date) >= DATE(t.start_date)
      AND EXISTS (SELECT 1 FROM product_role r
                  WHERE r.topic_id = t.id AND r.slot = 'CONTENT' AND r.status = 1
                    AND r.entity_type = 'PLATFORM'), FALSE) = FALSE;

-- 回读：每个可售主题恰有 2、4 人两条多人票，在售价不超过票面，且全部只绑定该主题。
-- runner: assert=scalar-true
SELECT COUNT(*) = 0 AS every_eligible_topic_has_both_seat_products
  FROM cms_topic t
  CROSS JOIN (SELECT 2 AS seats, 83 AS rate, '双人票' AS suffix
             UNION ALL SELECT 4, 75, '四人小队票') s
 WHERE (t.del_flag IS NULL OR t.del_flag <> 2)
      AND t.self_play = 1
      AND t.self_play_price > 0
      AND t.fee_platform_rate IS NOT NULL
      AND t.start_date IS NOT NULL AND t.end_date IS NOT NULL
      AND DATE(t.end_date) >= DATE(t.start_date)
      AND EXISTS (SELECT 1 FROM product_role r
                  WHERE r.topic_id = t.id AND r.slot = 'CONTENT' AND r.status = 1
                    AND r.entity_type = 'PLATFORM')
   AND NOT EXISTS (SELECT 1 FROM marketing_product p
                    JOIN marketing_product_item i ON i.product_id = p.id AND i.topic_id = t.id
                   WHERE p.product_code = CONCAT('SEAT', s.seats, '-T', t.id) AND p.status IN (1, 2));

-- runner: assert=scalar-true
SELECT COUNT(*) = 0 AS no_seat_product_above_list
  FROM marketing_product p
  JOIN marketing_product_item i ON i.product_id = p.id
  JOIN cms_topic t ON t.id = i.topic_id
 WHERE p.product_code = CONCAT('SEAT', p.seat_count, '-T', t.id)
   AND p.status = 1
   AND (t.self_play_price IS NULL OR p.cash_price > t.self_play_price * p.seat_count);
