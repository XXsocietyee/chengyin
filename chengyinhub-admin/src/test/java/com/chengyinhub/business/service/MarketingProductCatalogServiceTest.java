package com.chengyinhub.business.service;

import com.chengyinhub.business.domain.CmsTopic;
import com.chengyinhub.business.domain.MarketingProduct;
import com.chengyinhub.business.domain.MarketingProductItem;
import com.chengyinhub.business.domain.MarketingProductOrder;
import com.chengyinhub.business.domain.dto.MarketingProductQuoteRequest;
import com.chengyinhub.business.domain.dto.MarketingProductQuoteResult;
import com.chengyinhub.business.exception.MarketingProductException;
import com.chengyinhub.business.mapper.CmsTopicMapper;
import com.chengyinhub.business.mapper.MarketingProductMapper;
import com.chengyinhub.business.mapper.MarketingProductOrderMapper;
import com.chengyinhub.business.service.impl.MarketingProductCatalogServiceImpl;
import com.chengyinhub.business.service.support.MarketingCashChannel;
import com.chengyinhub.business.service.IOmsTicketService;
import com.chengyinhub.business.service.support.MarketingProductRules;
import com.chengyinhub.business.service.support.MarketingQuotePayload;
import com.chengyinhub.business.service.support.MarketingQuoteSigner;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.Arrays;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** 报价契约：kind→PurchaseKind 映射、章节容量旗标、服务端总价与签名。 */
class MarketingProductCatalogServiceTest {

    private static final String SECRET = "unit-test-product-secret";
    private static final long MEMBER = 7L;
    private static final long PRODUCT = 10L;

    private MarketingProductMapper products;
    private MarketingProductOrderMapper orders;
    private CmsTopicMapper topics;
    private MarketingQuoteSigner signer;
    private IOmsTicketService ticketService;
    private MarketingProductCatalogServiceImpl service;

    @BeforeEach
    void setUp() {
        products = mock(MarketingProductMapper.class);
        orders = mock(MarketingProductOrderMapper.class);
        topics = mock(CmsTopicMapper.class);
        signer = new MarketingQuoteSigner(SECRET);
        ticketService = mock(IOmsTicketService.class);
        MarketingProductRules rules = new MarketingProductRules(products, orders, topics, ticketService);
        service = new MarketingProductCatalogServiceImpl(products, rules, signer,
                new MarketingCashChannel(false));
        when(products.selectById(PRODUCT)).thenReturn(passProduct());
        when(products.selectItems(PRODUCT)).thenReturn(Arrays.asList(item(100L, 5L), item(101L, 6L)));
        CmsTopic topic = new CmsTopic();
        topic.setId(100L);
        topic.setSelfPlayPrice(new BigDecimal("19.99"));
        when(topics.selectCmsTopicById(100L)).thenReturn(topic);
    }

    @Test
    void passQuotesSelfPlayKindWithoutExploreCapacity() {
        MarketingProductQuoteResult quote = service.quote(MEMBER, request());

        assertEquals(2, quote.getPurchaseKind().intValue());
        assertFalse(quote.getExploreCapacity());
        assertEquals(120, quote.getTotalPointsAmount().intValue());
        assertEquals(new BigDecimal("39.99"), quote.getTotalCashAmount());
        assertNotNull(quote.getQuoteSign());
        String canonical = MarketingQuotePayload.of(MEMBER, passProduct(),
                MarketingProductOrder.FULFILLMENT_SELF, 1, null, null,
                quote.getTotalCashAmount(), quote.getTotalPointsAmount(), 1,
                products.selectItems(PRODUCT), quote.getQuoteExpiresAt().getTime());
        assertTrue(signer.matches(canonical, quote.getQuoteSign()));
    }

    @Test
    void exploreProductMustDeclarePurchaseKindThree() {
        MarketingProduct invalid = passProduct();
        invalid.setPurchaseKind(2);
        invalid.setExploreCapacity(1);
        when(products.selectById(PRODUCT)).thenReturn(invalid);

        assertReason("EXPLORE_CAPACITY_INVALID", () -> service.quote(MEMBER, request()));
    }

    @Test
    void giftRejectsSelfRecipient() {
        MarketingProduct giftProduct = passProduct();
        giftProduct.setGiftAllowed(1);
        giftProduct.setValidityKind(MarketingProduct.VALIDITY_RELATIVE_DAYS);
        when(products.selectById(PRODUCT)).thenReturn(giftProduct);
        MarketingProductQuoteRequest self = request();
        self.setFulfillmentKind(MarketingProductOrder.FULFILLMENT_GIFT);
        self.setRecipientMemberId(MEMBER);
        assertReason("GIFT_SELF_RECIPIENT", () -> service.quote(MEMBER, self));
    }

    @Test
    void addOnRequiresAdmissionOnOriginalOrder() {
        MarketingProduct addOn = passProduct();
        addOn.setProductKind(MarketingProduct.KIND_EXTRA_SEAT);
        addOn.setParentProductId(PRODUCT);
        when(products.selectById(PRODUCT)).thenReturn(addOn);

        MarketingProductOrder paid = new MarketingProductOrder();
        paid.setId(500L);
        paid.setMemberId(MEMBER);
        paid.setProductId(PRODUCT);
        paid.setStatus(MarketingProductOrder.STATUS_PAID);
        when(orders.selectByOrderNo("MKO-ORIG")).thenReturn(paid);

        MarketingProductQuoteRequest addOnRequest = request();
        addOnRequest.setFulfillmentKind(MarketingProductOrder.FULFILLMENT_EXTRA_SEAT);
        addOnRequest.setOriginalOrderNo("MKO-ORIG");
        assertReason("ORIGINAL_ADMISSION_MISSING", () -> service.quote(MEMBER, addOnRequest));
    }

    @Test
    void extraSeatRouteRequiresARecipientSoTheOtherPlayerIsPinned() {
        stubPaidExtraSeatBase();
        MarketingProductQuoteRequest addOnRequest = extraSeatRequest();
        addOnRequest.setRecipientMemberId(null);

        assertReason("EXTRA_SEAT_RECIPIENT_REQUIRED", () -> service.quote(MEMBER, addOnRequest));
    }

    @Test
    void extraSeatRouteRejectsBuyingForYourself() {
        stubPaidExtraSeatBase();
        MarketingProductQuoteRequest addOnRequest = extraSeatRequest();
        addOnRequest.setRecipientMemberId(MEMBER);

        // 加座是第二位玩家的独立准入；给自己再买一份只会多付一份钱。
        assertReason("EXTRA_SEAT_SELF_RECIPIENT", () -> service.quote(MEMBER, addOnRequest));
    }

    @Test
    void extraSeatRouteIsOneSeatPerOrderAndQuotesPayModes() {
        stubPaidExtraSeatBase();
        MarketingProductQuoteRequest two = extraSeatRequest();
        two.setQuantity(2);
        assertReason("EXTRA_SEAT_ONE_PER_ORDER", () -> service.quote(MEMBER, two));

        MarketingProductQuoteResult quote = service.quote(MEMBER, extraSeatRequest());

        // 负控：route3 分支漏掉 payModes 时这里会是空列表（前端拿不到可支付方式）。
        assertEquals(java.util.Collections.singletonList(MarketingProductOrder.PAY_MODE_POINTS),
                quote.getAvailablePayModes());
        // 现金通道默认关闭：只说明原因，不冒充可用。
        assertEquals("PAYMENT_OWNER_ROUTE_NOT_WIRED", quote.getCashUnavailableReason());
        assertEquals("EXTRA_SEAT_REQUIRES_ORIGINAL_ORDER", quote.getPurchaseRouteReason());
    }

    /** 加座 SKU + 一张属于本人的已付原单（含原准入）。 */
    private void stubPaidExtraSeatBase() {
        MarketingProduct addOn = passProduct();
        addOn.setProductKind(MarketingProduct.KIND_EXTRA_SEAT);
        addOn.setFulfillmentRoute(MarketingProduct.ROUTE_EXTRA_SEAT_GRANT);
        addOn.setParentProductId(PRODUCT);
        addOn.setValidityKind(MarketingProduct.VALIDITY_RELATIVE_DAYS);
        when(products.selectById(PRODUCT)).thenReturn(addOn);

        MarketingProductOrder paid = new MarketingProductOrder();
        paid.setId(500L);
        paid.setOrderNo("MKO-ORIG");
        paid.setMemberId(MEMBER);
        paid.setProductId(PRODUCT);
        paid.setStatus(MarketingProductOrder.STATUS_PAID);
        paid.setFulfillmentKind(MarketingProductOrder.FULFILLMENT_SELF);
        paid.setPrimaryRegistrationId(321L);
        when(orders.selectByOrderNo("MKO-ORIG")).thenReturn(paid);
    }

    private MarketingProductQuoteRequest extraSeatRequest() {
        MarketingProductQuoteRequest addOnRequest = request();
        addOnRequest.setFulfillmentKind(MarketingProductOrder.FULFILLMENT_EXTRA_SEAT);
        addOnRequest.setOriginalOrderNo("MKO-ORIG");
        addOnRequest.setRecipientMemberId(9L);
        return addOnRequest;
    }

    @Test
    void ticketRouteIsQuotedAsRegistrationCheckoutOnly() {
        MarketingProduct group = passProduct();
        group.setProductKind(MarketingProduct.KIND_GROUP_TEAM);
        group.setFulfillmentRoute(MarketingProduct.ROUTE_TICKET_REGISTRATION);
        group.setTicketId(77L);
        when(products.selectById(PRODUCT)).thenReturn(group);
        com.chengyinhub.business.domain.OmsTicket ticket = new com.chengyinhub.business.domain.OmsTicket();
        ticket.setId(77L);
        ticket.setOwnerType(2L);
        ticket.setOwnerId(555L);
        when(ticketService.selectOmsTicketById(77L)).thenReturn(ticket);

        MarketingProductQuoteResult quote = service.quote(MEMBER, request());

        assertEquals(MarketingProduct.ROUTE_TICKET_REGISTRATION, quote.getPurchaseRoute().intValue());
        assertEquals("USE_REGISTRATION_CHECKOUT", quote.getPurchaseRouteReason());
        assertTrue(quote.getAvailablePayModes().isEmpty());
        // 必须给原报名结算的真实标识，不能只回一个固定 409。
        assertEquals(2L, ((Number) quote.getCheckout().get("ownerType")).longValue());
        assertEquals(555L, ((Number) quote.getCheckout().get("ownerId")).longValue());
        assertEquals(77L, ((Number) quote.getCheckout().get("ticketId")).longValue());
        assertEquals("/api/registration/quote", quote.getCheckout().get("quoteEndpoint"));
        assertTrue(Boolean.TRUE.equals(quote.getCheckout().get("ticketResolved")));
    }

    @Test
    void giftProductCannotUseFirstUseValidity() {
        MarketingProduct giftProduct = passProduct();
        giftProduct.setGiftAllowed(1);
        when(products.selectById(PRODUCT)).thenReturn(giftProduct);
        assertReason("GIFT_REQUIRES_EXISTING_ROW", () -> service.quote(MEMBER, request()));
    }


    // ------------------------------------------------------------------ 自玩多席（owner 2026-11-22）
    // 夹具价（FIXTURE，非批准价格）：主题 100 单人自玩价 19.99；双人票 34.90 / 四人票 69.90。

    @Test
    void multiSeatQuoteWithinSinglePriceTimesSeatsIsSigned() {
        when(products.selectById(PRODUCT)).thenReturn(seatProduct(2, "34.90"));
        when(products.selectItems(PRODUCT)).thenReturn(Arrays.asList(item(100L, 5L)));

        MarketingProductQuoteResult quote = service.quote(MEMBER, request());

        assertEquals(2, quote.getSeatCount().intValue());
        assertEquals(0, new BigDecimal("34.90").compareTo(quote.getTotalCashAmount()));
        assertNotNull(quote.getQuoteSign());
    }

    @Test
    void multiSeatQuoteAboveSinglePriceTimesSeatsIsRefusedForAnyQuantity() {
        when(products.selectById(PRODUCT)).thenReturn(seatProduct(2, "39.99"));
        when(products.selectItems(PRODUCT)).thenReturn(Arrays.asList(item(100L, 5L)));
        assertReason("SEAT_PRICE_EXCEEDS_LIST", () -> service.quote(MEMBER, request()));

        MarketingProductQuoteRequest three = request();
        three.setQuantity(3);
        assertReason("SEAT_PRICE_EXCEEDS_LIST", () -> service.quote(MEMBER, three));
    }

    @Test
    void topicListReturnsSeatsCashAndServerPerPersonPriceAndDropsOverPricedSeatProducts() {
        MarketingProduct two = seatProduct(2, "34.90");
        two.setId(11L);
        MarketingProduct four = seatProduct(4, "69.90");
        four.setId(12L);
        MarketingProduct overPriced = seatProduct(2, "39.99");
        overPriced.setId(13L);
        MarketingProduct single = seatProduct(1, "19.99");
        single.setId(14L);
        java.util.List<MarketingProduct> listed = Arrays.asList(two, four, overPriced, single);
        when(products.selectSellableByTopic(org.mockito.ArgumentMatchers.isNull(), org.mockito.ArgumentMatchers.isNull(),
                org.mockito.ArgumentMatchers.eq(100L), org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.anyInt())).thenReturn(listed);
        java.util.List<MarketingProductItem> bound = new java.util.ArrayList<>();
        for (MarketingProduct product : listed) {
            MarketingProductItem item = item(100L, 5L);
            item.setProductId(product.getId());
            bound.add(item);
            when(products.selectItems(product.getId())).thenReturn(Arrays.asList(item));
        }
        when(products.selectItemsByProductIds(org.mockito.ArgumentMatchers.anyList())).thenReturn(bound);

        java.util.List<com.chengyinhub.business.domain.PassBundleView> views = service.listSellable(null, null, 100L, 20);

        assertEquals(3, views.size(), "价格超过单人价 × 人数的多人票不出现在列表");
        assertEquals(11L, views.get(0).getProductId().longValue());
        assertEquals(2, views.get(0).getSeatCount().intValue());
        assertEquals(0, new BigDecimal("34.90").compareTo(views.get(0).getCashPrice()));
        assertEquals(0, new BigDecimal("17.45").compareTo(views.get(0).getPerPersonCashPrice()));
        assertEquals(0, new BigDecimal("17.47").compareTo(views.get(1).getPerPersonCashPrice()),
                "69.90 / 4 = 17.475，按分向下取整");
        assertEquals(null, views.get(2).getPerPersonCashPrice(), "单席不下发人均价");
        assertFalse(views.get(0).getCashAvailable(), "cash-enabled 关闭时不可现金购买");
        org.mockito.Mockito.verify(products, org.mockito.Mockito.never()).selectSellable(
                org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.anyInt());
    }

    @Test
    void listWithoutTopicKeepsTheOriginalQuery() {
        when(products.selectSellable(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.anyInt()))
                .thenReturn(new java.util.ArrayList<>());
        assertTrue(service.listSellable(null, null, 20).isEmpty());
        assertTrue(service.listSellable(null, null, null, 20).isEmpty());
        assertTrue(service.listSellable(null, null, -1L, 20).isEmpty());
        org.mockito.Mockito.verify(products, org.mockito.Mockito.never()).selectSellableByTopic(
                org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.anyInt());
    }

    /** SEATS2：开放式自玩路线（start/end 都为空）上同步出的多人票，列表与报价不看履约窗。 */
    @Test
    void openEndedRouteSeatTicketsAreListedAndQuotedAtTheApprovedPrices() {
        CmsTopic open = new CmsTopic();
        open.setId(200L);
        open.setSelfPlay(1);
        open.setSelfPlayPrice(new BigDecimal("29.90"));
        open.setFeePlatformRate(new BigDecimal("0.0000"));
        open.setStartDate(null);
        open.setEndDate(null);
        when(topics.selectCmsTopicById(200L)).thenReturn(open);
        assertEquals(null, com.chengyinhub.business.service.support.TopicSeatProducts.ineligibleReason(open, true));

        MarketingProduct two = seatTicket(21L, 2, open);
        MarketingProduct four = seatTicket(22L, 4, open);
        java.util.List<MarketingProduct> listed = Arrays.asList(two, four);
        when(products.selectSellableByTopic(org.mockito.ArgumentMatchers.isNull(), org.mockito.ArgumentMatchers.isNull(),
                org.mockito.ArgumentMatchers.eq(200L), org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.anyInt())).thenReturn(listed);
        java.util.List<MarketingProductItem> bound = new java.util.ArrayList<>();
        for (MarketingProduct product : listed) {
            MarketingProductItem item = item(200L, 1L);
            item.setProductId(product.getId());
            bound.add(item);
            when(products.selectItems(product.getId())).thenReturn(Arrays.asList(item));
            when(products.selectById(product.getId())).thenReturn(product);
        }
        when(products.selectItemsByProductIds(org.mockito.ArgumentMatchers.anyList())).thenReturn(bound);

        java.util.List<com.chengyinhub.business.domain.PassBundleView> views = service.listSellable(null, null, 200L, 20);
        assertEquals(2, views.size(), "开放式路线的双人票、四人小队票都在列表里");
        assertEquals(0, new BigDecimal("49.90").compareTo(views.get(0).getCashPrice()));
        assertEquals(0, new BigDecimal("89.90").compareTo(views.get(1).getCashPrice()));

        for (MarketingProduct product : listed) {
            MarketingProductQuoteRequest req = request();
            req.setProductId(product.getId());
            MarketingProductQuoteResult quote = service.quote(MEMBER, req);
            assertEquals(product.getSeatCount(), quote.getSeatCount());
            assertEquals(0, product.getCashPrice().compareTo(quote.getTotalCashAmount()));
            assertNotNull(quote.getQuoteSign());
        }
    }

    private MarketingProduct seatTicket(long id, int seats, CmsTopic topic) {
        MarketingProduct product = seatProduct(seats,
                com.chengyinhub.business.service.support.SeatTicketPricing.price(topic.getSelfPlayPrice(), seats)
                        .toPlainString());
        product.setId(id);
        product.setProductCode(com.chengyinhub.business.service.support.TopicSeatProducts.productCode(topic.getId(), seats));
        product.setValidityKind(MarketingProduct.VALIDITY_NONE);
        product.setValidDays(null);
        product.setTermsVersion(com.chengyinhub.business.service.support.TopicSeatProducts.TERMS_VERSION);
        return product;
    }

    private MarketingProduct seatProduct(int seats, String fixturePrice) {
        MarketingProduct product = passProduct();
        product.setProductKind(MarketingProduct.KIND_SINGLE_QUEST);
        product.setValidityKind(MarketingProduct.VALIDITY_RELATIVE_DAYS);
        product.setValidDays(30);
        product.setPointsPrice(null);
        product.setSeatCount(seats);
        product.setCashPrice(new BigDecimal(fixturePrice));
        return product;
    }

    // ------------------------------------------------------------------ fixtures

    private MarketingProduct passProduct() {
        MarketingProduct product = new MarketingProduct();
        product.setId(PRODUCT);
        product.setProductCode("PASS-CITY-7D");
        product.setProductName("城市 7 日通行证");
        product.setProductKind(MarketingProduct.KIND_TIME_LIMITED_PASS);
        product.setPurchaseKind(2);
        product.setExploreCapacity(0);
        product.setFulfillmentRoute(MarketingProduct.ROUTE_SELF_PLAY_GRANT);
        product.setRevision(3L);
        product.setCashPrice(new BigDecimal("39.99"));
        product.setPointsPrice(120);
        product.setValidityKind(MarketingProduct.VALIDITY_ACTIVATE_ON_FIRST_USE);
        product.setValidDays(7);
        product.setSeatCount(1);
        product.setGiftAllowed(0);
        product.setStatus(MarketingProduct.STATUS_ON_SALE);
        product.setTermsVersion("v1");
        return product;
    }

    private MarketingProductItem item(long topicId, long revision) {
        MarketingProductItem item = new MarketingProductItem();
        item.setProductId(PRODUCT);
        item.setTopicId(topicId);
        item.setTopicTitle("作品" + topicId);
        item.setContentRevision(revision);
        return item;
    }

    private MarketingProductQuoteRequest request() {
        MarketingProductQuoteRequest request = new MarketingProductQuoteRequest();
        request.setProductId(PRODUCT);
        request.setQuantity(1);
        request.setFulfillmentKind(MarketingProductOrder.FULFILLMENT_SELF);
        return request;
    }

    private void assertReason(String reason, Runnable action) {
        MarketingProductException rejection = assertThrows(MarketingProductException.class, action::run);
        assertEquals(reason, rejection.getReasonCode());
    }
}
