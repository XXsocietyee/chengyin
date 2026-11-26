package com.chengyinhub.business.it;

import com.chengyinhub.business.mapper.CmsTopicMapper;
import com.chengyinhub.business.mapper.MarketingProductMapper;
import com.chengyinhub.business.mapper.ProductRoleMapper;
import com.chengyinhub.business.service.impl.ProductRoleServiceImpl;
import com.chengyinhub.business.service.support.SeatTicketPricing;
import com.chengyinhub.business.service.support.TopicSeatProducts;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 多人票回填迁移与 Java 同步在真 InnoDB 上逐列一致（owner 2026-11-24）。
 *
 * <p>同一组主题夹具（可售的各种价格、长名、未发布 LINEAR、各类不可售、已有无关商品、被别的形状占用的编码），
 * 分别跑 {@code migration_20261124_seat_products_backfill.sql} 原文件与真 {@link TopicSeatProducts}（真
 * CmsTopicMapper / MarketingProductMapper / ProductRoleMapper XML），比较两边产出的商品与绑定行；
 * 每条在售价再与 {@link SeatTicketPricing} 逐条核对。另证迁移重跑零变化、改价与失去资格后两边同样跟随。
 *
 * <p>SEATS2：{@code migration_20261124b_seat_products_open_ended.sql} 接在第一份之后跑，开放式路线（start/end 都为空）
 * 与 Java 同步逐列一致、幂等、第一份重跑后可恢复。
 *
 * <p>一类一库，跑完 DROP DATABASE。本机不执行；由真库门禁（registry 登记）在 GitHub-hosted runner 上跑。
 */
@EnabledIfEnvironmentVariable(named = "CHENGYIN_MARKETING_DB_IT_APPROVED", matches = "1")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class SeatProductBackfillMySqlIT {

    private static final String MIGRATION = "migration_20261124_seat_products_backfill.sql";
    /** SEATS2：开放式自玩路线（start/end 都为空），接在第一份之后跑。 */
    private static final String MIGRATION_OPEN_ENDED = "migration_20261124b_seat_products_open_ended.sql";

    private final String suite = "seatfill_" + UUID.randomUUID().toString().replace("-", "").substring(0, 10);

    private DriverManagerDataSource source;
    private JdbcTemplate db;
    private TransactionTemplate tx;
    private TopicSeatProducts sync;

    @BeforeAll
    void schemaAndRealMappers() throws Exception {
        assertTrue(List.of("127.0.0.1", "localhost").contains(MybatisItDatabase.host()), "只许连一次性 scratch MySQL");
        source = P0AcceptanceSchema.dataSource(suite);
        db = new JdbcTemplate(source);
        tx = new TransactionTemplate(new DataSourceTransactionManager(source));
        assertEquals(MybatisItDatabase.databaseName(suite), db.queryForObject("SELECT DATABASE()", String.class));
        assertTrue(com.chengyinhub.business.service.MysqlIntegrationTestConfig.isMysql8OrNewer(
                db.queryForObject("SELECT VERSION()", String.class)), "需要 Oracle MySQL >= 8");

        P0AcceptanceSchema.baseTables(db, "cms_topic", "product_role");
        // 快照之后加的 cms_topic 列（CmsTopicMapper 的 selectCmsTopicVo 要读），仅在本类 UUID scratch 库里补。
        db.execute("ALTER TABLE cms_topic ADD COLUMN beta_flag TINYINT NOT NULL DEFAULT 0,"
                + " ADD COLUMN city_code VARCHAR(32), ADD COLUMN content_contract_json JSON,"
                + " ADD COLUMN circle_theme_code VARCHAR(24), ADD COLUMN source_template_topic_id BIGINT,"
                + " ADD COLUMN complete_rule_json JSON, ADD COLUMN route_mode VARCHAR(20) DEFAULT 'LINEAR',"
                + " ADD COLUMN route_graph_json JSON, ADD COLUMN config_version BIGINT DEFAULT 1,"
                + " ADD COLUMN published_route_graph_json JSON, ADD COLUMN published_config_version BIGINT NULL,"
                + " ADD COLUMN game_module_config_json JSON, ADD COLUMN journey_rules_json JSON, ADD COLUMN journey_story_json JSON,"
                + " ADD COLUMN theme_runtime_config_json MEDIUMTEXT, ADD COLUMN published_theme_runtime_config_json MEDIUMTEXT,"
                + " ADD COLUMN team_mode TINYINT NOT NULL DEFAULT 0, ADD COLUMN team_max_members INT NOT NULL DEFAULT 4,"
                + " ADD COLUMN club_coop_open TINYINT NOT NULL DEFAULT 1, ADD COLUMN club_pinned TINYINT NOT NULL DEFAULT 0,"
                + " ADD COLUMN club_member_only TINYINT NOT NULL DEFAULT 0");
        db.execute("ALTER TABLE product_role ADD COLUMN declared_by BIGINT NULL");
        P0AcceptanceSchema.migrations(source, "migration_marketing_product_20261108.sql");

        var session = P0AcceptanceSchema.sql(source, "CmsTopicMapper", "MarketingProductMapper", "ProductRoleMapper");
        ProductRoleServiceImpl roles = new ProductRoleServiceImpl();
        ReflectionTestUtils.setField(roles, "productRoleMapper", session.getMapper(ProductRoleMapper.class));
        sync = new TopicSeatProducts(session.getMapper(CmsTopicMapper.class),
                session.getMapper(MarketingProductMapper.class), roles);
    }

    @AfterAll
    void cleanup() {
        if (db != null) {
            assertTrue(MybatisItDatabase.databaseName(suite).matches("chengyin_mybatis_seatfill_[a-z0-9_]+"));
            P0AcceptanceSchema.drop(db, suite);
        }
    }

    @BeforeEach
    void fixtures() {
        for (String table : List.of("marketing_product_item", "marketing_product", "product_role", "cms_topic")) {
            db.update("DELETE FROM " + table);
        }
        // id, name, self_play, price, fee, start, end, del_flag, published_config_version, content owner
        topic(7001, "城南夜游", 1, "29.90", "0.0000", "2026-12-01 12:00:00", "2026-12-31 12:00:00", 0, 7L, "PLATFORM");
        topic(7002, "江畔寻踪", 1, "39.00", "0.0300", "2026-12-01 12:00:00", "2026-12-01 12:00:00", 0, 3L, "PLATFORM");
        topic(7003, "小票价", 1, "0.40", "0.0000", "2026-12-01 12:00:00", "2026-12-31 12:00:00", 0, null, "PLATFORM");
        topic(7004, "  两边带空格  ", 1, "0.97", "0.0000", "2026-12-01 12:00:00", "2026-12-31 12:00:00", 0, 0L, "PLATFORM");
        topic(7005, "跨元", 1, "19.97", "0.0000", "2026-12-01 12:00:00", "2026-12-31 12:00:00", 0, 2L, "PLATFORM");
        topic(7006, "高价", 1, "999.99", "0.0000", "2026-12-01 12:00:00", "2026-12-31 12:00:00", 0, 2L, "PLATFORM");
        topic(7007, "恰好点九", 1, "29.30", "0.0000", "2026-12-01 12:00:00", "2026-12-31 12:00:00", 0, 2L, "PLATFORM");
        topic(7008, "长".repeat(130), 1, "58.00", "0.0000", "2026-12-01 12:00:00", "2026-12-31 12:00:00", 0, 2L, "PLATFORM");
        topic(7009, "玩家主题", 1, "29.90", "0.0000", "2026-12-01 12:00:00", "2026-12-31 12:00:00", 0, 2L, "MEMBER");
        topic(7010, "没开自玩", 0, "29.90", "0.0000", "2026-12-01 12:00:00", "2026-12-31 12:00:00", 0, 2L, "PLATFORM");
        topic(7011, "没有自玩价", 1, null, "0.0000", "2026-12-01 12:00:00", "2026-12-31 12:00:00", 0, 2L, "PLATFORM");
        topic(7012, "没有费率快照", 1, "29.90", null, "2026-12-01 12:00:00", "2026-12-31 12:00:00", 0, 2L, "PLATFORM");
        topic(7013, "没有履约窗", 1, "29.90", "0.0000", "2026-12-01 12:00:00", null, 0, 2L, "PLATFORM");
        topic(7014, "已删除", 1, "29.90", "0.0000", "2026-12-01 12:00:00", "2026-12-31 12:00:00", 2, 2L, "PLATFORM");
        topic(7015, "编码被占", 1, "29.90", "0.0000", "2026-12-01 12:00:00", "2026-12-31 12:00:00", 0, 2L, "PLATFORM");
        topic(7016, "履约窗倒置", 1, "29.90", "0.0000", "2026-12-10 12:00:00", "2026-12-01 12:00:00", 0, 2L, "PLATFORM");
        // 无关商品：城市包（绑定 7001）不得被任何一方改动。
        long bundle = product("CITY-BUNDLE-1", 2, 1, "88.00", 1, 1);
        item(bundle, 7001, "城南夜游", 7);
        // 编码 SEAT2-T7015 被一个双主题商品占用：两边都不得改它，也不得为 7015 另建 2 人票。
        long foreign = product("SEAT2-T7015", 1, 2, "10.00", 1, 3);
        item(foreign, 7015, "编码被占", 2);
        item(foreign, 7001, "城南夜游", 7);
    }

    @Test
    void backfillSqlAndJavaSyncProduceIdenticalRowsAndTheApprovedPrices() {
        P0AcceptanceSchema.migrations(source, MIGRATION);
        List<Map<String, Object>> bySql = seatRows();

        resetSeatRows();
        syncAllInJava();
        List<Map<String, Object>> byJava = seatRows();

        assertEquals(bySql, byJava, "回填 SQL 与 Java 同步必须逐列一致");
        // 可售 8 个主题 × 2，再加 7015 只建出的 4 人票。
        assertEquals(17, bySql.size(), bySql.toString());
        for (Map<String, Object> row : bySql) {
            int seats = ((Number) row.get("seat_count")).intValue();
            BigDecimal single = db.queryForObject("SELECT self_play_price FROM cms_topic WHERE id = ?",
                    BigDecimal.class, row.get("topic_id"));
            assertEquals(0, SeatTicketPricing.price(single, seats).compareTo((BigDecimal) row.get("cash_price")),
                    "迁移售价必须等于 SeatTicketPricing：" + row);
        }
        assertPrice("SEAT2-T7001", "49.90");
        assertPrice("SEAT4-T7001", "89.90");
        assertPrice("SEAT2-T7002", "64.90");
        assertPrice("SEAT4-T7002", "117.90");
        assertPrice("SEAT2-T7003", "0.80");
        assertPrice("SEAT4-T7004", "3.88");
        assertPrice("SEAT4-T7005", "60.90");
        assertPrice("SEAT4-T7007", "87.90");
        assertEquals("两边带空格·双人票", name("SEAT2-T7004"));
        assertEquals("长".repeat(114) + "·四人小队票", name("SEAT4-T7008"), "按列宽截断主题名");
        assertEquals("长".repeat(130), db.queryForObject("SELECT i.topic_title FROM marketing_product p"
                + " JOIN marketing_product_item i ON i.product_id = p.id WHERE p.product_code = 'SEAT4-T7008'", String.class));
        assertEquals(1L, db.queryForObject("SELECT i.content_revision FROM marketing_product p"
                + " JOIN marketing_product_item i ON i.product_id = p.id WHERE p.product_code = 'SEAT2-T7003'", Long.class));
        assertUnrelatedUntouched();
    }

    @Test
    void migrationRerunChangesNothing() {
        P0AcceptanceSchema.migrations(source, MIGRATION);
        List<Map<String, Object>> first = seatRowsWithIdentity();
        P0AcceptanceSchema.migrations(source, MIGRATION);
        assertEquals(first, seatRowsWithIdentity(), "重跑不得新增、改价或递增 revision");
        syncAllInJava();
        assertEquals(first, seatRowsWithIdentity(), "迁移之后 Java 同步也应判定无变化");
        assertUnrelatedUntouched();
    }

    @Test
    void priceChangeAndLostEligibilityFollowTheSameWayInSqlAndJava() {
        P0AcceptanceSchema.migrations(source, MIGRATION);
        changeTopics();
        P0AcceptanceSchema.migrations(source, MIGRATION);
        List<Map<String, Object>> bySql = seatRows();

        fixtures();
        syncAllInJava();
        changeTopics();
        syncAllInJava();
        List<Map<String, Object>> byJava = seatRows();

        assertEquals(bySql, byJava);
        assertPrice("SEAT2-T7001", "64.90");
        assertPrice("SEAT4-T7001", "117.90");
        assertEquals(2, revision("SEAT2-T7001"));
        assertEquals(0, status("SEAT2-T7002"), "失去资格 → 草稿，不删行");
        assertEquals(0, status("SEAT4-T7002"));
        assertEquals(1, revision("SEAT4-T7003"), "未变的主题不改 revision");
        assertEquals("新名字·双人票", name("SEAT2-T7005"));
        assertUnrelatedUntouched();
    }

    @Test
    void openEndedMigrationAfterTheFirstMatchesJavaSyncAndIsIdempotent() {
        // 开放式（start/end 都为空）平台自玩路线：可售；只填 end：不可售；开放式但玩家主题：不可售。
        topic(7017, "开放式城市路线", 1, "29.90", "0.0000", null, null, 0, 4L, "PLATFORM");
        topic(7018, "只有结束日", 1, "29.90", "0.0000", null, "2026-12-31 12:00:00", 0, 2L, "PLATFORM");
        topic(7019, "开放式玩家主题", 1, "29.90", "0.0000", null, null, 0, 2L, "MEMBER");
        topic(7020, "开放式但没开自玩", 0, "29.90", "0.0000", null, null, 0, 2L, "PLATFORM");

        P0AcceptanceSchema.migrations(source, MIGRATION);
        assertEquals(0, count("SEAT2-T7017") + count("SEAT4-T7017"), "第一份不认开放式路线");
        P0AcceptanceSchema.migrations(source, MIGRATION_OPEN_ENDED);
        List<Map<String, Object>> bySql = seatRows();

        resetSeatRows();
        syncAllInJava();
        List<Map<String, Object>> byJava = seatRows();

        assertEquals(bySql, byJava, "两份迁移按序执行后与 Java 同步逐列一致");
        assertEquals(19, bySql.size(), bySql.toString());
        assertPrice("SEAT2-T7017", "49.90");
        assertPrice("SEAT4-T7017", "89.90");
        assertEquals(1, status("SEAT2-T7017"));
        assertEquals(1, status("SEAT4-T7017"));
        assertEquals("开放式城市路线·双人票", name("SEAT2-T7017"));
        assertEquals(4L, db.queryForObject("SELECT i.content_revision FROM marketing_product p"
                + " JOIN marketing_product_item i ON i.product_id = p.id WHERE p.product_code = 'SEAT4-T7017'", Long.class));
        for (long ineligible : new long[]{7018L, 7019L, 7020L}) {
            assertEquals(0, count("SEAT2-T" + ineligible) + count("SEAT4-T" + ineligible), "主题 " + ineligible);
        }
        for (Map<String, Object> row : bySql) {
            int seats = ((Number) row.get("seat_count")).intValue();
            BigDecimal single = db.queryForObject("SELECT self_play_price FROM cms_topic WHERE id = ?",
                    BigDecimal.class, row.get("topic_id"));
            assertEquals(0, SeatTicketPricing.price(single, seats).compareTo((BigDecimal) row.get("cash_price")), row.toString());
        }

        // 幂等：重跑第二份零变化；之后 Java 同步也判无变化。
        resetSeatRows();
        P0AcceptanceSchema.migrations(source, MIGRATION);
        P0AcceptanceSchema.migrations(source, MIGRATION_OPEN_ENDED);
        List<Map<String, Object>> first = seatRowsWithIdentity();
        P0AcceptanceSchema.migrations(source, MIGRATION_OPEN_ENDED);
        assertEquals(first, seatRowsWithIdentity(), "重跑不得新增、改价或递增 revision");
        syncAllInJava();
        assertEquals(first, seatRowsWithIdentity());

        // 第一份若被重跑会把开放式路线的多人票置 0；再跑第二份即恢复在售。
        P0AcceptanceSchema.migrations(source, MIGRATION);
        assertEquals(0, status("SEAT2-T7017"));
        P0AcceptanceSchema.migrations(source, MIGRATION_OPEN_ENDED);
        assertEquals(1, status("SEAT2-T7017"));
        assertEquals(1, status("SEAT4-T7017"));
        assertPrice("SEAT2-T7017", "49.90");

        // 开放式路线补上一端日期 ⇒ 两边都下架为草稿。
        db.update("UPDATE cms_topic SET start_date = '2026-12-01 12:00:00' WHERE id = 7017");
        P0AcceptanceSchema.migrations(source, MIGRATION_OPEN_ENDED);
        assertEquals(0, status("SEAT2-T7017"));
        assertEquals(0, status("SEAT4-T7017"));
        assertUnrelatedUntouched();
    }

    private int count(String code) {
        return db.queryForObject("SELECT COUNT(*) FROM marketing_product WHERE product_code = ?", Integer.class, code);
    }

    private void changeTopics() {
        db.update("UPDATE cms_topic SET self_play_price = 39.00 WHERE id = 7001");
        db.update("UPDATE cms_topic SET fee_platform_rate = NULL WHERE id = 7002");
        db.update("UPDATE cms_topic SET name = '新名字' WHERE id = 7005");
    }

    private void syncAllInJava() {
        for (Long topicId : db.queryForList("SELECT id FROM cms_topic ORDER BY id", Long.class)) {
            tx.executeWithoutResult(status -> sync.sync(topicId));
        }
    }

    private void resetSeatRows() {
        db.update("DELETE i FROM marketing_product_item i JOIN marketing_product p ON p.id = i.product_id"
                + " WHERE p.terms_version = ?", TopicSeatProducts.TERMS_VERSION);
        db.update("DELETE FROM marketing_product WHERE terms_version = ?", TopicSeatProducts.TERMS_VERSION);
    }

    private List<Map<String, Object>> seatRows() {
        return db.queryForList("SELECT p.product_code, p.product_name, p.product_kind, p.purchase_kind,"
                + " p.explore_capacity, p.fulfillment_route, p.ticket_id, p.sale_city, p.parent_product_id,"
                + " p.cash_price, p.points_price, p.validity_kind, p.valid_days, p.fixed_valid_from, p.fixed_valid_to,"
                + " p.seat_count, p.gift_allowed, p.gift_claim_days, p.status, p.sale_start_at, p.sale_end_at,"
                + " p.terms_version, p.revision, i.topic_id, i.topic_title, i.content_revision, i.sort_no"
                + " FROM marketing_product p JOIN marketing_product_item i ON i.product_id = p.id"
                + " WHERE p.terms_version = ? ORDER BY p.product_code", TopicSeatProducts.TERMS_VERSION);
    }

    private List<Map<String, Object>> seatRowsWithIdentity() {
        return db.queryForList("SELECT p.id, p.product_code, p.cash_price, p.status, p.revision, p.update_time,"
                + " i.id AS item_id, i.topic_title, i.content_revision"
                + " FROM marketing_product p LEFT JOIN marketing_product_item i ON i.product_id = p.id"
                + " ORDER BY p.product_code, i.id");
    }

    private void assertUnrelatedUntouched() {
        assertEquals(List.of(Map.of("product_code", "CITY-BUNDLE-1", "cash_price", new BigDecimal("88.00"),
                        "status", 1, "revision", 1L, "items", 1L),
                        Map.of("product_code", "SEAT2-T7015", "cash_price", new BigDecimal("10.00"),
                        "status", 1, "revision", 3L, "items", 2L)),
                db.query("SELECT p.product_code, p.cash_price, p.status, p.revision,"
                        + " (SELECT COUNT(*) FROM marketing_product_item i WHERE i.product_id = p.id) AS items"
                        + " FROM marketing_product p WHERE p.terms_version <> ? ORDER BY p.product_code",
                        (rs, n) -> Map.<String, Object>of("product_code", rs.getString(1), "cash_price", rs.getBigDecimal(2),
                                "status", rs.getInt(3), "revision", rs.getLong(4), "items", rs.getLong(5)),
                        TopicSeatProducts.TERMS_VERSION));
    }

    private void assertPrice(String code, String expected) {
        assertEquals(new BigDecimal(expected), db.queryForObject(
                "SELECT cash_price FROM marketing_product WHERE product_code = ?", BigDecimal.class, code), code);
    }

    private String name(String code) {
        return db.queryForObject("SELECT product_name FROM marketing_product WHERE product_code = ?", String.class, code);
    }

    private int status(String code) {
        return db.queryForObject("SELECT status FROM marketing_product WHERE product_code = ?", Integer.class, code);
    }

    private long revision(String code) {
        return db.queryForObject("SELECT revision FROM marketing_product WHERE product_code = ?", Long.class, code);
    }

    private void topic(long id, String name, int selfPlay, String price, String fee, String start, String end,
                       int delFlag, Long publishedVersion, String owner) {
        db.update("INSERT INTO cms_topic (id, member_id, name, self_play, self_play_price, fee_platform_rate,"
                        + " start_date, end_date, del_flag, published_config_version, create_time, update_time)"
                        + " VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())",
                id, name, selfPlay, price == null ? null : new BigDecimal(price), fee == null ? null : new BigDecimal(fee),
                start, end, delFlag, publishedVersion);
        db.update("INSERT INTO product_role (topic_id, slot, entity_type, entity_id, status) VALUES (?, 'CONTENT', ?, ?, 1)",
                id, owner, "PLATFORM".equals(owner) ? null : 9001L);
    }

    private long product(String code, int kind, int seats, String price, int status, long revision) {
        db.update("INSERT INTO marketing_product (product_code, product_name, product_kind, purchase_kind, explore_capacity,"
                        + " fulfillment_route, cash_price, validity_kind, seat_count, status, terms_version, revision,"
                        + " create_time, update_time) VALUES (?, ?, ?, 2, 0, 1, ?, 0, ?, ?, 'v1', ?, NOW(), NOW())",
                code, code, kind, new BigDecimal(price), seats, status, revision);
        return db.queryForObject("SELECT id FROM marketing_product WHERE product_code = ?", Long.class, code);
    }

    private void item(long productId, long topicId, String title, long revision) {
        db.update("INSERT INTO marketing_product_item (product_id, topic_id, topic_title, content_revision, sort_no, create_time)"
                + " VALUES (?, ?, ?, ?, 0, NOW())", productId, topicId, title, revision);
    }
}
