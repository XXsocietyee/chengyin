package com.chengyinhub.business.service;

import com.chengyinhub.business.domain.CmsTopic;
import com.chengyinhub.business.domain.MarketingProduct;
import com.chengyinhub.business.domain.MarketingProductItem;
import com.chengyinhub.business.mapper.CmsTopicMapper;
import com.chengyinhub.business.mapper.MarketingProductMapper;
import com.chengyinhub.business.service.support.TopicSeatProducts;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 每个平台自营自玩主题的双人票 / 四人小队票同步：建、改价、幂等、下架、别的商品不碰。
 * 用内存里的"表"模拟 marketing_product / marketing_product_item，断言的是同步后的行，而不只是调用次数。
 */
class TopicSeatProductsTest {

    private static final long TOPIC = 4242L;

    private CmsTopicMapper topics;
    private MarketingProductMapper products;
    private IProductRoleService roles;
    private TopicSeatProducts sync;

    private CmsTopic topic;
    private final Map<String, MarketingProduct> byCode = new HashMap<>();
    private final Map<Long, List<MarketingProductItem>> itemsByProduct = new HashMap<>();
    private final AtomicLong ids = new AtomicLong(900);

    @BeforeEach
    void setUp() {
        topics = mock(CmsTopicMapper.class);
        products = mock(MarketingProductMapper.class);
        roles = mock(IProductRoleService.class);
        sync = new TopicSeatProducts(topics, products, roles);
        topic = eligibleTopic("29.90");
        when(topics.selectCmsTopicByIdForUpdate(TOPIC)).thenAnswer(inv -> topic);
        when(roles.isPlatformOwned(TOPIC)).thenReturn(true);
        when(products.selectByProductCode(anyString())).thenAnswer(inv -> copy(byCode.get(inv.<String>getArgument(0))));
        when(products.selectItems(anyLong())).thenAnswer(inv ->
                new ArrayList<>(itemsByProduct.getOrDefault(inv.<Long>getArgument(0), Collections.emptyList())));
        doAnswer(inv -> {
            MarketingProduct p = inv.getArgument(0);
            p.setId(ids.incrementAndGet());
            byCode.put(p.getProductCode(), copy(p));
            return 1;
        }).when(products).insertProduct(any(MarketingProduct.class));
        doAnswer(inv -> {
            MarketingProductItem item = inv.getArgument(0);
            itemsByProduct.computeIfAbsent(item.getProductId(), k -> new ArrayList<>()).add(item);
            return 1;
        }).when(products).insertItem(any(MarketingProductItem.class));
        doAnswer(inv -> {
            MarketingProduct row = byCode.get(inv.<String>getArgument(1));
            if (row == null || !row.getId().equals(inv.getArgument(0))
                    || !row.getRevision().equals(inv.getArgument(2))) return 0;
            row.setProductName(inv.getArgument(3));
            row.setCashPrice(inv.getArgument(4));
            row.setStatus(inv.getArgument(5));
            row.setRevision(row.getRevision() + 1);
            return 1;
        }).when(products).updateSeatProduct(anyLong(), anyString(), anyLong(), anyString(), any(BigDecimal.class),
                anyInt(), any(Date.class));
        doAnswer(inv -> {
            for (MarketingProductItem item : itemsByProduct.getOrDefault(inv.<Long>getArgument(0), Collections.emptyList())) {
                if (item.getTopicId().equals(inv.getArgument(1))) {
                    item.setTopicTitle(inv.getArgument(2));
                    item.setContentRevision(inv.getArgument(3));
                }
            }
            return 1;
        }).when(products).updateItemSnapshot(anyLong(), anyLong(), anyString(), anyLong());
    }

    @Test
    void eligibleThemeGetsOneTwoSeatAndOneFourSeatProductBoundToItOnly() {
        List<TopicSeatProducts.Change> changes = sync.sync(TOPIC);

        assertEquals("[2:CREATED#901, 4:CREATED#902]", changes.toString());
        MarketingProduct two = byCode.get("SEAT2-T" + TOPIC);
        MarketingProduct four = byCode.get("SEAT4-T" + TOPIC);
        assertProductShape(two, 2, "49.90", "城南夜游·双人票");
        assertProductShape(four, 4, "89.90", "城南夜游·四人小队票");
        for (MarketingProduct p : List.of(two, four)) {
            List<MarketingProductItem> items = itemsByProduct.get(p.getId());
            assertEquals(1, items.size(), "只绑定一个主题");
            assertEquals(TOPIC, items.get(0).getTopicId());
            assertEquals("城南夜游", items.get(0).getTopicTitle());
            assertEquals(7L, items.get(0).getContentRevision());
        }
    }

    @Test
    void secondRunChangesNothing() {
        sync.sync(TOPIC);
        List<TopicSeatProducts.Change> again = sync.sync(TOPIC);

        assertEquals("[2:UNCHANGED#901, 4:UNCHANGED#902]", again.toString());
        verify(products, never()).updateSeatProduct(anyLong(), anyString(), anyLong(), anyString(), any(), anyInt(), any());
        verify(products, never()).updateItemSnapshot(anyLong(), anyLong(), anyString(), anyLong());
        assertEquals(2, byCode.size());
    }

    @Test
    void selfPlayPriceChangeMovesBothPricesAndBumpsRevision() {
        sync.sync(TOPIC);
        topic.setSelfPlayPrice(new BigDecimal("39.00"));

        assertEquals("[2:UPDATED#901, 4:UPDATED#902]", sync.sync(TOPIC).toString());

        assertEquals(new BigDecimal("64.90"), byCode.get("SEAT2-T" + TOPIC).getCashPrice());
        assertEquals(new BigDecimal("117.90"), byCode.get("SEAT4-T" + TOPIC).getCashPrice());
        assertEquals(2L, byCode.get("SEAT2-T" + TOPIC).getRevision());
        assertEquals(1, byCode.get("SEAT2-T" + TOPIC).getStatus());
    }

    @Test
    void renameAndRepublishRefreshNameAndBindingSnapshot() {
        sync.sync(TOPIC);
        topic.setName("  城北晨跑  ");
        topic.setPublishedConfigVersion(8L);

        sync.sync(TOPIC);

        MarketingProduct two = byCode.get("SEAT2-T" + TOPIC);
        assertEquals("城北晨跑·双人票", two.getProductName());
        assertEquals(2L, two.getRevision());
        MarketingProductItem item = itemsByProduct.get(two.getId()).get(0);
        assertEquals("城北晨跑", item.getTopicTitle());
        assertEquals(8L, item.getContentRevision());
    }

    @Test
    void themeThatStopsBeingEligibleTakesItsSeatProductsOffSaleWithoutDeleting() {
        sync.sync(TOPIC);
        topic.setSelfPlay(0);

        assertEquals("[2:DEACTIVATED#901, 4:DEACTIVATED#902]", sync.sync(TOPIC).toString());
        assertEquals(0, byCode.get("SEAT2-T" + TOPIC).getStatus());
        assertEquals(0, byCode.get("SEAT4-T" + TOPIC).getStatus());
        assertEquals(new BigDecimal("49.90"), byCode.get("SEAT2-T" + TOPIC).getCashPrice(), "价格不动");
        assertEquals(2, byCode.size(), "行不删除");

        assertEquals("[2:UNCHANGED#901, 4:UNCHANGED#902]", sync.sync(TOPIC).toString(), "已下架再跑不改");

        topic.setSelfPlay(1);
        assertEquals("[2:UPDATED#901, 4:UPDATED#902]", sync.sync(TOPIC).toString());
        assertEquals(1, byCode.get("SEAT2-T" + TOPIC).getStatus(), "重新可售即重新上架");
    }

    @Test
    void ineligibleThemeWithoutSeatProductsCreatesNothing() {
        when(roles.isPlatformOwned(TOPIC)).thenReturn(false);

        assertEquals("[2:NONE, 4:NONE]", sync.sync(TOPIC).toString());
        verify(products, never()).insertProduct(any());
        verify(products, never()).insertItem(any());
    }

    @Test
    void deletedOrMissingThemeDeactivates() {
        sync.sync(TOPIC);
        topic = null;
        assertEquals("[2:DEACTIVATED#901, 4:DEACTIVATED#902]", sync.sync(TOPIC).toString());
    }

    @Test
    void ownerStoppedSaleStaysStoppedButFollowsPrice() {
        sync.sync(TOPIC);
        byCode.get("SEAT4-T" + TOPIC).setStatus(MarketingProduct.STATUS_OFF_SALE);
        topic.setSelfPlayPrice(new BigDecimal("39.00"));

        sync.sync(TOPIC);

        MarketingProduct four = byCode.get("SEAT4-T" + TOPIC);
        assertEquals(MarketingProduct.STATUS_OFF_SALE, four.getStatus());
        assertEquals(new BigDecimal("117.90"), four.getCashPrice());
    }

    @Test
    void codeHeldByAnotherShapeIsNeverTouched() {
        MarketingProduct foreign = new MarketingProduct();
        foreign.setId(77L);
        foreign.setProductCode("SEAT2-T" + TOPIC);
        foreign.setProductKind(MarketingProduct.KIND_CITY_BUNDLE);
        foreign.setFulfillmentRoute(MarketingProduct.ROUTE_SELF_PLAY_GRANT);
        foreign.setSeatCount(2);
        foreign.setRevision(3L);
        foreign.setStatus(1);
        foreign.setCashPrice(new BigDecimal("10.00"));
        byCode.put(foreign.getProductCode(), foreign);
        MarketingProductItem a = new MarketingProductItem();
        a.setProductId(77L);
        a.setTopicId(TOPIC);
        MarketingProductItem b = new MarketingProductItem();
        b.setProductId(77L);
        b.setTopicId(TOPIC + 1);
        itemsByProduct.put(77L, new ArrayList<>(List.of(a, b)));

        List<TopicSeatProducts.Change> changes = sync.sync(TOPIC);

        assertEquals("2:FOREIGN_SKIPPED#77", changes.get(0).toString());
        assertEquals(new BigDecimal("10.00"), byCode.get("SEAT2-T" + TOPIC).getCashPrice());
        assertEquals(3L, byCode.get("SEAT2-T" + TOPIC).getRevision());
        verify(products, never()).updateSeatProduct(eq(77L), anyString(), anyLong(), anyString(), any(), anyInt(), any());
        assertEquals("4:CREATED#901", changes.get(1).toString());
    }

    @Test
    void concurrentModificationFailsLoudly() {
        sync.sync(TOPIC);
        org.mockito.Mockito.doReturn(0).when(products).updateSeatProduct(anyLong(), anyString(), anyLong(),
                anyString(), any(BigDecimal.class), anyInt(), any(Date.class));
        topic.setSelfPlayPrice(new BigDecimal("39.00"));

        assertThrows(IllegalStateException.class, () -> sync.sync(TOPIC));
    }

    @Test
    void eligibilityMatchesFulfillmentPreconditions() {
        assertNull(TopicSeatProducts.ineligibleReason(eligibleTopic("29.90"), true));
        assertEquals("TOPIC_MISSING", TopicSeatProducts.ineligibleReason(null, true));
        assertEquals("NOT_PLATFORM_OWNED", TopicSeatProducts.ineligibleReason(eligibleTopic("29.90"), false));

        CmsTopic deleted = eligibleTopic("29.90");
        deleted.setDelFlag(2);
        assertEquals("TOPIC_DELETED", TopicSeatProducts.ineligibleReason(deleted, true));

        CmsTopic off = eligibleTopic("29.90");
        off.setSelfPlay(null);
        assertEquals("SELF_PLAY_OFF", TopicSeatProducts.ineligibleReason(off, true));

        assertEquals("SELF_PLAY_PRICE_MISSING", TopicSeatProducts.ineligibleReason(eligibleTopic("0"), true));
        CmsTopic noPrice = eligibleTopic("29.90");
        noPrice.setSelfPlayPrice(null);
        assertEquals("SELF_PLAY_PRICE_MISSING", TopicSeatProducts.ineligibleReason(noPrice, true));

        CmsTopic noFee = eligibleTopic("29.90");
        noFee.setFeePlatformRate(null);
        assertEquals("FEE_SNAPSHOT_MISSING", TopicSeatProducts.ineligibleReason(noFee, true));

        CmsTopic noWindow = eligibleTopic("29.90");
        noWindow.setEndDate(null);
        assertEquals("FULFILLMENT_WINDOW_MISSING", TopicSeatProducts.ineligibleReason(noWindow, true));

        CmsTopic endOnly = eligibleTopic("29.90");
        endOnly.setStartDate(null);
        assertEquals("FULFILLMENT_WINDOW_MISSING", TopicSeatProducts.ineligibleReason(endOnly, true));

        CmsTopic reversed = eligibleTopic("29.90");
        reversed.setEndDate(new Date(reversed.getStartDate().getTime() - 3L * 24 * 3600 * 1000));
        assertEquals("FULFILLMENT_WINDOW_MISSING", TopicSeatProducts.ineligibleReason(reversed, true));
    }

    @Test
    void openEndedSelfPlayRouteIsEligibleWithUnchangedPrices() {
        CmsTopic open = openEnded(eligibleTopic("29.90"));
        assertNull(TopicSeatProducts.ineligibleReason(open, true), "start/end 都为空的平台自玩路线可售");
        // 其它条件照旧：开放式也不能绕过自营 / 自玩 / 价格 / 费率。
        assertEquals("NOT_PLATFORM_OWNED", TopicSeatProducts.ineligibleReason(open, false));
        CmsTopic off = openEnded(eligibleTopic("29.90"));
        off.setSelfPlay(0);
        assertEquals("SELF_PLAY_OFF", TopicSeatProducts.ineligibleReason(off, true));
        assertEquals("SELF_PLAY_PRICE_MISSING", TopicSeatProducts.ineligibleReason(openEnded(eligibleTopic("0")), true));
        assertEquals("SELF_PLAY_PRICE_NOT_CENTS",
                TopicSeatProducts.ineligibleReason(openEnded(eligibleTopic("29.905")), true));
        CmsTopic noFee = openEnded(eligibleTopic("29.90"));
        noFee.setFeePlatformRate(null);
        assertEquals("FEE_SNAPSHOT_MISSING", TopicSeatProducts.ineligibleReason(noFee, true));

        topic = openEnded(eligibleTopic("29.90"));
        sync.sync(TOPIC);
        assertProductShape(byCode.get("SEAT2-T4242"), 2, "49.90", "城南夜游·双人票");
        assertProductShape(byCode.get("SEAT4-T4242"), 4, "89.90", "城南夜游·四人小队票");
    }

    @Test
    void openEndedRouteThatGetsOnlyOneDateLosesItsSeatProducts() {
        topic = openEnded(eligibleTopic("29.90"));
        sync.sync(TOPIC);
        topic.setStartDate(new Date(1798732800000L));
        sync.sync(TOPIC);
        assertEquals(MarketingProduct.STATUS_DRAFT, byCode.get("SEAT2-T4242").getStatus().intValue());
        assertEquals(MarketingProduct.STATUS_DRAFT, byCode.get("SEAT4-T4242").getStatus().intValue());
    }

    private static CmsTopic openEnded(CmsTopic t) {
        t.setStartDate(null);
        t.setEndDate(null);
        return t;
    }

    @Test
    void namesComeFromThemeNameAndFitTheColumn() {
        assertEquals("城南夜游·双人票", TopicSeatProducts.productName("城南夜游", 2));
        assertEquals("城南夜游·四人小队票", TopicSeatProducts.productName("城南夜游", 4));
        assertEquals("双人票", TopicSeatProducts.productName("  ", 2));
        assertEquals("四人小队票", TopicSeatProducts.productName(null, 4));
        String longName = "长".repeat(300);
        String name = TopicSeatProducts.productName(longName, 4);
        assertEquals(120, name.codePointCount(0, name.length()));
        assertTrue(name.endsWith("·四人小队票"));
        String emoji = "🌃".repeat(200);
        String emojiName = TopicSeatProducts.productName(emoji, 2);
        assertEquals(120, emojiName.codePointCount(0, emojiName.length()), "按码点截断，不切半个代理对");
        assertEquals("SEAT2-T4242", TopicSeatProducts.productCode(4242L, 2));
        assertEquals("SEAT4-T4242", TopicSeatProducts.productCode(4242L, 4));
    }

    @Test
    void unpublishedLinearThemeBindsRevisionOne() {
        topic.setPublishedConfigVersion(null);
        sync.sync(TOPIC);
        ArgumentCaptor<MarketingProductItem> item = ArgumentCaptor.forClass(MarketingProductItem.class);
        verify(products, org.mockito.Mockito.times(2)).insertItem(item.capture());
        assertEquals(1L, item.getValue().getContentRevision());
    }

    private static void assertProductShape(MarketingProduct p, int seats, String price, String name) {
        assertEquals(name, p.getProductName());
        assertEquals(1, p.getProductKind());
        assertEquals(2, p.getPurchaseKind());
        assertEquals(0, p.getExploreCapacity());
        assertEquals(MarketingProduct.ROUTE_SELF_PLAY_GRANT, p.getFulfillmentRoute());
        assertNull(p.getTicketId());
        assertNull(p.getParentProductId());
        assertNull(p.getPointsPrice());
        assertEquals(seats, p.getSeatCount());
        assertEquals(new BigDecimal(price), p.getCashPrice());
        assertEquals(MarketingProduct.VALIDITY_NONE, p.getValidityKind());
        assertEquals(TopicSeatProducts.TERMS_VERSION, p.getTermsVersion());
        assertEquals(1, p.getStatus());
        assertEquals(1L, p.getRevision());
        assertEquals(0, p.getGiftAllowed());
    }

    private static CmsTopic eligibleTopic(String selfPlayPrice) {
        CmsTopic t = new CmsTopic();
        t.setId(TOPIC);
        t.setName("城南夜游");
        t.setDelFlag(0);
        t.setSelfPlay(1);
        t.setSelfPlayPrice(new BigDecimal(selfPlayPrice));
        t.setFeePlatformRate(new BigDecimal("0.0000"));
        t.setPublishedConfigVersion(7L);
        Date start = new Date(1798732800000L);
        t.setStartDate(start);
        t.setEndDate(new Date(start.getTime() + 30L * 24 * 3600 * 1000));
        return t;
    }

    private static MarketingProduct copy(MarketingProduct p) {
        if (p == null) return null;
        MarketingProduct c = new MarketingProduct();
        c.setId(p.getId());
        c.setProductCode(p.getProductCode());
        c.setProductName(p.getProductName());
        c.setProductKind(p.getProductKind());
        c.setPurchaseKind(p.getPurchaseKind());
        c.setExploreCapacity(p.getExploreCapacity());
        c.setFulfillmentRoute(p.getFulfillmentRoute());
        c.setTicketId(p.getTicketId());
        c.setParentProductId(p.getParentProductId());
        c.setCashPrice(p.getCashPrice());
        c.setPointsPrice(p.getPointsPrice());
        c.setValidityKind(p.getValidityKind());
        c.setSeatCount(p.getSeatCount());
        c.setGiftAllowed(p.getGiftAllowed());
        c.setStatus(p.getStatus());
        c.setTermsVersion(p.getTermsVersion());
        c.setRevision(p.getRevision());
        return c;
    }
}
