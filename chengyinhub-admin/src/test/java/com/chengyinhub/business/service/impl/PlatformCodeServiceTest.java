package com.chengyinhub.business.service.impl;

import com.chengyinhub.business.domain.ChannelOrderVerification;
import com.chengyinhub.business.domain.ChannelVoucher;
import com.chengyinhub.business.domain.CmsTopic;
import com.chengyinhub.business.domain.MarketingCodeGrant;
import com.chengyinhub.business.domain.MarketingProduct;
import com.chengyinhub.business.domain.MarketingProductItem;
import com.chengyinhub.business.domain.dto.ChannelRedeemRequest;
import com.chengyinhub.business.domain.dto.ChannelRedeemResult;
import com.chengyinhub.business.domain.dto.ChannelVoucherRevokeRequest;
import com.chengyinhub.business.domain.dto.ChannelVoucherView;
import com.chengyinhub.business.domain.dto.PlatformCodeIssueRequest;
import com.chengyinhub.business.domain.dto.ChannelVerificationCommand;
import com.chengyinhub.business.exception.ChannelVoucherException;
import com.chengyinhub.business.mapper.ChannelOrderVerificationMapper;
import com.chengyinhub.business.mapper.ChannelRedemptionMapper;
import com.chengyinhub.business.mapper.ChannelVoucherAccountMapper;
import com.chengyinhub.business.mapper.ChannelVoucherMapper;
import com.chengyinhub.business.mapper.CmsRegistrationMapper;
import com.chengyinhub.business.mapper.MarketingCodeGrantMapper;
import com.chengyinhub.business.mapper.MarketingProductMapper;
import com.chengyinhub.business.service.ChannelRedemptionGrantPort;
import com.chengyinhub.business.service.ICmsTopicService;
import com.chengyinhub.business.service.IProductRoleService;
import com.chengyinhub.business.service.support.ChannelRedemptionGrantPortResolver;
import com.chengyinhub.business.service.support.ChannelVoucherCodec;
import com.chengyinhub.business.service.support.ChannelVoucherSnapshot;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * 平台自发码：发码/兑换/重放/撤销/过期/席位/并发/开关/外部渠道仍关闭。
 * 全部用 mock 的 mapper 驱动真实服务实现；不读源码文本。
 */
class PlatformCodeServiceTest {

    private static final long OPERATOR = 1L;
    private static final long MEMBER = 7L;
    private static final long OTHER = 8L;
    private static final long PRODUCT_ID = 42L;
    private static final long VOUCHER_ID = 300L;
    private static final long TOPIC_A = 70L;
    private static final long TOPIC_B = 71L;

    private ChannelVoucherMapper vouchers;
    private MarketingCodeGrantMapper grants;
    private MarketingProductMapper products;
    private IProductRoleService roles;
    private ICmsTopicService topics;
    private CmsRegistrationMapper registrations;
    private PlatformCodeServiceImpl service;

    /** 码行“库内状态”；markRedeemed/markRevoked 以条件更新语义修改它。 */
    private final AtomicReference<Integer> voucherStatus = new AtomicReference<>(ChannelVoucher.STATUS_ACTIVE);
    private final List<MarketingCodeGrant> stored = Collections.synchronizedList(new ArrayList<>());
    private ChannelVoucher template;
    private String code;

    @BeforeEach
    void setUp() {
        vouchers = mock(ChannelVoucherMapper.class);
        grants = mock(MarketingCodeGrantMapper.class);
        products = mock(MarketingProductMapper.class);
        roles = mock(IProductRoleService.class);
        topics = mock(ICmsTopicService.class);
        registrations = mock(CmsRegistrationMapper.class);
        service = new PlatformCodeServiceImpl(vouchers, grants, products, roles, topics, registrations, true);

        when(products.selectById(PRODUCT_ID)).thenReturn(bundle());
        when(products.selectItems(PRODUCT_ID)).thenReturn(Arrays.asList(item(TOPIC_A), item(TOPIC_B)));
        when(roles.isPlatformOwned(anyLong())).thenReturn(true);
        when(topics.selectCmsTopicById(anyLong())).thenAnswer(inv -> topic(inv.getArgument(0)));

        String publicId = ChannelVoucherCodec.newPublicId();
        code = ChannelVoucherCodec.issue(publicId);
        template = new ChannelVoucher();
        template.setId(VOUCHER_ID);
        template.setIssuerType(ChannelVoucher.ISSUER_PLATFORM);
        template.setBatchNo("PB1");
        template.setBatchSeq(1);
        template.setPublicId(publicId);
        template.setCodeHash(ChannelVoucherCodec.sha256Hex(code));
        template.setProductId(PRODUCT_ID);
        template.setProductRevision(3L);
        template.setQuantity(3);
        template.setSeatCount(6);
        template.setSubjectMode(ChannelVoucher.SUBJECT_OPEN);
        template.setExpiresAt(new Date(System.currentTimeMillis() + TimeUnit.DAYS.toMillis(5)));
        template.setGrantSnapshotJson(ChannelVoucherSnapshot.capturePlatform(bundle(),
                Arrays.asList(item(TOPIC_A), item(TOPIC_B)), topics));

        when(vouchers.selectByIdForUpdate(VOUCHER_ID)).thenAnswer(inv -> currentVoucher());
        when(vouchers.selectById(VOUCHER_ID)).thenAnswer(inv -> currentVoucher());
        when(vouchers.markRedeemed(eq(VOUCHER_ID), any())).thenAnswer(inv ->
                voucherStatus.compareAndSet(ChannelVoucher.STATUS_ACTIVE, ChannelVoucher.STATUS_REDEEMED) ? 1 : 0);
        when(vouchers.markRevoked(eq(VOUCHER_ID), anyString(), any())).thenAnswer(inv -> {
            Integer s = voucherStatus.get();
            if (s == ChannelVoucher.STATUS_ACTIVE || s == ChannelVoucher.STATUS_REDEEMED) {
                voucherStatus.set(ChannelVoucher.STATUS_REVOKED);
                return 1;
            }
            return 0;
        });
        when(grants.insert(any())).thenAnswer(inv -> {
            MarketingCodeGrant g = inv.getArgument(0);
            g.setId((long) (stored.size() + 1));
            stored.add(g);
            return 1;
        });
        when(grants.selectByVoucherForUpdate(VOUCHER_ID)).thenAnswer(inv -> new ArrayList<>(stored));
        when(grants.selectByVoucher(VOUCHER_ID)).thenAnswer(inv -> new ArrayList<>(stored));
        when(grants.selectByMemberRequest(anyLong(), anyString())).thenAnswer(inv -> {
            List<MarketingCodeGrant> out = new ArrayList<>();
            for (MarketingCodeGrant g : stored) {
                if (g.getMemberId().equals(inv.getArgument(0)) && g.getRequestId().equals(inv.getArgument(1))) out.add(g);
            }
            return out;
        });
        when(grants.revokeByVoucher(eq(VOUCHER_ID), anyString(), any())).thenAnswer(inv -> {
            int n = 0;
            for (MarketingCodeGrant g : stored) {
                if (g.getStatus() == MarketingCodeGrant.STATUS_ACTIVE) {
                    g.setStatus(MarketingCodeGrant.STATUS_REVOKED);
                    g.setRevokedAt(inv.getArgument(2));
                    n++;
                }
            }
            return n;
        });
    }

    // ---------------------------------------------------------------- issue

    @Test
    void issueBatchCreatesPlatformCodesWithFrozenSeatsAndNoChannelFacts() {
        PlatformCodeIssueRequest request = issueRequest("batch-1", 3, 3);
        List<ChannelVoucherView> views = service.issue(OPERATOR, request);

        assertEquals(3, views.size());
        ArgumentCaptor<ChannelVoucher> captor = ArgumentCaptor.forClass(ChannelVoucher.class);
        verify(vouchers, times(3)).insertPlatform(captor.capture());
        for (int i = 0; i < 3; i++) {
            ChannelVoucher row = captor.getAllValues().get(i);
            assertEquals(Integer.valueOf(ChannelVoucher.ISSUER_PLATFORM), row.getIssuerType());
            assertNull(row.getAccountId());
            assertNull(row.getVerificationId());
            assertEquals(Integer.valueOf(i + 1), row.getBatchSeq());
            assertEquals(captor.getAllValues().get(0).getBatchNo(), row.getBatchNo());
            assertEquals("企业团购 A", row.getAdminNote());
            // N 席位 = 商品席位(2) × 数量(3)
            assertEquals(Integer.valueOf(6), row.getSeatCount());
            assertTrue(ChannelVoucherCodec.matches(views.get(i).getCode(), row.getCodeHash()));
        }
        verify(vouchers, never()).insert(any());
    }

    @Test
    void issueReplayReturnsSameRowsWithoutPlaintext() {
        PlatformCodeIssueRequest request = issueRequest("batch-2", 1, 1);
        service.issue(OPERATOR, request);
        ArgumentCaptor<ChannelVoucher> captor = ArgumentCaptor.forClass(ChannelVoucher.class);
        verify(vouchers).insertPlatform(captor.capture());
        when(vouchers.selectPlatformByRequest("batch-2")).thenReturn(Collections.singletonList(captor.getValue()));

        List<ChannelVoucherView> replay = service.issue(OPERATOR, request);

        assertEquals(1, replay.size());
        assertTrue(replay.get(0).getReplayed());
        assertNull(replay.get(0).getCode());
        verify(vouchers, times(1)).insertPlatform(any());
    }

    @Test
    void issueRejectsProductsThatDoNotGrantRoutePlay() {
        MarketingProduct pass = bundle();
        pass.setProductKind(MarketingProduct.KIND_TIME_LIMITED_PASS);
        when(products.selectById(PRODUCT_ID)).thenReturn(pass);

        ChannelVoucherException e = assertThrows(ChannelVoucherException.class,
                () -> service.issue(OPERATOR, issueRequest("batch-3", 1, 1)));
        assertEquals("PRODUCT_UNSUPPORTED", e.getReasonCode());
        verify(vouchers, never()).insertPlatform(any());
    }

    // ---------------------------------------------------------------- redeem

    @Test
    void redeemCreatesOneActiveGrantPerTopicWithSeatsAndReplayReturnsSameGrant() {
        ChannelRedeemResult first = service.redeem(MEMBER, VOUCHER_ID, "r-1", "fp-1");

        assertFalse(first.getReplayed());
        assertEquals("PLATFORM", first.getIssuerType());
        assertEquals(Arrays.asList(TOPIC_A, TOPIC_B), first.getTopicIds());
        assertEquals(Integer.valueOf(6), first.getSeatCount());
        assertEquals(2, stored.size());
        for (MarketingCodeGrant g : stored) {
            assertEquals(Long.valueOf(MEMBER), g.getMemberId());
            assertEquals(Integer.valueOf(MarketingCodeGrant.STATUS_ACTIVE), g.getStatus());
            assertEquals(Integer.valueOf(6), g.getSeatCount());
            assertEquals(MarketingCodeGrant.idempotencyKeyOf(VOUCHER_ID, g.getTopicId()), g.getIdempotencyKey());
        }

        // 同请求键重放、换请求键再兑：都返回原授权，不新增行
        ChannelRedeemResult sameKey = service.redeem(MEMBER, VOUCHER_ID, "r-1", "fp-1");
        ChannelRedeemResult newKey = service.redeem(MEMBER, VOUCHER_ID, "r-2", "fp-1");
        assertTrue(sameKey.getReplayed());
        assertTrue(newKey.getReplayed());
        assertEquals(first.getTopicIds(), newKey.getTopicIds());
        assertEquals(2, stored.size());
    }

    @Test
    void redeemedByAnotherMemberIsRefusedWithoutLeakingWho() {
        service.redeem(MEMBER, VOUCHER_ID, "r-1", "fp-1");

        ChannelVoucherException e = assertThrows(ChannelVoucherException.class,
                () -> service.redeem(OTHER, VOUCHER_ID, "r-9", "fp-9"));
        assertEquals("ALREADY_REDEEMED_BY_OTHER", e.getReasonCode());
        assertFalse(e.getMessage().contains(String.valueOf(MEMBER)));
        assertEquals(2, stored.size());
    }

    @Test
    void expiredCodeIsRefused() {
        template.setExpiresAt(new Date(System.currentTimeMillis() - 1000L));

        ChannelVoucherException e = assertThrows(ChannelVoucherException.class,
                () -> service.redeem(MEMBER, VOUCHER_ID, "r-1", "fp-1"));
        assertEquals("CODE_EXPIRED", e.getReasonCode());
        assertTrue(stored.isEmpty());
    }

    @Test
    void boundCodeRefusesOtherAccount() {
        template.setSubjectMode(ChannelVoucher.SUBJECT_BOUND_MEMBER);
        template.setBoundMemberId(MEMBER);

        ChannelVoucherException e = assertThrows(ChannelVoucherException.class,
                () -> service.redeem(OTHER, VOUCHER_ID, "r-1", "fp-1"));
        assertEquals("SUBJECT_MISMATCH", e.getReasonCode());
    }

    // ---------------------------------------------------------------- revoke

    @Test
    void revokeBeforeRedeemVoidsCodeOnly() {
        service.revoke(OPERATOR, VOUCHER_ID, revokeRequest());

        verify(grants, never()).revokeByVoucher(anyLong(), anyString(), any());
        assertEquals(Integer.valueOf(ChannelVoucher.STATUS_REVOKED), voucherStatus.get());
        ChannelVoucherException e = assertThrows(ChannelVoucherException.class,
                () -> service.redeem(MEMBER, VOUCHER_ID, "r-1", "fp-1"));
        assertEquals("CODE_UNAVAILABLE", e.getReasonCode());
        assertTrue(stored.isEmpty());
    }

    @Test
    void revokeAfterRedeemVoidsGrantFactAndNeverRevives() {
        service.redeem(MEMBER, VOUCHER_ID, "r-1", "fp-1");

        service.revoke(OPERATOR, VOUCHER_ID, revokeRequest());

        for (MarketingCodeGrant g : stored) {
            assertEquals(Integer.valueOf(MarketingCodeGrant.STATUS_REVOKED), g.getStatus());
        }
        // 撤销后本人再兑也不会复活授权
        ChannelVoucherException e = assertThrows(ChannelVoucherException.class,
                () -> service.redeem(MEMBER, VOUCHER_ID, "r-1", "fp-1"));
        assertEquals("CODE_UNAVAILABLE", e.getReasonCode());
        // 再撤销幂等
        service.revoke(OPERATOR, VOUCHER_ID, revokeRequest());
        assertEquals(2, stored.size());
        for (MarketingCodeGrant g : stored) {
            assertEquals(Integer.valueOf(MarketingCodeGrant.STATUS_REVOKED), g.getStatus());
        }
    }

    // ---------------------------------------------------------------- concurrency

    @Test
    void concurrentDoubleRedeemGrantsExactlyOnce() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Future<String>> results = new ArrayList<>();
            for (long member : new long[] {MEMBER, OTHER}) {
                Callable<String> attempt = () -> {
                    start.await();
                    try {
                        service.redeem(member, VOUCHER_ID, "r-" + member, "fp-" + member);
                        return "OK";
                    } catch (ChannelVoucherException rejected) {
                        return rejected.getReasonCode();
                    }
                };
                results.add(pool.submit(attempt));
            }
            start.countDown();
            List<String> outcomes = new ArrayList<>();
            for (Future<String> f : results) outcomes.add(f.get(10, TimeUnit.SECONDS));
            assertEquals(1, Collections.frequency(outcomes, "OK"), outcomes.toString());
            assertEquals(1, Collections.frequency(outcomes, "ALREADY_REDEEMED_BY_OTHER"), outcomes.toString());
            long owners = stored.stream().map(MarketingCodeGrant::getMemberId).distinct().count();
            assertEquals(1L, owners);
            assertEquals(2, stored.size());
        } finally {
            pool.shutdownNow();
        }
    }

    // ---------------------------------------------------------------- switch

    @Test
    void switchOffRefusesIssueAndRedeemWithoutTouchingTables() {
        PlatformCodeServiceImpl off = new PlatformCodeServiceImpl(vouchers, grants, products, roles, topics, registrations, false);

        assertFalse(off.enabled());
        assertEquals("PLATFORM_CODE_DISABLED", assertThrows(ChannelVoucherException.class,
                () -> off.issue(OPERATOR, issueRequest("b", 1, 1))).getReasonCode());
        assertEquals("CODE_UNAVAILABLE", assertThrows(ChannelVoucherException.class,
                () -> off.redeem(MEMBER, VOUCHER_ID, "r-1", "fp-1")).getReasonCode());
        verify(vouchers, never()).insertPlatform(any());
        verify(vouchers, never()).markRedeemed(anyLong(), any());
        verifyNoInteractions(grants);
    }

    @Test
    void redeemEndpointRoutesPlatformCodeAndPlatformCodeStaysClosedWhenOff() {
        ChannelVoucherMapper channelVouchers = mock(ChannelVoucherMapper.class);
        ChannelRedemptionMapper redemptions = mock(ChannelRedemptionMapper.class);
        ChannelOrderVerificationMapper verifications = mock(ChannelOrderVerificationMapper.class);
        ChannelRedemptionGrantPortResolver resolver = mock(ChannelRedemptionGrantPortResolver.class);
        ChannelRedemptionServiceImpl endpoint = new ChannelRedemptionServiceImpl(channelVouchers, redemptions,
                verifications, mock(ChannelVoucherAccountMapper.class), products, roles, topics, resolver);
        when(channelVouchers.selectByPublicId(template.getPublicId())).thenReturn(currentVoucher());

        // 无平台服务（或开关关闭）：平台码一律暂不可用，不碰渠道验证/grant 端口
        assertEquals("CODE_UNAVAILABLE", assertThrows(ChannelVoucherException.class,
                () -> endpoint.redeem(MEMBER, redeemRequest("r-1"))).getReasonCode());
        endpoint.setPlatformCodeService(new PlatformCodeServiceImpl(vouchers, grants, products, roles, topics, registrations, false));
        assertEquals("CODE_UNAVAILABLE", assertThrows(ChannelVoucherException.class,
                () -> endpoint.redeem(MEMBER, redeemRequest("r-1"))).getReasonCode());

        endpoint.setPlatformCodeService(service);
        ChannelRedeemResult result = endpoint.redeem(MEMBER, redeemRequest("r-1"));
        assertEquals("PLATFORM", result.getIssuerType());
        verifyNoInteractions(verifications);
        verify(resolver, never()).port();
        verify(redemptions, never()).insert(any());
    }

    // ---------------------------------------------------------------- external closed

    @Test
    void externalChannelPathsStayClosed() {
        // 渠道码（存量 issuer_type=CHANNEL）在开关打开时仍走原链路：未接线 grant 端口仍 503，不落授权事实
        ChannelVoucherMapper channelVouchers = mock(ChannelVoucherMapper.class);
        ChannelOrderVerificationMapper verifications = mock(ChannelOrderVerificationMapper.class);
        ChannelRedemptionGrantPortResolver resolver = new ChannelRedemptionGrantPortResolver(
                Collections.<ChannelRedemptionGrantPort>emptyList());
        ChannelRedemptionServiceImpl endpoint = new ChannelRedemptionServiceImpl(channelVouchers,
                mock(ChannelRedemptionMapper.class), verifications, mock(ChannelVoucherAccountMapper.class),
                products, roles, topics, resolver);
        endpoint.setPlatformCodeService(service);
        ChannelVoucher channel = currentVoucher();
        channel.setIssuerType(ChannelVoucher.ISSUER_CHANNEL);
        channel.setAccountId(3L);
        channel.setVerificationId(11L);
        when(channelVouchers.selectByPublicId(template.getPublicId())).thenReturn(channel);
        when(channelVouchers.selectByIdForUpdate(VOUCHER_ID)).thenReturn(channel);

        ChannelVoucherException e = assertThrows(ChannelVoucherException.class,
                () -> endpoint.redeem(MEMBER, redeemRequest("r-1")));
        // 原链路拒绝（此处为渠道主体未启用），平台分支未被触达
        assertEquals("CHANNEL_INACTIVE", e.getReasonCode());
        assertTrue(stored.isEmpty());
        verify(grants, never()).insert(any());

        // 默认 provider 仍如实拒绝，不产生 VERIFIED
        assertEquals("PROVIDER_NOT_CONFIGURED",
                new NoopChannelOrderVerificationProvider().verify(new ChannelVerificationCommand()).getReasonCode());
        assertEquals(ChannelOrderVerification.STATUS_REJECTED,
                new NoopChannelOrderVerificationProvider().verify(new ChannelVerificationCommand()).getStatus());
    }

    // ---------------------------------------------------------------- helpers

    private ChannelVoucher currentVoucher() {
        ChannelVoucher v = new ChannelVoucher();
        v.setId(template.getId());
        v.setIssuerType(template.getIssuerType());
        v.setBatchNo(template.getBatchNo());
        v.setBatchSeq(template.getBatchSeq());
        v.setPublicId(template.getPublicId());
        v.setCodeHash(template.getCodeHash());
        v.setProductId(template.getProductId());
        v.setProductRevision(template.getProductRevision());
        v.setGrantSnapshotJson(template.getGrantSnapshotJson());
        v.setQuantity(template.getQuantity());
        v.setSeatCount(template.getSeatCount());
        v.setSubjectMode(template.getSubjectMode());
        v.setBoundMemberId(template.getBoundMemberId());
        v.setExpiresAt(template.getExpiresAt());
        v.setStatus(voucherStatus.get());
        return v;
    }

    private MarketingProduct bundle() {
        MarketingProduct p = new MarketingProduct();
        p.setId(PRODUCT_ID);
        p.setProductName("城市合集");
        p.setProductKind(MarketingProduct.KIND_CITY_BUNDLE);
        p.setFulfillmentRoute(MarketingProduct.ROUTE_SELF_PLAY_GRANT);
        p.setSeatCount(2);
        p.setValidityKind(MarketingProduct.VALIDITY_RELATIVE_DAYS);
        p.setValidDays(30);
        p.setStatus(MarketingProduct.STATUS_ON_SALE);
        p.setRevision(3L);
        return p;
    }

    private MarketingProductItem item(long topicId) {
        MarketingProductItem item = new MarketingProductItem();
        item.setProductId(PRODUCT_ID);
        item.setTopicId(topicId);
        item.setTopicTitle("作品 " + topicId);
        item.setContentRevision(5L);
        return item;
    }

    private CmsTopic topic(Long id) {
        CmsTopic t = new CmsTopic();
        t.setId(id);
        t.setName("作品 " + id);
        return t;
    }

    private PlatformCodeIssueRequest issueRequest(String requestId, int batchSize, int quantity) {
        PlatformCodeIssueRequest r = new PlatformCodeIssueRequest();
        r.setRequestId(requestId);
        r.setProductId(PRODUCT_ID);
        r.setBatchSize(batchSize);
        r.setQuantity(quantity);
        r.setNote("企业团购 A");
        return r;
    }

    private ChannelVoucherRevokeRequest revokeRequest() {
        ChannelVoucherRevokeRequest r = new ChannelVoucherRevokeRequest();
        r.setReason("企业退单");
        return r;
    }

    private ChannelRedeemRequest redeemRequest(String requestId) {
        ChannelRedeemRequest r = new ChannelRedeemRequest();
        r.setCode(code);
        r.setRequestId(requestId);
        return r;
    }
}
