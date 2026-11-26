package com.chengyinhub.business.mapper;

import com.chengyinhub.business.domain.BizFunnelDaily;
import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.Configuration;
import org.apache.ibatis.session.SqlSession;
import org.apache.ibatis.session.SqlSessionFactory;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import java.io.InputStream;
import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.sql.Date;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 真实 MyBatis + H2 回归：试点窗口的核心分母不受帖文后续状态变化影响。
 * 两参 TIMESTAMP(date, time) 使用显式 H2 方言适配，不能代替真实 MySQL 对生产 XML 的验证。
 */
public class BizFunnelDailyMapperMyBatisTest {
    private static final String DAY_END = "23:59:59";

    @Test
    void pilotDenominatorSurvivesHideDeleteAndAuthorErasure() throws Exception {
        DriverManagerDataSource dataSource = dataSource();
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        createSchema(jdbc);
        insertPost(jdbc, 10L, 100L, "PUBLISHED");
        insertPost(jdbc, 20L, 200L, "PUBLISHED");
        insertQualifiedView(jdbc, 1L, 10L, LocalDateTime.of(2026, 9, 2, 10, 0));
        insertQualifiedView(jdbc, 1L, 10L, LocalDateTime.of(2026, 9, 3, 10, 0));
        insertQualifiedView(jdbc, 1L, 20L, LocalDateTime.of(2026, 9, 4, 10, 0));
        insertQualifiedView(jdbc, 2L, 20L, LocalDateTime.of(2026, 9, 5, 10, 0));

        try (SqlSession session = factory(dataSource).openSession(true)) {
            BizFunnelDailyMapper mapper = session.getMapper(BizFunnelDailyMapper.class);
            assertMetric(mapper.selectCommunityQualifiedPilotMetric("2026-09-01", "2026-09-28"),
                    2L, 3L, 2L, 2L);

            jdbc.update("update community_post set lifecycle = 'HIDDEN' where id = 10");
            session.clearCache();
            assertMetric(mapper.selectCommunityQualifiedPilotMetric("2026-09-01", "2026-09-28"),
                    2L, 3L, 2L, 2L);

            jdbc.update("delete from community_post where id = 10");
            session.clearCache();
            assertMetric(mapper.selectCommunityQualifiedPilotMetric("2026-09-01", "2026-09-28"),
                    2L, 3L, 2L, 1L);

            jdbc.update("update community_post set author_id = 0 where id = 20");
            session.clearCache();
            assertMetric(mapper.selectCommunityQualifiedPilotMetric("2026-09-01", "2026-09-28"),
                    2L, 3L, 2L, 0L);
        }
    }

    /**
     * 生产形状回归（2026-11-22 只读回读：general/roam_start 93 次 0 人）：带 member_id 的事件，
     * 无起点步骤的 general 漏斗、未先记起点的下游步骤，人数都必须 &gt; 0；转化率仍只按起点归因。
     * 同日重算幂等：删后重插结果不变。
     */
    @Test
    void dailyAggregateCountsIdentifiedUsersOnEveryStepAndIsIdempotent() throws Exception {
        DriverManagerDataSource dataSource = dataSource();
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        createSchema(jdbc);
        LocalDateTime day = LocalDateTime.of(2026, 11, 20, 9, 0);
        // general 漏斗：3 个会员共 5 次 roam_start，没有任何起点事件。
        for (long[] row : new long[][] {{1, 0}, {1, 5}, {2, 10}, {3, 15}, {3, 20}}) {
            insertEvent(jdbc, "roam_start", null, null, row[0], "310100", day.plusMinutes(row[1]));
        }
        // content_engagement：会员 4 先 view 后 like（归因），会员 5 只 like（未记起点）。
        insertEvent(jdbc, "content_view", "topic", 42L, 4L, "310100", day.plusMinutes(30));
        insertEvent(jdbc, "content_like", "topic", 42L, 4L, "310100", day.plusMinutes(31));
        insertEvent(jdbc, "content_like", "topic", 42L, 5L, "310100", day.plusMinutes(32));
        // 次日事件不得进入当日。
        insertEvent(jdbc, "roam_start", null, null, 9L, "310100", day.plusDays(1));

        try (SqlSession session = factory(dataSource).openSession(true)) {
            BizFunnelDailyMapper mapper = session.getMapper(BizFunnelDailyMapper.class);
            for (int run = 0; run < 2; run++) {
                mapper.deleteByStatDate("2026-11-20");
                assertEquals(3, mapper.insertFromEventLog("2026-11-20"));
                Map<String, Object> roam = funnelRow(jdbc, "roam_start");
                assertEquals(3L, ((Number) roam.get("USER_COUNT")).longValue(), "general 步骤必须计去重已识别用户");
                assertEquals(5L, ((Number) roam.get("EVENT_COUNT")).longValue());
                assertEquals(0, new java.math.BigDecimal("0").compareTo((java.math.BigDecimal) roam.get("CONVERSION_RATE")),
                        "无起点漏斗没有转化分母");
                Map<String, Object> like = funnelRow(jdbc, "content_like");
                assertEquals(2L, ((Number) like.get("USER_COUNT")).longValue(), "下游步骤人数不再受起点归因过滤");
                assertEquals(0, new java.math.BigDecimal("1.0000").compareTo((java.math.BigDecimal) like.get("CONVERSION_RATE")),
                        "转化率仍只计起点 cohort：1 个归因用户 / 1 个起点用户");
                Map<String, Object> view = funnelRow(jdbc, "content_view");
                assertEquals(1L, ((Number) view.get("USER_COUNT")).longValue());
                assertEquals(3, jdbc.queryForObject(
                        "select count(*) from biz_funnel_daily where stat_date = date '2026-11-20'", Integer.class),
                        "重算同一天不得叠加旧行");
            }
        }
    }

    /** 路线漏斗：有服务端事实的步骤只读事实表；同一 parent_order_no 多席算一单；自玩以外的单与局不进。 */
    @Test
    void routeFunnelReadsServerFactsPerDayAndTopic() throws Exception {
        DriverManagerDataSource dataSource = dataSource();
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        createSchema(jdbc);
        jdbc.update("insert into cms_topic(id, name) values (42, '老城夜游')");
        LocalDateTime day = LocalDateTime.of(2026, 11, 20, 10, 0);
        insertEvent(jdbc, "content_view", "topic", 42L, 1L, null, day);
        insertEvent(jdbc, "content_view", "topic", 42L, 1L, null, day.plusMinutes(1));
        insertEvent(jdbc, "content_view", "topic", 42L, 2L, null, day.plusMinutes(2));
        insertEvent(jdbc, "checkout_open", "topic", 42L, 1L, null, day.plusMinutes(3));
        // 会员 1：一单三席（同 parent_order_no），已付现金；会员 2：免单；会员 3：有人带票（不是自玩，排除）。
        insertRegistration(jdbc, 101L, "P-1", 1L, 2, 2, "30.00", day.plusMinutes(5));
        insertRegistration(jdbc, 102L, "P-1", 1L, 2, 2, "30.00", day.plusMinutes(5));
        insertRegistration(jdbc, 103L, "P-1", 1L, 2, 2, "30.00", day.plusMinutes(5));
        insertRegistration(jdbc, 104L, null, 2L, 2, 2, "0.00", day.plusMinutes(6));
        jdbc.update("insert into cms_registration(id, owner_type, owner_id, ticket_id, member_id, purchase_kind,"
                + " payable_amount, payment_status, registration_status, payment_time, create_time)"
                + " values (105, 1, 42, 7, 3, 1, 50.00, 2, 2, ?, ?)",
                Timestamp.valueOf(day), Timestamp.valueOf(day));
        jdbc.update("insert into topic_route_session(id, activity_id, topic_id, member_id, completed_at, create_time)"
                + " values (1, 0, 42, 1, ?, ?), (2, 0, 42, 2, null, ?), (3, 88, 42, 3, ?, ?)",
                Timestamp.valueOf(day.plusHours(2)), Timestamp.valueOf(day.plusHours(1)),
                Timestamp.valueOf(day.plusHours(1)),
                Timestamp.valueOf(day.plusHours(2)), Timestamp.valueOf(day.plusHours(1)));
        jdbc.update("insert into refund_application(id, source_type, source_id, del_flag, status, reviewed_at, create_time)"
                + " values (1, 'registration', 103, 0, 1, ?, ?), (2, 'registration', 104, 0, 0, null, ?)",
                Timestamp.valueOf(day.plusHours(3)), Timestamp.valueOf(day.plusHours(3)),
                Timestamp.valueOf(day.plusHours(3)));

        try (SqlSession session = factory(dataSource).openSession(true)) {
            BizFunnelDailyMapper mapper = session.getMapper(BizFunnelDailyMapper.class);
            Map<String, Map<String, Object>> steps = new java.util.HashMap<>();
            for (Map<String, Object> row : mapper.selectRouteFunnel("2026-11-20", "2026-11-21")) {
                assertEquals(42L, ((Number) row.get("TOPIC_ID")).longValue());
                assertEquals("老城夜游", row.get("TOPIC_NAME"));
                steps.put((String) row.get("STEP_CODE"), row);
            }
            assertStep(steps, "detail_view", 2, 3);
            assertStep(steps, "checkout_open", 1, 1);
            assertStep(steps, "order_created", 2, 2);
            assertStep(steps, "paid", 2, 2);
            assertStep(steps, "paid_cash", 1, 1);
            assertStep(steps, "play_started", 2, 2);
            assertStep(steps, "completed", 1, 1);
            assertStep(steps, "refunded", 1, 1);
            assertTrue(mapper.selectRouteFunnel("2026-11-21", "2026-11-22").isEmpty(), "窗口外不得计入");
        }
    }

    private static void assertStep(Map<String, Map<String, Object>> steps, String step, long members, long facts) {
        Map<String, Object> row = steps.get(step);
        assertTrue(row != null, "missing step " + step + " in " + steps.keySet());
        assertEquals(members, ((Number) row.get("MEMBER_COUNT")).longValue(), step + " members");
        assertEquals(facts, ((Number) row.get("FACT_COUNT")).longValue(), step + " facts");
    }

    private static Map<String, Object> funnelRow(JdbcTemplate jdbc, String step) {
        return jdbc.queryForMap("select * from biz_funnel_daily where step_code = ?", step);
    }

    private static void insertEvent(JdbcTemplate jdbc, String name, String bizType, Long bizId,
                                    long memberId, String cityCode, LocalDateTime occurredAt) {
        jdbc.update("insert into biz_event_log(event_name, biz_type, biz_id, member_id, city_code, occurred_at)"
                        + " values (?, ?, ?, ?, ?, ?)",
                name, bizType, bizId, memberId, cityCode, Timestamp.valueOf(occurredAt));
    }

    private static void insertRegistration(JdbcTemplate jdbc, long id, String parentOrderNo, long memberId,
                                           int paymentStatus, int registrationStatus, String payable,
                                           LocalDateTime paidAt) {
        jdbc.update("insert into cms_registration(id, parent_order_no, owner_type, owner_id, ticket_id, member_id,"
                        + " purchase_kind, expires_at, payable_amount, payment_status, registration_status,"
                        + " payment_time, create_time) values (?, ?, 1, 42, null, ?, 2, ?, ?, ?, ?, ?, ?)",
                id, parentOrderNo, memberId, Timestamp.valueOf(paidAt.plusDays(90)),
                new java.math.BigDecimal(payable), paymentStatus, registrationStatus,
                Timestamp.valueOf(paidAt), Timestamp.valueOf(paidAt.minusMinutes(1)));
    }

    private static void assertMetric(Map<String, Object> metric,
                                     long users,
                                     long userPosts,
                                     long posts,
                                     long currentAuthors) {
        assertEquals(users, number(metric, "QUALIFIED_USER_COUNT"));
        assertEquals(userPosts, number(metric, "QUALIFIED_USER_POST_COUNT"));
        assertEquals(posts, number(metric, "QUALIFIED_POST_COUNT"));
        assertEquals(currentAuthors, number(metric, "CURRENT_QUALIFIED_AUTHOR_COUNT"));
    }

    private static long number(Map<String, Object> metric, String key) {
        return ((Number) metric.get(key)).longValue();
    }

    private static DriverManagerDataSource dataSource() {
        DriverManagerDataSource dataSource = new DriverManagerDataSource();
        dataSource.setDriverClassName("org.h2.Driver");
        dataSource.setUrl("jdbc:h2:mem:community_funnel_" + UUID.randomUUID()
                + ";MODE=MySQL;DATABASE_TO_LOWER=FALSE;DB_CLOSE_DELAY=-1");
        dataSource.setUsername("sa");
        dataSource.setPassword("");
        return dataSource;
    }

    private static void createSchema(JdbcTemplate jdbc) {
        jdbc.execute("create alias FUNNEL_DAY_END for \""
                + BizFunnelDailyMapperMyBatisTest.class.getName() + ".dayEnd\"");
        jdbc.execute("create table biz_event_log("
                + "id bigint auto_increment primary key, event_name varchar(80), biz_type varchar(40),"
                + "biz_id bigint, member_id bigint, city_code varchar(40), occurred_at timestamp)");
        jdbc.execute("create table community_post("
                + "id bigint primary key, author_id bigint, lifecycle varchar(20))");
        jdbc.execute("create table biz_funnel_daily("
                + "id bigint auto_increment primary key, stat_date date, funnel_code varchar(64),"
                + "step_code varchar(64), source varchar(64), city_code varchar(40), user_count bigint,"
                + "event_count bigint, conversion_rate decimal(10,4), create_time timestamp, update_time timestamp)");
        jdbc.execute("create table cms_topic(id bigint primary key, name varchar(255))");
        jdbc.execute("create table cms_registration("
                + "id bigint primary key, parent_order_no varchar(40), owner_type int, owner_id bigint,"
                + "ticket_id bigint, member_id bigint, purchase_kind tinyint, expires_at timestamp,"
                + "payable_amount decimal(10,2), total_amount decimal(10,2), payment_status tinyint,"
                + "registration_status tinyint, payment_time timestamp, create_time timestamp)");
        jdbc.execute("create table topic_route_session("
                + "id bigint primary key, activity_id bigint, topic_id bigint, member_id bigint,"
                + "completed_at timestamp, create_time timestamp)");
        jdbc.execute("create table refund_application("
                + "id bigint primary key, source_type varchar(32), source_id bigint, del_flag tinyint,"
                + "status tinyint, reviewed_at timestamp, create_time timestamp)");
    }

    /** H2 没有 MySQL 两参 TIMESTAMP(date, time)；测试别名只补足本查询用到的当日最后一秒。 */
    public static Timestamp dayEnd(Date date, String time) {
        if (!DAY_END.equals(time)) {
            throw new IllegalArgumentException("unsupported time: " + time);
        }
        return Timestamp.valueOf(date.toLocalDate().atTime(LocalTime.parse(time)));
    }

    private static void insertPost(JdbcTemplate jdbc, long id, long authorId, String lifecycle) {
        jdbc.update("insert into community_post(id, author_id, lifecycle) values (?, ?, ?)",
                id, authorId, lifecycle);
    }

    private static void insertQualifiedView(JdbcTemplate jdbc,
                                            long memberId,
                                            long postId,
                                            LocalDateTime occurredAt) {
        jdbc.update("insert into biz_event_log(event_name, biz_type, biz_id, member_id, occurred_at) "
                        + "values ('community_post_qualified_view', 'community_post', ?, ?, ?)",
                postId, memberId, Timestamp.valueOf(occurredAt));
    }

    private static SqlSessionFactory factory(DriverManagerDataSource dataSource) throws Exception {
        Configuration configuration = new Configuration(new Environment(
                "community-funnel", new JdbcTransactionFactory(), dataSource));
        configuration.getTypeAliasRegistry().registerAlias("BizFunnelDaily", BizFunnelDaily.class);
        configuration.addMapper(BizFunnelDailyMapper.class);
        String resource = "mapper/business/BizFunnelDailyMapper.xml";
        try (InputStream input = BizFunnelDailyMapperMyBatisTest.class
                .getClassLoader().getResourceAsStream(resource)) {
            if (input == null) {
                throw new IllegalStateException("missing " + resource);
            }
            // H2 has no two-argument TIMESTAMP(date, time); route it to the FUNNEL_DAY_END alias above.
            // Keep production MySQL XML unchanged.
            String mysqlXml = new String(input.readAllBytes(), StandardCharsets.UTF_8);
            assertEquals(2, mysqlXml.split("timestamp\\(cast\\(", -1).length - 1,
                    "Review this narrow H2 grammar adapter if the production end-bound expressions change");
            // H2 has no MySQL null-safe equality operator; the standard spelling has the same semantics.
            String h2Xml = mysqlXml.replace("timestamp(cast(", "funnel_day_end(cast(")
                    .replace(" &lt;=> ", " is not distinct from ");
            assertTrue(h2Xml.contains("funnel_day_end(cast(#{endDate} as date), '" + DAY_END + "')"));
            new XMLMapperBuilder(new StringReader(h2Xml), configuration, resource,
                    configuration.getSqlFragments()).parse();
        }
        return new SqlSessionFactoryBuilder().build(configuration);
    }
}
