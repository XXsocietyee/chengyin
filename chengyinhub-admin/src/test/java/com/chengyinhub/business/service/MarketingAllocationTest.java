package com.chengyinhub.business.service;

import com.chengyinhub.business.domain.MarketingProduct;
import com.chengyinhub.business.domain.MarketingProductItem;
import com.chengyinhub.business.domain.MarketingProductOrder;
import com.chengyinhub.business.exception.MarketingProductException;
import com.chengyinhub.business.service.support.ChannelGrantPlanner;
import com.chengyinhub.business.service.support.MarketingAllocation;
import com.chengyinhub.business.service.GrantLine;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** 分摊守恒 + kind→PurchaseKind 映射（M3 提供给 M2-F 的唯一输入）。 */
class MarketingAllocationTest {

    private static final long PRODUCT = 10L;

    @Test
    void allocationConservesTotalAndKeepsRealShares() {
        MarketingProduct product = product();
        List<MarketingProductItem> items = Arrays.asList(item(100L), item(101L), item(102L));
        List<BigDecimal> listPrices = Arrays.asList(
                new BigDecimal("19.99"), new BigDecimal("19.99"), new BigDecimal("19.99"));

        List<GrantLine> lines = MarketingAllocation.lines(
                product, items, listPrices, new BigDecimal("39.99"));

        assertEquals(3, lines.size());
        BigDecimal sum = BigDecimal.ZERO;
        for (GrantLine line : lines) {
            sum = sum.add(line.payableAmount);
            assertTrue(line.payableAmount.signum() >= 0);
            assertTrue(line.payableAmount.compareTo(line.listAmount) <= 0);
            assertFalse(line.exploreCapacity);
        }
        assertEquals(0, sum.compareTo(new BigDecimal("39.99")));
    }

    @Test
    void exploreTicketsOnlyRowCarriesCapacityFlag() {
        MarketingProduct product = product();
        product.setPurchaseKind(3);
        product.setExploreCapacity(1);
        List<MarketingProductItem> items = Arrays.asList(item(100L));
        List<BigDecimal> prices = Arrays.asList(new BigDecimal("19.99"));

        List<GrantLine> lines = MarketingAllocation.lines(
                product, items, prices, new BigDecimal("19.99"));

        assertEquals(GrantLine.VALIDITY_RELATIVE_DAYS, lines.get(0).validityKind);
        assertTrue(lines.get(0).exploreCapacity);
    }

    @Test
    void allocationRejectsNonConservingOrOverListAmounts() {
        MarketingProduct product = product();
        List<MarketingProductItem> items = Arrays.asList(item(100L));
        List<BigDecimal> prices = Arrays.asList(new BigDecimal("10.00"));

        assertThrows(IllegalStateException.class, () -> MarketingAllocation.lines(
                product, items, prices, new BigDecimal("39.99")));
        assertThrows(IllegalArgumentException.class, () -> MarketingAllocation.lines(
                product, items, prices, BigDecimal.ZERO));
    }

    @Test
    void negativeOrMissingPricesFallBackToUnitWeight() {
        MarketingProduct product = product();
        List<MarketingProductItem> items = Arrays.asList(item(100L), item(101L));
        List<BigDecimal> prices = Arrays.asList(null, BigDecimal.ZERO);

        List<GrantLine> lines = MarketingAllocation.lines(
                product, items, prices, new BigDecimal("10.00"));

        assertEquals(0, lines.get(0).payableAmount.add(lines.get(1).payableAmount)
                .compareTo(new BigDecimal("10.00")));
    }

    // ---------------------------------------------------------------- 自玩多席票面（owner 2026-11-22）
    // 金额均为测试夹具（FIXTURE），不是批准价格：单人自玩价 29.90，双人票 49.90，四人小队票 89.90。
    private static final BigDecimal FIXTURE_SINGLE = new BigDecimal("29.90");
    private static final BigDecimal FIXTURE_TWO = new BigDecimal("49.90");
    private static final BigDecimal FIXTURE_FOUR = new BigDecimal("89.90");

    @Test
    void singleSeatSelfPlayRowKeepsSinglePersonListExactlyAsBefore() {
        MarketingProduct single = selfPlay(1);
        List<GrantLine> lines = MarketingAllocation.lines(
                single, Arrays.asList(item(100L)), Arrays.asList(FIXTURE_SINGLE), FIXTURE_SINGLE);
        assertMoney("29.90", lines.get(0).listAmount);
        assertMoney("29.90", lines.get(0).payableAmount);
        assertMoney("0.00", lines.get(0).listAmount.subtract(lines.get(0).payableAmount));

        // 单席行的票面不随份数放大（与改动前逐字节一致）：2 份单人价仍超票面即拒。
        IllegalStateException overList = assertThrows(IllegalStateException.class, () -> MarketingAllocation.lines(
                single, Arrays.asList(item(100L)), Arrays.asList(FIXTURE_SINGLE), new BigDecimal("59.80"), 2));
        assertEquals("ALLOCATION_EXCEEDS_LIST", overList.getMessage());
        assertEquals(0, MarketingAllocation.rowListAmount(single, FIXTURE_SINGLE, 3).compareTo(FIXTURE_SINGLE));
    }

    @Test
    void twoSeatSelfPlayRowListIsSinglePriceTimesSeats() {
        List<GrantLine> lines = MarketingAllocation.lines(
                selfPlay(2), Arrays.asList(item(100L)), Arrays.asList(FIXTURE_SINGLE), FIXTURE_TWO, 1);
        assertMoney("59.80", lines.get(0).listAmount);
        assertMoney("49.90", lines.get(0).payableAmount);
        assertMoney("9.90", lines.get(0).listAmount.subtract(lines.get(0).payableAmount));
    }

    @Test
    void fourSeatSelfPlayRowListIsSinglePriceTimesSeats() {
        List<GrantLine> lines = MarketingAllocation.lines(
                selfPlay(4), Arrays.asList(item(100L)), Arrays.asList(FIXTURE_SINGLE), FIXTURE_FOUR, 1);
        assertMoney("119.60", lines.get(0).listAmount);
        assertMoney("89.90", lines.get(0).payableAmount);
        assertMoney("29.70", lines.get(0).listAmount.subtract(lines.get(0).payableAmount));
    }

    @Test
    void multiSeatListAlsoMultipliesByQuantity() {
        List<GrantLine> lines = MarketingAllocation.lines(selfPlay(2), Arrays.asList(item(100L)),
                Arrays.asList(FIXTURE_SINGLE), FIXTURE_TWO.multiply(BigDecimal.valueOf(2)), 2);
        assertMoney("119.60", lines.get(0).listAmount);
        assertMoney("99.80", lines.get(0).payableAmount);
    }

    @Test
    void multiSeatPayableAboveNewListIsStillRejectedSoDiscountNeverGoesNegative() {
        IllegalStateException two = assertThrows(IllegalStateException.class, () -> MarketingAllocation.lines(
                selfPlay(2), Arrays.asList(item(100L)), Arrays.asList(FIXTURE_SINGLE), new BigDecimal("59.81"), 1));
        assertEquals("ALLOCATION_EXCEEDS_LIST", two.getMessage());
        IllegalStateException four = assertThrows(IllegalStateException.class, () -> MarketingAllocation.lines(
                selfPlay(4), Arrays.asList(item(100L)), Arrays.asList(FIXTURE_SINGLE), new BigDecimal("119.61"), 1));
        assertEquals("ALLOCATION_EXCEEDS_LIST", four.getMessage());
        // 恰好等于票面：折扣为 0，不为负。
        List<GrantLine> exact = MarketingAllocation.lines(
                selfPlay(2), Arrays.asList(item(100L)), Arrays.asList(FIXTURE_SINGLE), new BigDecimal("59.80"), 1);
        assertMoney("0.00", exact.get(0).listAmount.subtract(exact.get(0).payableAmount));
    }

    @Test
    void seatsOnOtherRoutesDoNotChangeTheList() {
        MarketingProduct ticketRoute = selfPlay(4);
        ticketRoute.setFulfillmentRoute(MarketingProduct.ROUTE_TICKET_REGISTRATION);
        MarketingProduct extraSeat = selfPlay(4);
        extraSeat.setFulfillmentRoute(MarketingProduct.ROUTE_EXTRA_SEAT_GRANT);
        MarketingProduct noRoute = selfPlay(4);
        noRoute.setFulfillmentRoute(null);
        assertFalse(MarketingAllocation.isMultiSeatSelfPlay(ticketRoute));
        assertFalse(MarketingAllocation.isMultiSeatSelfPlay(extraSeat));
        assertFalse(MarketingAllocation.isMultiSeatSelfPlay(noRoute));
        assertEquals(0, MarketingAllocation.rowListAmount(ticketRoute, FIXTURE_SINGLE, 1).compareTo(FIXTURE_SINGLE));
        assertTrue(MarketingAllocation.isMultiSeatSelfPlay(selfPlay(2)));
    }

    @Test
    void multiSeatBundleKeepsSinglePriceWeightsAndScalesEachRowList() {
        List<GrantLine> lines = MarketingAllocation.lines(selfPlay(2), Arrays.asList(item(100L), item(101L)),
                Arrays.asList(new BigDecimal("30.00"), new BigDecimal("10.00")), new BigDecimal("60.00"), 1);
        assertMoney("60.00", lines.get(0).listAmount);
        assertMoney("20.00", lines.get(1).listAmount);
        assertMoney("45.00", lines.get(0).payableAmount);
        assertMoney("15.00", lines.get(1).payableAmount);
    }

    @Test
    void channelSameKindCapUsesTheSameFormula() {
        // 单席：此前口径 = 单人价 × 份数（不变）。
        assertMoney("59.80", ChannelGrantPlanner.listCap(selfPlay(1), FIXTURE_SINGLE, 2));
        // 多席：单人价 × 每份席位 × 份数，与站内行票面同一公式。
        assertMoney("119.60", ChannelGrantPlanner.listCap(selfPlay(2), FIXTURE_SINGLE, 2));
        assertMoney("119.60", ChannelGrantPlanner.listCap(selfPlay(4), FIXTURE_SINGLE, 1));
        assertEquals(0, ChannelGrantPlanner.listCap(selfPlay(4), FIXTURE_SINGLE, 1)
                .compareTo(MarketingAllocation.rowListAmount(selfPlay(4), FIXTURE_SINGLE, 1)));
    }

    private MarketingProduct selfPlay(int seats) {
        MarketingProduct product = product();
        product.setProductKind(MarketingProduct.KIND_SINGLE_QUEST);
        product.setFulfillmentRoute(MarketingProduct.ROUTE_SELF_PLAY_GRANT);
        product.setSeatCount(seats);
        return product;
    }

    private static void assertMoney(String expected, BigDecimal actual) {
        assertEquals(0, new BigDecimal(expected).compareTo(actual), "expected " + expected + " but was " + actual);
    }

    private MarketingProduct product() {
        MarketingProduct product = new MarketingProduct();
        product.setId(PRODUCT);
        product.setProductKind(MarketingProduct.KIND_CITY_BUNDLE);
        product.setPurchaseKind(2);
        product.setExploreCapacity(0);
        product.setValidityKind(MarketingProduct.VALIDITY_RELATIVE_DAYS);
        product.setValidDays(7);
        return product;
    }

    private MarketingProductItem item(long topicId) {
        MarketingProductItem item = new MarketingProductItem();
        item.setProductId(PRODUCT);
        item.setTopicId(topicId);
        item.setContentRevision(5L);
        return item;
    }
}
