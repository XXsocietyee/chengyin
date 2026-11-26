package com.chengyinhub.business.it;

import com.chengyinhub.business.mapper.BizFunnelDailyMapper;
import com.chengyinhub.business.service.impl.AnalyticsEventServiceImpl;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.mybatis.spring.SqlSessionTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.util.ReflectionTestUtils;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * R7 路线与站点到访报告：真实 MySQL + 真实 mapper XML + 真实聚合服务。
 *
 * <p>夹具（主题 T=91001，2026-11-01..03，上海日）：
 * <ul>
 *   <li>两名玩家（81、82）11-01 开局，只有 81 完局 ⇒ 当天开局/完局/用时/玩家都是 {@code <3}；</li>
 *   <li>三名玩家（83、84、85）11-02 开局并完局（60/90/120 分钟）⇒ 3/3/90.0/3；</li>
 *   <li>商家站 B：三笔生效核销（一笔 PERK 档 = 权益兑换）+ 一笔已撤销（不计）；</li>
 *   <li>退款：主题本身一笔、由主题生成的活动一笔（11-02，合计 2 ⇒ {@code <3}），11-03 一笔，待审一笔（不计）⇒ 合计 3；</li>
 *   <li>站 C 只有一名玩家且其完成没有 checkin_time ⇒ 小格子抑制 + 无日期完成单列；主办方站无核销事实 ⇒ null（未知）；</li>
 *   <li>主题 U=91002 从未建路线局 ⇒ 开局列未知（null），不是 0。</li>
 * </ul>
 */
class RouteVisitorReportMyBatisTest {
    private static final String SUITE = "route_visitor_report";
    private static final long T = 91001L;
    private static final long U = 91002L;
    private static final long A = 92001L;
    private static final long B = 92002L;
    private static final long C = 92003L;
    private static final long U_NODE = 92011L;
    private static final long CHAPTER = 93001L;
    private static final long MERCHANT = 94001L;
    private static final LocalDate D1 = LocalDate.of(2026, 11, 1);
    private static final LocalDate D3 = LocalDate.of(2026, 11, 3);

    private static DriverManagerDataSource source;
    private static JdbcTemplate db;
    private static SqlSessionTemplate sql;
    private static AnalyticsEventServiceImpl service;

    @BeforeAll
    static void setup() throws Exception {
        assertEquals("127.0.0.1", MybatisItDatabase.host(), "只允许隔离的 loopback 测试库");
        source = P0AcceptanceSchema.dataSource(SUITE);
        db = new JdbcTemplate(source);
        assertTrue(db.queryForObject("select version()", String.class).startsWith("8.0."));
        P0AcceptanceSchema.baseTables(db, "cms_topic", "cms_topic_node", "cms_activity", "cms_registration",
                "player_node_progress", "redemption", "merchant_chapter_offer", "refund_application");
        P0AcceptanceSchema.createTableFromMigration(db, "migration_20260823_topic_route_graph.sql");
        // migration_20261118_fe_story_visit_gate.sql 加的到访时间列（快照早于该迁移）。
        db.execute("ALTER TABLE player_node_progress ADD COLUMN visit_time DATETIME NULL");
        sql = P0AcceptanceSchema.sql(source, "BizFunnelDailyMapper");
        service = new AnalyticsEventServiceImpl();
        ReflectionTestUtils.setField(service, "bizFunnelDailyMapper", sql.getMapper(BizFunnelDailyMapper.class));
        seed();
    }

    @AfterAll
    static void cleanup() {
        if (db != null) P0AcceptanceSchema.drop(db, SUITE);
    }

    private static void seed() {
        db.update("insert into cms_topic(id,name,del_flag) values(?,?,0),(?,?,0)", T, "梧桐路线", U, "线性老路线");
        db.update("insert into cms_topic_node(id,topic_id,chapter_id,name,sort_id,merchant_member_id,longitude,latitude) values"
                + "(?,?,0,'钟楼',1,null,'121.4737','31.2304'),(?,?,?,'梧桐咖啡',2,?,null,null),"
                + "(?,?,0,'=SUM(A1)',3,null,null,null),(?,?,0,'老站',1,null,null,null)",
                A, T, B, T, CHAPTER, MERCHANT, C, T, U_NODE, U);
        db.update("insert into cms_activity(id,topic_id,name,del_flag) values(97001,?,'梧桐路线·周末场',0)", T);

        // 路线局：81 完局、82 未完；83/84/85 次日 60/90/120 分钟完局。
        session(1, 81, "2026-11-01 10:00:00", "2026-11-01 11:30:00");
        session(2, 82, "2026-11-01 10:30:00", null);
        session(3, 83, "2026-11-02 09:00:00", "2026-11-02 10:00:00");
        session(4, 84, "2026-11-02 09:00:00", "2026-11-02 10:30:00");
        session(5, 85, "2026-11-02 09:00:00", "2026-11-02 11:00:00");

        // 站点进度：每 member×activity×node 一行。
        progress(81, T, A, 1, "2026-11-01 10:10:00", "2026-11-01 10:20:00", 0);
        progress(82, T, A, 0, "2026-11-01 10:40:00", null, 0);
        progress(81, T, C, 1, "2026-11-01 11:00:00", null, 0);
        for (long member = 83; member <= 85; member++) {
            progress(member, T, A, 1, "2026-11-02 09:10:00", "2026-11-02 09:15:00", 0);
            progress(member, T, B, 1, "2026-11-02 09:30:00", "2026-11-02 09:40:00", 0);
        }
        progress(86, T, A, 1, "2026-11-02 09:10:00", "2026-11-02 09:15:00", 2);
        progress(87, U, U_NODE, 1, "2026-11-02 12:00:00", "2026-11-02 12:05:00", 0);

        for (long member = 82; member <= 85; member++) {
            registration(95000 + member, member, 1, T, 2);
        }
        registration(95088, 88, 1, T, 4);
        registration(95089, 89, 2, 97001, 4);
        registration(95090, 90, 1, T, 4);
        db.update("insert into merchant_chapter_offer(id,topic_id,chapter_id,merchant_id,perk_id,quota_total,quota_used,status,terms_mode)"
                + " values(96001,?,?,?,1,10,1,1,'PERK')", T, CHAPTER, MERCHANT);
        redemption(95083, 96001L, "ACTIVE");
        redemption(95084, null, "ACTIVE");
        redemption(95085, null, "ACTIVE");
        redemption(95082, null, "REVERSED");

        refund("RF1", 95088, 1, T, 1, "2026-11-02 15:00:00");
        refund("RF2", 95089, 2, 97001, 1, "2026-11-02 16:00:00");
        refund("RF3", 95090, 1, T, 1, "2026-11-03 09:00:00");
        refund("RF4", 95090, 1, T, 0, null);
    }

    private static void session(long id, long member, String created, String completed) {
        db.update("insert into topic_route_session(id,activity_id,topic_id,member_id,play_instance_id,config_version,"
                + "config_snapshot_json,state_json,status,seed,version,completed_at,create_time,update_time)"
                + " values(?,0,?,?,'default',1,'{}','{}',?,1,0,?,?,?)",
                id, T, member, completed == null ? 0 : 1, completed, created, created);
    }

    private static void progress(long member, long topic, long node, int status, String created, String checkin, int delFlag) {
        db.update("insert into player_node_progress(member_id,activity_id,topic_id,node_id,status,checkin_time,"
                + "create_time,latitude,longitude,del_flag) values(?,0,?,?,?,?,?,'31.2304','121.4737',?)",
                member, topic, node, status, checkin, created, delFlag);
    }

    private static void registration(long id, long member, int ownerType, long ownerId, int paymentStatus) {
        db.update("insert into cms_registration(id,registration_no,owner_type,owner_id,ticket_id,ticket_price,member_id,"
                + "original_amount,total_amount,payable_amount,pay_expire_time,payment_status,registration_status,create_time)"
                + " values(?,?,?,?,1,39.00,?,39.00,39.00,39.00,'2026-11-01 00:00:00',?,2,'2026-10-30 10:00:00')",
                id, "RV" + id, ownerType, ownerId, member, paymentStatus);
    }

    private static void redemption(long registration, Long offer, String status) {
        db.update("insert into redemption(registration_id,chapter_id,topic_id,merchant_id,offer_id,operator_id,status,"
                + "idempotency_key,create_time) values(?,?,?,?,?,?,?,?,'2026-11-02 12:00:00')",
                registration, CHAPTER, T, MERCHANT, offer, MERCHANT, status,
                "redeem:" + registration + ":" + CHAPTER + ":" + MERCHANT);
    }

    private static void refund(String no, long registration, int ownerType, long ownerId, int status, String reviewedAt) {
        db.update("insert into refund_application(refund_no,source_type,source_id,owner_type,owner_id,paid_amount,"
                + "refund_amount,status,reviewed_at,del_flag) values(?,'registration',?,?,?,39.00,39.00,?,?,0)",
                no, registration, ownerType, ownerId, status, reviewedAt);
    }

    @Test
    @SuppressWarnings("unchecked")
    void routeDaysCountRunsAndSuppressTwoPlayerDay() {
        Map<String, Object> report = service.routeVisitorReport(T, D1, D3);
        assertEquals("TOPIC_ROUTE_SESSION", report.get("runsSource"));
        List<Map<String, Object>> days = (List<Map<String, Object>>) report.get("routeDays");
        assertEquals(3, days.size(), "窗口内每天一行，空日是确知的 0");

        Map<String, Object> d1 = days.get(0);
        assertEquals("2026-11-01", d1.get("date"));
        assertEquals("<3", d1.get("runsStarted"), "两名玩家开局：小格子");
        assertEquals("<3", d1.get("runsCompleted"));
        assertEquals("<3", d1.get("avgDurationMinutes"));
        assertEquals("<3", d1.get("players"));

        Map<String, Object> d2 = days.get(1);
        assertEquals(3L, d2.get("runsStarted"));
        assertEquals(3L, d2.get("runsCompleted"));
        assertEquals(new BigDecimal("90.0"), d2.get("avgDurationMinutes"));
        assertEquals(3L, d2.get("players"));
        assertEquals("<3", d2.get("refunds"), "主题退款 + 活动退款 = 2");

        Map<String, Object> d3 = days.get(2);
        assertEquals(0L, d3.get("runsStarted"));
        assertEquals(0L, d3.get("players"));
        assertNull(d3.get("avgDurationMinutes"), "当天没有完局 ⇒ 用时未知，不是 0");

        Map<String, Object> total = (Map<String, Object>) report.get("routeTotal");
        assertEquals(5L, total.get("runsStarted"));
        assertEquals(4L, total.get("runsCompleted"), "82 没完局");
        assertEquals(new BigDecimal("90.0"), total.get("avgDurationMinutes"));
        assertEquals(5L, total.get("players"));
        assertEquals(3L, total.get("refunds"), "待审退款不计");
    }

    @Test
    @SuppressWarnings("unchecked")
    void stationsUseProgressAndRedemptionWithoutDoubleCounting() {
        Map<String, Object> report = service.routeVisitorReport(T, D1, D3);
        Map<Long, Map<String, Object>> stations = new LinkedHashMap<>();
        for (Map<String, Object> row : (List<Map<String, Object>>) report.get("stations")) {
            stations.put((Long) row.get("nodeId"), row);
        }
        assertEquals(List.of(A, B, C), List.copyOf(stations.keySet()), "按站点排序");

        Map<String, Object> a = stations.get(A);
        assertEquals(5L, a.get("arrivals"), "del_flag=2 的行不计");
        assertEquals(4L, a.get("completions"), "82 只到访未完成");
        assertNull(a.get("verifications"), "主办方站没有核销事实 ⇒ 未知");
        assertEquals(5L, a.get("players"));

        Map<String, Object> b = stations.get(B);
        assertEquals(3L, b.get("verifications"), "撤销的核销不计");
        assertEquals(1L, b.get("perkRedemptions"), "只有 PERK 档 offer 是权益兑换");
        assertEquals(3L, b.get("players"));

        Map<String, Object> c = stations.get(C);
        assertEquals("<3", c.get("arrivals"));
        assertEquals(0L, c.get("completions"), "没有 checkin_time 的完成不落任何一天");
        assertEquals("<3", c.get("undatedCompletions"));
        assertEquals("=SUM(A1)", c.get("stationName"));

        List<Map<String, Object>> cells = (List<Map<String, Object>>) report.get("stationDays");
        Map<String, Map<String, Object>> byKey = new HashMap<>();
        for (Map<String, Object> cell : cells) byKey.put(cell.get("date") + "/" + cell.get("nodeId"), cell);
        assertEquals("<3", byKey.get("2026-11-01/" + A).get("arrivals"), "两名玩家的站点日格子");
        assertEquals("<3", byKey.get("2026-11-01/" + A).get("completions"));
        Map<String, Object> bDay = byKey.get("2026-11-02/" + B);
        assertEquals(3L, bDay.get("arrivals"));
        assertEquals(3L, bDay.get("completions"));
        assertEquals(3L, bDay.get("verifications"));
        assertEquals(1L, bDay.get("perkRedemptions"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void topicWithoutRouteSessionsShowsRunsAsUnknown() {
        Map<String, Object> report = service.routeVisitorReport(U, D1, D3);
        assertEquals("UNKNOWN_NO_ROUTE_SESSION", report.get("runsSource"));
        for (Map<String, Object> day : (List<Map<String, Object>>) report.get("routeDays")) {
            assertNull(day.get("runsStarted"), "没有路线局事实源 ⇒ 未知，不是 0");
            assertNull(day.get("players"));
            assertEquals(0L, day.get("refunds"));
        }
        List<Map<String, Object>> cells = (List<Map<String, Object>>) report.get("stationDays");
        assertEquals(1, cells.size());
        assertEquals("<3", cells.get(0).get("arrivals"));
    }

    @Test
    void responseAndExportCarryNoMemberIdsCoordinatesOrTimes() {
        String json = String.valueOf(service.routeVisitorReport(T, D1, D3));
        String csv = service.routeVisitorReportCsv(T, D1, D3);
        for (String text : new String[]{json, csv}) {
            for (String member : new String[]{"=81", "=82", "=83", "member", "9500", "94001"}) {
                assertFalse(text.contains(member), "不得出现玩家/商家/报名标识 " + member + ":" + text);
            }
            assertFalse(text.contains("121.47") || text.contains("31.23"), "不得出现坐标");
            assertFalse(text.matches("(?s).*\\d{2}:\\d{2}.*"), "时间粒度不得细于天");
        }
        assertTrue(csv.startsWith("﻿"), "Excel 打开中文不乱码");
        assertTrue(csv.contains("'=SUM(A1)"), "站点名不得作为表格公式执行");
        assertTrue(csv.contains("2026-11-03,0,0,—,0,<3"), "未知用破折号，确知的 0 仍是 0:" + csv);
    }

    @Test
    void reportStatementsPassTheApplicationWall() {
        com.alibaba.druid.wall.WallConfig config = new com.alibaba.druid.wall.WallConfig(
                com.alibaba.druid.wall.spi.MySqlWallProvider.DEFAULT_CONFIG_DIR);
        config.setMultiStatementAllow(false);
        com.alibaba.druid.wall.spi.MySqlWallProvider wall = new com.alibaba.druid.wall.spi.MySqlWallProvider(config);
        org.apache.ibatis.session.Configuration mybatis = sql.getConfiguration();
        String ns = "com.chengyinhub.business.mapper.BizFunnelDailyMapper.";
        for (boolean byDay : new boolean[]{true, false}) {
            Map<String, Object> params = new HashMap<>();
            params.put("topicId", T);
            params.put("from", new Date());
            params.put("to", new Date());
            params.put("byDay", byDay);
            for (String id : new String[]{"selectRouteVisitorTopic", "countRouteVisitorSessions",
                    "selectRouteVisitorRunStats", "selectRouteVisitorRefundDaily", "selectRouteVisitorStations",
                    "selectRouteVisitorStationStats", "selectRouteVisitorUndatedCompletions"}) {
                String bound = mybatis.getMappedStatement(ns + id).getBoundSql(params).getSql();
                assertTrue(wall.check(bound).getViolations().isEmpty(), id + " 被 wall 拒:" + wall.check(bound).getViolations());
            }
        }
    }
}
