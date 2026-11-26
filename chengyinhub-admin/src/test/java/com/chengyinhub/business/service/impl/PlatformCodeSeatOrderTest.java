package com.chengyinhub.business.service.impl;

import com.chengyinhub.business.domain.ChannelVoucher;
import com.chengyinhub.business.domain.CmsRegistration;
import com.chengyinhub.business.domain.CmsTopic;
import com.chengyinhub.business.domain.MarketingCodeGrant;
import com.chengyinhub.business.domain.MarketingProduct;
import com.chengyinhub.business.domain.MarketingProductItem;
import com.chengyinhub.business.domain.dto.ChannelVoucherRevokeRequest;
import com.chengyinhub.business.mapper.ChannelVoucherMapper;
import com.chengyinhub.business.mapper.CmsRegistrationMapper;
import com.chengyinhub.business.mapper.MarketingCodeGrantMapper;
import com.chengyinhub.business.mapper.MarketingProductMapper;
import com.chengyinhub.business.service.ICmsTopicService;
import com.chengyinhub.business.service.IProductRoleService;
import com.chengyinhub.business.service.support.ChannelVoucherCodec;
import com.chengyinhub.business.service.support.ChannelVoucherSnapshot;
import com.chengyinhub.business.service.support.CodeGrantSeatOrder;
import com.chengyinhub.business.exception.ChannelVoucherException;
import com.chengyinhub.common.constant.PurchaseKind;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DuplicateKeyException;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * DEC-F17:N 座平台码兑换落「恰好一张」¥0 已付席位锚单。用 mock mapper 驱动真实服务实现。
 */
class PlatformCodeSeatOrderTest {

    private static final long OPERATOR = 1L;
    private static final long MEMBER = 7L;
    private static final long PRODUCT_ID = 52L;
    private static final long VOUCHER_ID = 400L;
    private static final long TOPIC = 90L;
    private static final String KEY = "PCG:" + VOUCHER_ID + ":" + TOPIC;

    private ChannelVoucherMapper vouchers;
    private MarketingCodeGrantMapper grants;
    private MarketingProductMapper products;
    private ICmsTopicService topics;
    private CmsRegistrationMapper registrations;
    private PlatformCodeServiceImpl service;

    private final AtomicReference<Integer> voucherStatus = new AtomicReference<>(ChannelVoucher.STATUS_ACTIVE);
    private final List<MarketingCodeGrant> stored = Collections.synchronizedList(new ArrayList<>());
    /** 「库里」的锚单:按码唯一。 */
    private final List<CmsRegistration> orders = Collections.synchronizedList(new ArrayList<>());
    private ChannelVoucher template;

    @BeforeEach
    void setUp() {
        vouchers = mock(ChannelVoucherMapper.class);
        grants = mock(MarketingCodeGrantMapper.class);
        products = mock(MarketingProductMapper.class);
        IProductRoleService roles = mock(IProductRoleService.class);
        topics = mock(ICmsTopicService.class);
        registrations = mock(CmsRegistrationMapper.class);
        service = new PlatformCodeServiceImpl(vouchers, grants, products, roles, topics, registrations, true);

        when(products.selectById(PRODUCT_ID)).thenReturn(seatProduct(2));
        when(roles.isPlatformOwned(anyLong())).thenReturn(true);
        when(topics.selectCmsTopicById(anyLong())).thenAnswer(inv -> topic(inv.getArgument(0)));

        template = voucher(seatProduct(2), Collections.singletonList(item(TOPIC)), 2);

        when(vouchers.selectByIdForUpdate(VOUCHER_ID)).thenAnswer(inv -> currentVoucher());
        when(vouchers.selectById(VOUCHER_ID)).thenAnswer(inv -> currentVoucher());
        when(vouchers.markRedeemed(eq(VOUCHER_ID), any())).thenAnswer(inv ->
                voucherStatus.compareAndSet(ChannelVoucher.STATUS_ACTIVE, ChannelVoucher.STATUS_REDEEMED) ? 1 : 0);
        when(vouchers.markRevoked(eq(VOUCHER_ID), anyString(), any())).thenAnswer(inv -> {
            voucherStatus.set(ChannelVoucher.STATUS_REVOKED);
            return 1;
        });
        when(grants.insert(any())).thenAnswer(inv -> {
            MarketingCodeGrant g = inv.getArgument(0);
            g.setId((long) (stored.size() + 1));
            stored.add(g);
            return 1;
        });
        when(grants.selectByVoucherForUpdate(VOUCHER_ID)).thenAnswer(inv -> new ArrayList<>(stored));
        when(grants.selectByMemberRequest(anyLong(), anyString())).thenReturn(new ArrayList<>());
        when(grants.revokeByVoucher(eq(VOUCHER_ID), anyString(), any())).thenAnswer(inv -> {
            for (MarketingCodeGrant g : stored) g.setStatus(MarketingCodeGrant.STATUS_REVOKED);
            return stored.size();
        });
        when(registrations.selectCodeGrantSeatOrderForUpdate(eq(MEMBER), eq(KEY))).thenAnswer(inv ->
                orders.isEmpty() ? null : orders.get(0));
        when(registrations.insertCodeGrantSeatOrder(any())).thenAnswer(inv -> stored(inv.getArgument(0)));
        when(registrations.voidCodeGrantSeatOrder(eq(MEMBER), eq(KEY), any())).thenAnswer(inv -> {
            int n = 0;
            for (CmsRegistration row : orders) {
                if (CodeGrantSeatOrder.isCodeGranted(row)
                        && row.getRegistrationStatus() == 2 && row.getPaymentStatus() == 2) {
                    row.setRegistrationStatus(3);
                    row.setPaymentStatus(3);
                    n++;
                }
            }
            return n;
        });
    }

    /** 模拟 insertCodeGrantSeatOrder 的 SQL 常量列 + uk_reg_member_request。 */
    private int stored(CmsRegistration row) {
        if (!orders.isEmpty()) throw new DuplicateKeyException("uk_reg_member_request");
        row.setId(1000L + orders.size());
        row.setPaymentStatus(2);
        row.setRegistrationStatus(2);
        row.setCreateBy(CodeGrantSeatOrder.CREATED_BY);
        orders.add(row);
        return 1;
    }

    @Test
    void redeemingSeatCodeCreatesExactlyOneZeroPaidOrderWithTheSeats() {
        service.redeem(MEMBER, VOUCHER_ID, "r-1", "fp-1");

        assertEquals(1, orders.size());
        CmsRegistration row = orders.get(0);
        assertEquals(Long.valueOf(MEMBER), row.getMemberId());
        assertEquals(Long.valueOf(1L), row.getOwnerType());
        assertEquals(Long.valueOf(TOPIC), row.getOwnerId());
        assertEquals(Long.valueOf(2L), row.getOrderNum());
        assertEquals(Integer.valueOf(PurchaseKind.SELF_PLAY_PASS), row.getPurchaseKind());
        assertEquals("作品 " + TOPIC, row.getActivityTitle());
        assertEquals(new BigDecimal("0.1000"), row.getFeePlatformRate());
        assertEquals(KEY, row.getRequestId());
        assertTrue(CodeGrantSeatOrder.isCodeGranted(row));
        // 锚单到期与授权 valid_to 同口径(相对 30 天)。
        assertNotNull(row.getExpiresAt());
        assertEquals(stored.get(0).getValidTo(), row.getExpiresAt());
        assertTrue(row.getRegistrationNo().startsWith("C") && row.getRegistrationNo().length() <= 32);
        // 金额只由 SQL 常量写 0.00;服务不传任何金额/交易号。
        assertEquals(null, row.getTotalAmount());
        assertEquals(null, row.getPayableAmount());
        assertEquals(null, row.getTransactionId());
        verify(registrations, times(1)).insertCodeGrantSeatOrder(any());
    }

    @Test
    void replayWithSameOrNewRequestKeyNeverCreatesASecondOrder() {
        service.redeem(MEMBER, VOUCHER_ID, "r-1", "fp-1");
        assertTrue(service.redeem(MEMBER, VOUCHER_ID, "r-1", "fp-1").getReplayed());
        assertTrue(service.redeem(MEMBER, VOUCHER_ID, "r-2", "fp-2").getReplayed());

        assertEquals(1, orders.size());
        verify(registrations, times(1)).insertCodeGrantSeatOrder(any());
    }

    @Test
    void codeRedeemedBeforeThisFeatureGetsItsSingleOrderOnOwnersReplay() {
        doReturn(1).when(registrations).insertCodeGrantSeatOrder(any());
        service.redeem(MEMBER, VOUCHER_ID, "r-1", "fp-1");
        assertTrue(orders.isEmpty()); // 模拟上线前已兑换:只有授权事实,没有锚单
        doAnswer(inv -> stored(inv.getArgument(0))).when(registrations).insertCodeGrantSeatOrder(any());

        service.redeem(MEMBER, VOUCHER_ID, "r-1", "fp-1");
        service.redeem(MEMBER, VOUCHER_ID, "r-1", "fp-1");

        assertEquals(1, orders.size());
        assertEquals(Long.valueOf(MEMBER), orders.get(0).getMemberId());
    }

    @Test
    void concurrentWinnerOnUniqueKeyIsTreatedAsTheSameOrder() {
        CmsRegistration racing = new CmsRegistration();
        racing.setId(3000L);
        racing.setCreateBy(CodeGrantSeatOrder.CREATED_BY);
        when(registrations.selectCodeGrantSeatOrderForUpdate(eq(MEMBER), eq(KEY))).thenReturn(null, racing);
        doThrow(new DuplicateKeyException("uk_reg_member_request"))
                .when(registrations).insertCodeGrantSeatOrder(any());

        assertFalse(service.redeem(MEMBER, VOUCHER_ID, "r-1", "fp-1").getReplayed());
        verify(registrations, times(2)).selectCodeGrantSeatOrderForUpdate(eq(MEMBER), eq(KEY));
    }

    @Test
    void sameKeyHeldByANonCodeOrderIsRefusedNotAdopted() {
        CmsRegistration foreign = new CmsRegistration();
        foreign.setId(4000L);
        foreign.setCreateBy(String.valueOf(MEMBER));
        when(registrations.selectCodeGrantSeatOrderForUpdate(eq(MEMBER), eq(KEY))).thenReturn(foreign);

        ChannelVoucherException e = assertThrows(ChannelVoucherException.class,
                () -> service.redeem(MEMBER, VOUCHER_ID, "r-1", "fp-1"));
        assertEquals("SEAT_ORDER_CONFLICT", e.getReasonCode());
        verify(registrations, never()).insertCodeGrantSeatOrder(any());
    }

    @Test
    void singleSeatCodeAndMultiTopicBundleDoNotCreateOrders() {
        template = voucher(seatProduct(1), Collections.singletonList(item(TOPIC)), 1);
        service.redeem(MEMBER, VOUCHER_ID, "r-1", "fp-1");
        assertTrue(orders.isEmpty());

        stored.clear();
        voucherStatus.set(ChannelVoucher.STATUS_ACTIVE);
        MarketingProduct bundle = seatProduct(2);
        bundle.setProductKind(MarketingProduct.KIND_CITY_BUNDLE);
        template = voucher(bundle, Arrays.asList(item(TOPIC), item(TOPIC + 1)), 2);
        service.redeem(MEMBER, VOUCHER_ID, "r-2", "fp-2");
        assertEquals(2, stored.size());
        assertTrue(orders.isEmpty());
        verify(registrations, never()).insertCodeGrantSeatOrder(any());
    }

    @Test
    void revokeAfterRedeemVoidsTheOrderLikeARefundAndNeverRevivesIt() {
        service.redeem(MEMBER, VOUCHER_ID, "r-1", "fp-1");

        service.revoke(OPERATOR, VOUCHER_ID, revokeRequest());

        assertEquals(1, orders.size());
        assertEquals(Integer.valueOf(3), orders.get(0).getRegistrationStatus());
        assertEquals(Integer.valueOf(3), orders.get(0).getPaymentStatus());
        verify(registrations, times(1)).voidCodeGrantSeatOrder(eq(MEMBER), eq(KEY), any());
        // 撤销幂等:不再作废、不新建
        service.revoke(OPERATOR, VOUCHER_ID, revokeRequest());
        verify(registrations, times(1)).voidCodeGrantSeatOrder(eq(MEMBER), eq(KEY), any());
        verify(registrations, times(1)).insertCodeGrantSeatOrder(any());
    }

    @Test
    void revokeBeforeRedeemTouchesNoOrder() {
        service.revoke(OPERATOR, VOUCHER_ID, revokeRequest());

        verify(registrations, never()).voidCodeGrantSeatOrder(anyLong(), anyString(), any());
        verify(registrations, never()).insertCodeGrantSeatOrder(any());
    }

    @Test
    void revokedGrantNeverGetsAnOrderEvenOnOwnersReplay() {
        MarketingCodeGrant revoked = new MarketingCodeGrant();
        revoked.setMemberId(MEMBER);
        revoked.setTopicId(TOPIC);
        revoked.setStatus(MarketingCodeGrant.STATUS_REVOKED);
        assertFalse(PlatformCodeServiceImpl.seatOrderEligible(currentVoucher(),
                Collections.singletonList(revoked), MEMBER));
        revoked.setStatus(MarketingCodeGrant.STATUS_ACTIVE);
        assertTrue(PlatformCodeServiceImpl.seatOrderEligible(currentVoucher(),
                Collections.singletonList(revoked), MEMBER));
        assertFalse(PlatformCodeServiceImpl.seatOrderEligible(currentVoucher(),
                Collections.singletonList(revoked), MEMBER + 1));
    }

    // ---------------------------------------------------------------- helpers

    private ChannelVoucher voucher(MarketingProduct product, List<MarketingProductItem> items, int seats) {
        String publicId = ChannelVoucherCodec.newPublicId();
        ChannelVoucher v = new ChannelVoucher();
        v.setId(VOUCHER_ID);
        v.setIssuerType(ChannelVoucher.ISSUER_PLATFORM);
        v.setBatchNo("PB1");
        v.setBatchSeq(1);
        v.setPublicId(publicId);
        v.setCodeHash(ChannelVoucherCodec.sha256Hex(ChannelVoucherCodec.issue(publicId)));
        v.setProductId(PRODUCT_ID);
        v.setProductRevision(1L);
        v.setQuantity(1);
        v.setSeatCount(seats);
        v.setSubjectMode(ChannelVoucher.SUBJECT_OPEN);
        v.setExpiresAt(new Date(System.currentTimeMillis() + TimeUnit.DAYS.toMillis(5)));
        v.setGrantSnapshotJson(ChannelVoucherSnapshot.capturePlatform(product, items, topics));
        return v;
    }

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
        v.setExpiresAt(template.getExpiresAt());
        v.setStatus(voucherStatus.get());
        return v;
    }

    private MarketingProduct seatProduct(int seats) {
        MarketingProduct p = new MarketingProduct();
        p.setId(PRODUCT_ID);
        p.setProductCode("SEAT" + seats + "-T" + TOPIC);
        p.setProductName("作品·双人票");
        p.setProductKind(MarketingProduct.KIND_SINGLE_QUEST);
        p.setFulfillmentRoute(MarketingProduct.ROUTE_SELF_PLAY_GRANT);
        p.setSeatCount(seats);
        p.setValidityKind(MarketingProduct.VALIDITY_RELATIVE_DAYS);
        p.setValidDays(30);
        p.setStatus(MarketingProduct.STATUS_ON_SALE);
        p.setRevision(1L);
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
        t.setFeePlatformRate(new BigDecimal("0.1000"));
        return t;
    }

    private ChannelVoucherRevokeRequest revokeRequest() {
        ChannelVoucherRevokeRequest r = new ChannelVoucherRevokeRequest();
        r.setReason("企业退单");
        return r;
    }
}
