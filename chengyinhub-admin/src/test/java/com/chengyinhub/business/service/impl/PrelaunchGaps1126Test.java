package com.chengyinhub.business.service.impl;

import com.chengyinhub.business.domain.MarketingProduct;
import com.chengyinhub.business.domain.MarketingProductItem;
import com.chengyinhub.business.domain.MarketingProductOrder;
import com.chengyinhub.business.domain.UmsMember;
import com.chengyinhub.business.domain.dto.MarketingProductOrderRequest;
import com.chengyinhub.business.exception.MarketingProductException;
import com.chengyinhub.business.mapper.GiftEntitlementMapper;
import com.chengyinhub.business.mapper.MarketingProductMapper;
import com.chengyinhub.business.mapper.MarketingProductOrderMapper;
import com.chengyinhub.business.mapper.UmsMemberMapper;
import com.chengyinhub.business.mapper.UmsMemberPointsDetailMapper;
import com.chengyinhub.business.service.IGiftEntitlementService;
import com.chengyinhub.business.service.IMarketingExtraSeatService;
import com.chengyinhub.business.service.IMarketingProductFulfillmentService;
import com.chengyinhub.business.service.WechatPaymentOperations;
import com.chengyinhub.business.service.support.MarketingCashChannel;
import com.chengyinhub.business.service.support.MarketingProductRules;
import com.chengyinhub.business.service.support.MarketingQuotePayload;
import com.chengyinhub.business.service.support.MarketingQuoteSigner;
import com.chengyinhub.business.service.support.PointsValuePolicy;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class PrelaunchGaps1126Test {

    @Test
    void purchaseTranslatesRefundDecisionPointMissingIntoClean409Conflict() {
        MarketingProductMapper productMapper = mock(MarketingProductMapper.class);
        MarketingProductOrderMapper orderMapper = mock(MarketingProductOrderMapper.class);
        GiftEntitlementMapper giftMapper = mock(GiftEntitlementMapper.class);
        UmsMemberMapper memberMapper = mock(UmsMemberMapper.class);
        UmsMemberPointsDetailMapper pointsDetailMapper = mock(UmsMemberPointsDetailMapper.class);
        MarketingProductRules rules = mock(MarketingProductRules.class);
        MarketingQuoteSigner signer = new MarketingQuoteSigner("test-secret-1126");
        MarketingCashChannel cashChannel = mock(MarketingCashChannel.class);
        IGiftEntitlementService giftService = mock(IGiftEntitlementService.class);
        IMarketingProductFulfillmentService fulfillment = mock(IMarketingProductFulfillmentService.class);
        IMarketingExtraSeatService extraSeatService = mock(IMarketingExtraSeatService.class);
        WechatVerifiedPaymentFactService verifiedFacts = mock(WechatVerifiedPaymentFactService.class);
        WechatPaymentOperations wechatPay = mock(WechatPaymentOperations.class);

        MarketingProduct product = new MarketingProduct();
        product.setId(9919301L);
        product.setProductCode("UAT1115_ORIGINAL19_POINTS1");
        product.setProductName("TEST 原作19项积分验收包");
        product.setProductKind(2);
        product.setPurchaseKind(2);
        product.setFulfillmentRoute(MarketingProduct.ROUTE_SELF_PLAY_GRANT);
        product.setStatus(MarketingProduct.STATUS_ON_SALE);
        product.setPointsPrice(1);
        product.setValidityKind(MarketingProduct.VALIDITY_RELATIVE_DAYS);
        product.setValidDays(1);
        product.setSeatCount(1);
        product.setRevision(1L);
        product.setExploreCapacity(0);
        product.setGiftAllowed(0);

        MarketingProductItem item = new MarketingProductItem();
        item.setProductId(9919301L);
        item.setTopicId(9913001L);
        item.setTopicTitle("十道夜巡令");
        item.setContentRevision(1L);
        List<MarketingProductItem> items = Collections.singletonList(item);

        when(productMapper.selectByIdForUpdate(9919301L)).thenReturn(product);
        when(rules.items(9919301L)).thenReturn(items);
        when(rules.singlePrices(items)).thenReturn(Collections.singletonList(new BigDecimal("29.90")));
        UmsMember member = new UmsMember();
        member.setId(990050L);
        member.setPoint(50L);
        when(memberMapper.selectUmsMemberById(990050L)).thenReturn(member);
        when(memberMapper.deductPoints(990050L, 1)).thenReturn(1);
        when(orderMapper.insert(any())).thenAnswer(inv -> {
            MarketingProductOrder o = inv.getArgument(0);
            o.setId(7001L);
            return 1;
        });
        when(orderMapper.markPointsPaid(anyLong(), any(), any(), any())).thenReturn(1);
        when(fulfillment.grant(any())).thenThrow(new IllegalStateException(
                MarketingProductFulfillmentServiceImpl.REFUND_DECISION_POINT_MISSING
                        + ":主题履约窗(startDate/endDate)未配置 topicId=9913001"));

        long expiresAt = System.currentTimeMillis() + 60_000L;
        String canonical = MarketingQuotePayload.of(990050L, product, MarketingProductOrder.FULFILLMENT_SELF,
                1, null, null, null, 1, 1, items, expiresAt);
        MarketingProductOrderRequest req = new MarketingProductOrderRequest();
        req.setProductId(9919301L);
        req.setPayMode(MarketingProductOrder.PAY_MODE_POINTS);
        req.setFulfillmentKind(MarketingProductOrder.FULFILLMENT_SELF);
        req.setQuantity(1);
        req.setRequestId("req_1126_test");
        req.setQuoteExpiresAt(expiresAt);
        req.setQuoteSign(signer.sign(canonical));

        MarketingProductPurchaseServiceImpl service = new MarketingProductPurchaseServiceImpl(
                productMapper, orderMapper, giftMapper, memberMapper, pointsDetailMapper, rules,
                PointsValuePolicy.codeDefaults(), signer, cashChannel, giftService, fulfillment,
                extraSeatService, verifiedFacts, wechatPay);

        MarketingProductException ex = assertThrows(MarketingProductException.class,
                () -> service.purchase(990050L, req));
        assertEquals(409, ex.getHttpStatus());
        assertEquals("REFUND_WINDOW_MISSING", ex.getReasonCode());
        assertEquals("该商品暂不可售", ex.getMessage());
    }

    @Test
    void merchantByMemberIdQueriesFilterDeletedRowsAndLimitToOne() throws Exception {
        Path xmlPath = Paths.get("..", "chengyinhub-system", "src", "main", "resources",
                "mapper", "business", "MmsMerchantMapper.xml");
        String xml = new String(Files.readAllBytes(xmlPath), StandardCharsets.UTF_8)
                .toLowerCase().replaceAll("\\s+", " ");

        int byMember = xml.indexOf("id=\"selectmmsmerchantbymemberid\"");
        int byMemberEnd = xml.indexOf("</select>", byMember);
        String byMemberSql = xml.substring(byMember, byMemberEnd);
        assertTrue(byMemberSql.contains("del_flag = 0"), "按 member_id 查商家必须过滤软删记录");
        assertTrue(byMemberSql.contains("limit 1"), "按 member_id 单行查询必须 limit 1 避免 TooManyResultsException");

        int forUpdate = xml.indexOf("id=\"selectmmsmerchantbymemberidforupdate\"");
        int forUpdateEnd = xml.indexOf("</select>", forUpdate);
        String forUpdateSql = xml.substring(forUpdate, forUpdateEnd);
        assertTrue(forUpdateSql.contains("del_flag = 0"), "加锁按 member_id 查商家必须过滤软删记录");
        assertTrue(forUpdateSql.contains("limit 1 for update"));

        int countForUpdate = xml.indexOf("id=\"countmmsmerchantrowsbymemberidforupdate\"");
        int countEnd = xml.indexOf("</select>", countForUpdate);
        String countSql = xml.substring(countForUpdate, countEnd);
        assertFalse(countSql.contains(" limit "), "count 查询保持全量判存在");
    }
}
