-- 商家行业再补七类(2026-11-22 测试库核对:type=6 只有 11-02 那十行,自由探索模板 FE01-FE10 的位置
-- 要的餐饮小吃 / 运动 / 桌游台球电玩 / 服饰鞋包 / 照相馆 / 现场音乐 / 亲子游乐 的店没有行业可选,报不了名。
-- 业主 2026-11-02:标签可以更多一些,有很多城瘾合适的商家)。
-- 口径与 migration_20261102_merchant_industry_categories.sql 相同:
--   只新增 sys_category type=6(商家行业),不改不删任何现有行;sort_id 接在原十行(21-30)之后;
--   同类关键字在 type 1/6 已有在用顶层记录的跳过 —— 例如主题类别里已有「娱乐休闲」(type=1,商家读侧按 type 1+6 取,
--   照样选得到、章节也认),就不再插一行同名的。关键字取得窄(健身 / 写真 / 游乐),不会被「城市运动」「摄影打卡」
--   「亲子同行」这些主题类别挡掉。可重复执行。
-- 回滚:这七个名字的 type=6 行在没有商家 / 章节引用时把 status 置 0 即可。生产执行须先只读预检并取得用户确认;本文件不连接生产数据库。

INSERT INTO sys_category (type, parent_id, category_name, level, sort_id, icon, status, del_flag, create_time, update_time)
SELECT 6, 0, n.name, 0, n.sort_id, NULL, 1, 0, NOW(), NOW()
FROM (SELECT '餐饮小吃' AS name, 31 AS sort_id, '小吃' AS kw UNION ALL SELECT '运动健身', 32, '健身'
      UNION ALL SELECT '娱乐休闲', 33, '娱乐' UNION ALL SELECT '服饰鞋包', 34, '服饰'
      UNION ALL SELECT '摄影写真', 35, '写真' UNION ALL SELECT '现场音乐', 36, '音乐'
      UNION ALL SELECT '亲子游乐', 37, '游乐') n
WHERE NOT EXISTS (SELECT 1 FROM sys_category c WHERE c.type IN (1, 6) AND c.parent_id = 0 AND c.del_flag = 0
                    AND c.status = 1 AND c.category_name LIKE CONCAT('%', n.kw, '%'));

-- 七个关键字逐个都要有着落(type=6 新行,或同类的 type=1 在用行),不合起来凑数。
-- runner: assert=scalar-true
SELECT (SELECT COUNT(*) FROM (
          SELECT '小吃' AS kw UNION ALL SELECT '健身' UNION ALL SELECT '娱乐' UNION ALL SELECT '服饰'
          UNION ALL SELECT '写真' UNION ALL SELECT '音乐' UNION ALL SELECT '游乐') k
        WHERE EXISTS (SELECT 1 FROM sys_category c
                      WHERE c.type IN (1, 6) AND c.parent_id = 0 AND c.status = 1 AND c.del_flag = 0
                        AND c.category_name LIKE CONCAT('%', k.kw, '%'))) = 7
   AS merchant_industries_more_ready;
