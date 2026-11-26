package com.chengyinhub.business.it;

import com.chengyinhub.business.domain.CmsTopic;
import com.chengyinhub.business.domain.SeatRecipientFact;
import com.chengyinhub.business.domain.UmsMember;
import com.chengyinhub.business.domain.dto.ChannelRedeemResult;
import com.chengyinhub.business.domain.dto.ChannelVoucherRevokeRequest;
import com.chengyinhub.business.domain.dto.ChannelVoucherView;
import com.chengyinhub.business.domain.dto.PlatformCodeIssueRequest;
import com.chengyinhub.business.domain.dto.SeatInvitationClaimRequest;
import com.chengyinhub.business.domain.dto.SeatInvitationCreateRequest;
import com.chengyinhub.business.domain.dto.SeatPhoneTransferRequest;
import com.chengyinhub.business.domain.vo.SeatInvitationVO;
import com.chengyinhub.business.mapper.ChannelVoucherMapper;
import com.chengyinhub.business.mapper.CmsActivityMapper;
import com.chengyinhub.business.mapper.CmsRegistrationMapper;
import com.chengyinhub.business.mapper.CmsTopicMapper;
import com.chengyinhub.business.mapper.CoopSettlementOriginalMapper;
import com.chengyinhub.business.mapper.MerchantReferralBountyMapper;
import com.chengyinhub.business.mapper.MarketingCodeGrantMapper;
import com.chengyinhub.business.mapper.MarketingProductMapper;
import com.chengyinhub.business.mapper.RegistrationSeatInvitationMapper;
import com.chengyinhub.business.mapper.RegistrationSeatInvitationRequestMapper;
import com.chengyinhub.business.mapper.RegistrationSeatMapper;
import com.chengyinhub.business.mapper.UmsMemberMapper;
import com.chengyinhub.business.service.ICmsTopicService;
import com.chengyinhub.business.service.IMarketingGiftPlayEligibility;
import com.chengyinhub.business.service.IProductRoleService;
import com.chengyinhub.business.service.impl.PlatformCodeServiceImpl;
import com.chengyinhub.business.service.impl.RegistrationSeatInvitationServiceImpl;
import com.chengyinhub.business.service.impl.SettlementEntryServiceImpl;
import com.chengyinhub.business.service.impl.TeamGroupServiceImpl;
import com.chengyinhub.business.service.support.CodeGrantSeatOrder;
import com.chengyinhub.common.exception.ServiceException;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.sql.Connection;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * DEC-F17 真库:N 座平台码兑换 → 恰好一张 ¥0 已付锚单 → 既有席位邀请(分享链接 + 按手机号转赠)原样可用;
 * 撤码作废锚单,待领取/已领取席位与退款同一口径失效;锚单不进退款、核销结算、原始现金冻结、商户推荐奖励。
 *
 * <p>真实 PlatformCodeServiceImpl + RegistrationSeatInvitationServiceImpl + 真 mapper XML + 本 PR 迁移原文。
 * 主题/商品归属/礼品/活动读侧是桩(不属于本证明)。每次服务调用包在真事务里(FOR UPDATE 生效)。
 * 一类一库,跑完 DROP DATABASE 并回读不存在。
 */
@EnabledIfEnvironmentVariable(named = "CHENGYIN_MARKETING_DB_IT_APPROVED", matches = "1")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class PlatformCodeSeatOrderMySqlIT {

    private static final long OPERATOR = 1L;
    private static final long TOPIC = 7701L;
    private static final long TOPIC_OWNER = 8801L;
    private static final long OWNER = 9101L;
    private static final long FRIEND = 9102L;
    private static final long PHONE_FRIEND = 9103L;
    private static final String FRIEND_PHONE = "13800138000";

    private final String suite = "f17seat_" + UUID.randomUUID().toString().replace("-", "").substring(0, 10);

    private JdbcTemplate db;
    private TransactionTemplate tx;
    private CmsRegistrationMapper registrations;
    private RegistrationSeatInvitationMapper invitations;
    private MerchantReferralBountyMapper bounty;
    private CoopSettlementOriginalMapper originals;
    private TeamGroupServiceImpl refunds;
    private PlatformCodeServiceImpl codes;
    private RegistrationSeatInvitationServiceImpl seats;
    private long seat2ProductId;
    private long seat4ProductId;

    @BeforeAll
    void schemaAndRealServices() throws Exception {
        assertTrue(List.of("127.0.0.1", "localhost").contains(MybatisItDatabase.host()), "只许连一次性 scratch MySQL");
        DriverManagerDataSource source = P0AcceptanceSchema.dataSource(suite);
        db = new JdbcTemplate(source);
        tx = new TransactionTemplate(new DataSourceTransactionManager(source));
        assertEquals(MybatisItDatabase.databaseName(suite), db.queryForObject("SELECT DATABASE()", String.class));

        P0AcceptanceSchema.baseTables(db, "cms_registration", "cms_registration_scan");
        P0AcceptanceSchema.migrations(source,
                "migration_20260919_cms_registration_selfplay_ticket_columns_nullable.sql",
                "migration_20260930_registration_first_successful_scan.sql",
                "migration_marketing_product_20261108.sql");
        db.execute("CREATE TABLE IF NOT EXISTS oms_ticket (id BIGINT NOT NULL, PRIMARY KEY (id))");
        P0AcceptanceSchema.migrations(source, "migration_marketing_z_channel_voucher_20261108.sql",
                "migration_z_channel_voucher_snapshot_20261109.sql",
                "migration_20261122_platform_code_grant.sql");
        try (Connection connection = source.getConnection()) {
            // 人工退款工单表(席位守卫 hasActiveManualRefundCaseForUpdate 读它):与 RegistrationSeatMySqlIT 同一组原文迁移。
            ItSchema.applyMigrations(connection, "sql/migration_event_cancel_manual_refund_case_20260826.sql",
                    "sql/migration_manual_refund_case_topic_20260918.sql",
                    "sql/migration_partial_chapter_aftercare_20261002.sql",
                    "sql/migration_20261108_registration_seat_invitation.sql",
                    "sql/migration_20261124_seat_invitation_phone_transfer.sql");
        }

        var sql = P0AcceptanceSchema.sql(source, "CmsRegistrationMapper", "MarketingProductMapper",
                "ChannelVoucherMapper", "MarketingCodeGrantMapper", "RegistrationSeatInvitationMapper",
                "RegistrationSeatInvitationRequestMapper", "MerchantReferralBountyMapper", "CoopSettlementOriginalMapper");
        registrations = sql.getMapper(CmsRegistrationMapper.class);
        bounty = sql.getMapper(MerchantReferralBountyMapper.class);
        originals = sql.getMapper(CoopSettlementOriginalMapper.class);
        invitations = sql.getMapper(RegistrationSeatInvitationMapper.class);

        CmsTopic topic = new CmsTopic();
        topic.setId(TOPIC);
        topic.setName("城墙夜游");
        topic.setSelfPlayPrice(new BigDecimal("39.00"));
        topic.setFeePlatformRate(new BigDecimal("0.1000"));
        topic.setMemberId(TOPIC_OWNER);
        ICmsTopicService topicService = mock(ICmsTopicService.class);
        when(topicService.selectCmsTopicById(TOPIC)).thenReturn(topic);
        CmsTopicMapper topicMapper = mock(CmsTopicMapper.class);
        when(topicMapper.selectCmsTopicByIdForUpdate(TOPIC)).thenReturn(topic);
        when(topicMapper.selectCmsTopicById(TOPIC)).thenReturn(topic);
        IProductRoleService roles = mock(IProductRoleService.class);
        when(roles.isPlatformOwned(anyLong())).thenReturn(true);

        codes = new PlatformCodeServiceImpl(sql.getMapper(ChannelVoucherMapper.class),
                sql.getMapper(MarketingCodeGrantMapper.class), sql.getMapper(MarketingProductMapper.class),
                roles, topicService, registrations, true);
        seats = new RegistrationSeatInvitationServiceImpl(registrations, mock(CmsActivityMapper.class), topicMapper,
                mock(RegistrationSeatMapper.class), invitations,
                sql.getMapper(RegistrationSeatInvitationRequestMapper.class),
                mock(IMarketingGiftPlayEligibility.class), "f17-it-secret-0123456789abcdef", 168L);
        UmsMemberMapper members = mock(UmsMemberMapper.class);
        UmsMember phoneFriend = new UmsMember();
        phoneFriend.setId(PHONE_FRIEND);
        phoneFriend.setPhone(FRIEND_PHONE);
        when(members.selectUmsMemberById(PHONE_FRIEND)).thenReturn(phoneFriend);
        seats.setMembers(members);
        refunds = new TeamGroupServiceImpl();
        ReflectionTestUtils.setField(refunds, "cmsRegistrationMapper", registrations);
        ReflectionTestUtils.setField(refunds, "cmsActivityMapper", mock(CmsActivityMapper.class));
        ReflectionTestUtils.setField(refunds, "cmsTopicMapper", topicMapper);

        seat2ProductId = product(2);
        seat4ProductId = product(4);
    }

    @AfterAll
    void drop() {
        if (db != null) P0AcceptanceSchema.drop(db, suite);
    }

    @BeforeEach
    void clean() {
        db.update("DELETE FROM cms_registration_seat_invitation_request");
        db.update("DELETE FROM cms_registration_seat_invitation");
        db.update("DELETE FROM cms_registration_scan");
        db.update("DELETE FROM cms_registration");
        db.update("DELETE FROM marketing_code_grant");
        db.update("DELETE FROM marketing_channel_voucher");
    }

    @Test
    void redeemCreatesExactlyOneZeroPaidOrderWithTheProductSeats() {
        long voucherId = issue(seat2ProductId, "issue-a");
        ChannelRedeemResult result = inTx(() -> codes.redeem(OWNER, voucherId, "redeem-a", "fp-a"));
        assertEquals(Integer.valueOf(2), result.getSeatCount());

        Map<String, Object> row = db.queryForMap("SELECT * FROM cms_registration WHERE create_by='platform-code' AND request_id=?", key(voucherId));
        assertEquals(OWNER, ((Number) row.get("member_id")).longValue());
        assertEquals(1L, ((Number) row.get("owner_type")).longValue());
        assertEquals(TOPIC, ((Number) row.get("owner_id")).longValue());
        assertEquals(2L, ((Number) row.get("order_num")).longValue());
        assertEquals(2, ((Number) row.get("purchase_kind")).intValue());
        assertEquals(2, ((Number) row.get("payment_status")).intValue());
        assertEquals(2, ((Number) row.get("registration_status")).intValue());
        for (String money : List.of("original_amount", "discount_amount", "total_amount", "payable_amount",
                "point_deduct_amount", "point_payment_amount", "wechat_payment_amount")) {
            assertEquals(0, BigDecimal.ZERO.compareTo((BigDecimal) row.get(money)), money);
        }
        assertEquals(0L, ((Number) row.get("point_used")).longValue());
        assertNull(row.get("transaction_id"));
        assertNull(row.get("ticket_id"));
        assertNull(row.get("refund_deadline"));
        assertNotNull(row.get("expires_at"), "锚单到期 = 授权 valid_to");
        assertEquals(1, count("SELECT COUNT(*) FROM cms_registration"));
    }

    @Test
    void replayAndDirectDuplicateNeverCreateASecondOrder() {
        long voucherId = issue(seat2ProductId, "issue-b");
        inTx(() -> codes.redeem(OWNER, voucherId, "redeem-b", "fp-b"));
        assertTrue(inTx(() -> codes.redeem(OWNER, voucherId, "redeem-b", "fp-b")).getReplayed());
        assertTrue(inTx(() -> codes.redeem(OWNER, voucherId, "redeem-b2", "fp-b2")).getReplayed());
        assertEquals(1, count("SELECT COUNT(*) FROM cms_registration WHERE create_by='platform-code' AND request_id='" + key(voucherId) + "'"));

        // 既有唯一键 uk_reg_member_request 是最后一道闸:绕过服务直接再插同码同人锚单被库拒绝。
        assertThrows(DataAccessException.class, () -> db.update(
                "INSERT INTO cms_registration (registration_no, owner_type, owner_id, member_id, original_amount,"
                        + " total_amount, payable_amount, pay_expire_time, request_id, create_by)"
                        + " VALUES ('CDUP', 1, ?, ?, 0, 0, 0, NOW(), ?, 'platform-code')", TOPIC, OWNER, key(voucherId)));
        assertEquals(1, count("SELECT COUNT(*) FROM cms_registration"));
    }

    @Test
    void seatsTransferAndClaimThroughTheExistingInvitationFlows() {
        long voucherId = issue(seat4ProductId, "issue-c");
        inTx(() -> codes.redeem(OWNER, voucherId, "redeem-c", "fp-c"));
        long registrationId = registrationOf(voucherId);

        SeatInvitationVO link = inTx(() -> seats.invite(OWNER, invite(registrationId, "inv-1")));
        assertNotNull(link.getToken());
        SeatInvitationVO claimed = inTx(() -> seats.claim(FRIEND, claim(link.getToken(), "claim-1")));
        assertEquals(Long.valueOf(FRIEND), claimed.getInviteeMemberId());
        List<SeatRecipientFact> facts = invitations.selectClaimedFactsByRecipient(FRIEND, 1L, TOPIC);
        assertEquals(1, facts.size());
        assertEquals(Long.valueOf(registrationId), facts.get(0).getRegistrationId());

        inTx(() -> seats.transferByPhone(OWNER, phone(registrationId, "phone-1")));
        List<SeatInvitationVO> byPhone = inTx(() -> seats.claimByVerifiedPhone(PHONE_FRIEND));
        assertEquals(1, byPhone.size());
        assertEquals(1, invitations.selectClaimedFactsByRecipient(PHONE_FRIEND, 1L, TOPIC).size());
        assertEquals(2, count("SELECT COUNT(*) FROM cms_registration_seat_invitation WHERE status=1"));
    }

    @Test
    void revokeVoidsTheOrderAndItsPendingAndClaimedSeatsLikeARefund() {
        long voucherId = issue(seat4ProductId, "issue-d");
        inTx(() -> codes.redeem(OWNER, voucherId, "redeem-d", "fp-d"));
        long registrationId = registrationOf(voucherId);
        SeatInvitationVO link = inTx(() -> seats.invite(OWNER, invite(registrationId, "inv-d1")));
        inTx(() -> seats.claim(FRIEND, claim(link.getToken(), "claim-d1")));
        SeatInvitationVO pendingLink = inTx(() -> seats.invite(OWNER, invite(registrationId, "inv-d2")));
        inTx(() -> seats.transferByPhone(OWNER, phone(registrationId, "phone-d")));

        inTx(() -> codes.revoke(OPERATOR, voucherId, revokeRequest()));

        Map<String, Object> row = db.queryForMap("SELECT registration_status, payment_status FROM cms_registration WHERE id=?",
                registrationId);
        assertEquals(3, ((Number) row.get("registration_status")).intValue());
        assertEquals(3, ((Number) row.get("payment_status")).intValue());
        // 已领取:可玩事实与「我的票」立即消失(与整单退款同一读侧口径)。
        assertTrue(invitations.selectClaimedFactsByRecipient(FRIEND, 1L, TOPIC).isEmpty());
        assertTrue(invitations.selectClaimedByRecipient(FRIEND).isEmpty());
        // 待领取:分享链接与手机号转赠都不能再领;购票人也不能再发。
        assertThrows(ServiceException.class, () -> inTx(() -> seats.claim(PHONE_FRIEND + 1,
                claim(pendingLink.getToken(), "claim-d2"))));
        assertTrue(inTx(() -> seats.claimByVerifiedPhone(PHONE_FRIEND)).isEmpty());
        assertThrows(ServiceException.class, () -> inTx(() -> seats.invite(OWNER, invite(registrationId, "inv-d3"))));
        // 撤码幂等、不复活:再撤不变,本人再兑被拒且不新建锚单。
        inTx(() -> codes.revoke(OPERATOR, voucherId, revokeRequest()));
        assertThrows(RuntimeException.class, () -> inTx(() -> codes.redeem(OWNER, voucherId, "redeem-d", "fp-d")));
        assertEquals(1, count("SELECT COUNT(*) FROM cms_registration"));
        assertEquals(3, count("SELECT registration_status FROM cms_registration WHERE id=" + registrationId));
    }

    @Test
    void theZeroOrderNeverReachesRefundSettlementOrBountyMoneyPaths() {
        long voucherId = issue(seat2ProductId, "issue-e");
        inTx(() -> codes.redeem(OWNER, voucherId, "redeem-e", "fp-e"));
        long anchorId = registrationOf(voucherId);
        // 对照:同主题一张真实付费单(¥10),同一商家核销。
        db.update("INSERT INTO cms_registration (registration_no, owner_type, owner_id, topic_id, member_id, order_num,"
                + " purchase_kind, original_amount, total_amount, payable_amount, wechat_payment_amount, payment_status,"
                + " registration_status, pay_expire_time, transaction_id, create_by, create_time)"
                + " VALUES ('RPAID1', 1, ?, ?, 9201, 1, 2, 10, 10, 10, 10, 2, 2, NOW(), 'TXPAID1', '9201', NOW())", TOPIC, TOPIC);
        long paidId = db.queryForObject("SELECT id FROM cms_registration WHERE registration_no='RPAID1'", Long.class);
        long merchant = 5501L;
        // 核销时刻与查询窗口都由 JVM 传入,同一连接时区换算,不依赖 MySQL NOW() 与 JVM 时区一致。
        java.util.Date scannedAt = new java.util.Date();
        for (long id : new long[] {anchorId, paidId}) {
            db.update("INSERT INTO cms_registration_scan (registration_type, registration_id, member_id, status, create_time)"
                    + " VALUES (1, ?, ?, 0, ?)", id, merchant, scannedAt);
        }
        java.util.Date from = new java.util.Date(scannedAt.getTime() - 3_600_000L);
        java.util.Date to = new java.util.Date(scannedAt.getTime() + 3_600_000L);

        // 商户推荐奖励:¥0 锚单不是付费人头,四处同口径排除。
        assertEquals(1, bounty.countVerifiedHeadsByMerchantInWindow(merchant, from, to));
        assertEquals(0, new BigDecimal("10.00").compareTo(bounty.sumVerifiedPaidByMerchantInWindow(merchant, from, to)));
        assertEquals(List.of(paidId), bounty.selectVerifiedRegistrationIdsByMerchantInWindow(merchant, from, to, 10));
        assertEquals(1, bounty.countStillValidAmong(List.of(anchorId, paidId), merchant));

        // 主题原始现金冻结读到锚单时带着来源标记,生产者据此跳过(不当付款人)。
        List<com.chengyinhub.business.domain.CmsRegistration> locked =
                inTx(() -> originals.selectOriginalRegistrationsForUpdate(TOPIC));
        assertEquals(2, locked.size());
        assertEquals(1, locked.stream().filter(CodeGrantSeatOrder::isCodeGranted).count());
        assertEquals(Long.valueOf(anchorId), locked.stream().filter(CodeGrantSeatOrder::isCodeGranted)
                .findFirst().orElseThrow().getId());

        // 核销结算入口:不入账、不落结算认领(依赖未注入也不会被触达)。
        com.chengyinhub.business.domain.CmsRegistration anchor = registrations.selectCmsRegistrationById(anchorId);
        assertTrue(CodeGrantSeatOrder.isCodeGranted(anchor));
        assertEquals(0, new SettlementEntryServiceImpl().recordPaidRegistration(anchor, merchant));

        // 自助退款 / 主理人清退:一律 409,锚单原样 2/2。
        ServiceException self = assertThrows(ServiceException.class,
                () -> inTx(() -> refunds.cancelPaidRegistration(anchorId, OWNER)));
        assertEquals(Integer.valueOf(409), self.getCode());
        assertThrows(ServiceException.class, () -> inTx(() -> refunds.cancelPaidRegistrationByOwner(anchorId, TOPIC_OWNER)));
        Map<String, Object> row = db.queryForMap(
                "SELECT registration_status, payment_status FROM cms_registration WHERE id=?", anchorId);
        assertEquals(2, ((Number) row.get("registration_status")).intValue());
        assertEquals(2, ((Number) row.get("payment_status")).intValue());
    }

    // ---------------------------------------------------------------- helpers

    private long product(int seats) {
        db.update("INSERT INTO marketing_product (product_code, product_name, product_kind, purchase_kind,"
                        + " explore_capacity, fulfillment_route, cash_price, validity_kind, valid_days, seat_count,"
                        + " gift_allowed, status, terms_version, revision, create_time, update_time)"
                        + " VALUES (?, ?, 1, 2, 0, 1, ?, 1, 30, ?, 0, 1, 'SEAT_SELF_PLAY_20261124', 1, NOW(), NOW())",
                "SEAT" + seats + "-T" + TOPIC, "城墙夜游·" + seats + "人票", new BigDecimal(seats * 30 + ".90"), seats);
        long id = db.queryForObject("SELECT id FROM marketing_product WHERE product_code=?", Long.class,
                "SEAT" + seats + "-T" + TOPIC);
        db.update("INSERT INTO marketing_product_item (product_id, topic_id, topic_title, content_revision, sort_no,"
                + " create_time) VALUES (?, ?, '城墙夜游', 1, 0, NOW())", id, TOPIC);
        return id;
    }

    private long issue(long productId, String requestId) {
        PlatformCodeIssueRequest request = new PlatformCodeIssueRequest();
        request.setRequestId(requestId);
        request.setProductId(productId);
        request.setBatchSize(1);
        request.setQuantity(1);
        List<ChannelVoucherView> views = inTx(() -> codes.issue(OPERATOR, request));
        assertEquals(1, views.size());
        return views.get(0).getId();
    }

    private long registrationOf(long voucherId) {
        return db.queryForObject("SELECT id FROM cms_registration WHERE create_by='platform-code' AND request_id=?",
                Long.class, key(voucherId));
    }

    private static String key(long voucherId) {
        return "PCG:" + voucherId + ":" + TOPIC;
    }

    private <T> T inTx(Supplier<T> work) {
        return tx.execute(status -> work.get());
    }

    private int count(String sql) {
        Integer n = db.queryForObject(sql, Integer.class);
        return n == null ? 0 : n;
    }

    private static SeatInvitationCreateRequest invite(long registrationId, String requestId) {
        SeatInvitationCreateRequest r = new SeatInvitationCreateRequest();
        r.setRegistrationId(registrationId);
        r.setRequestId(requestId);
        return r;
    }

    private static SeatInvitationClaimRequest claim(String token, String requestId) {
        SeatInvitationClaimRequest r = new SeatInvitationClaimRequest();
        r.setToken(token);
        r.setRequestId(requestId);
        return r;
    }

    private static SeatPhoneTransferRequest phone(long registrationId, String requestId) {
        SeatPhoneTransferRequest r = new SeatPhoneTransferRequest();
        r.setRegistrationId(registrationId);
        r.setRequestId(requestId);
        r.setName("小李");
        r.setPhone(FRIEND_PHONE);
        return r;
    }

    private static ChannelVoucherRevokeRequest revokeRequest() {
        ChannelVoucherRevokeRequest r = new ChannelVoucherRevokeRequest();
        r.setReason("企业退单");
        return r;
    }
}
