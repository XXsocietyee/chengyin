package com.chengyinhub.business.service;

import com.chengyinhub.business.service.support.SeatTicketPricing;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** owner 2026-11-24 批准的多人票价格规则：list × 折扣率后取不低于它的最小 .9 元，封顶 list。 */
class SeatTicketPricingTest {

    private static BigDecimal price(String single, int seats) {
        return SeatTicketPricing.price(new BigDecimal(single), seats);
    }

    @Test
    void ownerExamples() {
        assertEquals(new BigDecimal("49.90"), price("29.90", 2));   // list 59.80 × 0.83 = 49.634
        assertEquals(new BigDecimal("89.90"), price("29.90", 4));   // list 119.60 × 0.75 = 89.70
        assertEquals(new BigDecimal("64.90"), price("39.00", 2));   // list 78.00 × 0.83 = 64.74
        assertEquals(new BigDecimal("117.90"), price("39.00", 4));  // list 156.00 × 0.75 = 117.00
        assertEquals(5980L, SeatTicketPricing.listCents(new BigDecimal("29.90"), 2));
        assertEquals(11960L, SeatTicketPricing.listCents(new BigDecimal("29.90"), 4));
    }

    @Test
    void valueAlreadyEndingInNineStays() {
        // 29.30 × 4 = 117.20；× 0.75 = 87.90 恰好以 .9 结尾，不再上调。
        assertEquals(new BigDecimal("87.90"), price("29.30", 4));
        // 30.00 × 2 = 60.00；× 0.83 = 49.80 → 49.90。
        assertEquals(new BigDecimal("49.90"), price("30.00", 2));
    }

    @Test
    void justAboveNinetyCentsRollsToNextYuan() {
        // 19.97 × 4 = 79.88；× 0.75 = 59.91 → 不低于它的最小 .9 是 60.90。
        assertEquals(new BigDecimal("60.90"), price("19.97", 4));
    }

    @Test
    void cappedAtList() {
        // 0.40 × 2 = 0.80；× 0.83 = 0.664 → 0.90 超过票面 → 封顶 0.80（不打折，但绝不高于票面）。
        assertEquals(new BigDecimal("0.80"), price("0.40", 2));
        // 0.97 × 4 = 3.88；× 0.75 = 2.91 → 3.90 超过票面 → 3.88。
        assertEquals(new BigDecimal("3.88"), price("0.97", 4));
    }

    @Test
    void verySmallPrices() {
        assertEquals(new BigDecimal("0.02"), price("0.01", 2));
        assertEquals(new BigDecimal("0.04"), price("0.01", 4));
        // 1.20 × 2 = 2.40；× 0.83 = 1.992 → 最小 .9 是 2.90，超过票面 → 2.40。
        assertEquals(new BigDecimal("2.40"), price("1.20", 2));
    }

    @Test
    void largePriceKeepsWholeCents() {
        // list 1999.98 × 0.83 = 1659.9834 → 1660.90。
        assertEquals(new BigDecimal("1660.90"), price("999.99", 2));
        // list 3999.96 × 0.75 = 2999.97 → 3000.90。
        assertEquals(new BigDecimal("3000.90"), price("999.99", 4));
    }

    @Test
    void invariantsHoldForEveryCentUpTo300Yuan() {
        for (long cents = 1; cents <= 30000; cents++) {
            BigDecimal single = BigDecimal.valueOf(cents, 2);
            for (int seats : SeatTicketPricing.SEAT_COUNTS) {
                long list = cents * seats;
                long rate = SeatTicketPricing.ratePercent(seats);
                long priced = SeatTicketPricing.priceCents(single, seats);
                assertTrue(priced <= list, "不得高于票面 " + single + "×" + seats);
                assertTrue(priced > 0, "必须为正 " + single);
                if (priced < list) {
                    assertEquals(90L, priced % 100, "未封顶时必须以 .9 元结尾 " + single + "×" + seats);
                    assertTrue(priced * 100 >= list * rate, "不得低于 list × 折扣率 " + single + "×" + seats);
                    assertTrue((priced - 100) * 100 < list * rate, "必须是满足条件的最小 .9 元 " + single + "×" + seats);
                } else {
                    // 封顶：不低于折扣价的最小 .9 元超过了票面。
                    long target = (list * rate + 99) / 100;
                    long endingNine = target + Math.floorMod(90 - target, 100L);
                    assertTrue(endingNine >= list, "只有 .9 价超过票面时才封顶 " + single + "×" + seats);
                }
                assertEquals(BigDecimal.valueOf(priced, 2), SeatTicketPricing.price(single, seats));
            }
        }
    }

    @Test
    void rejectsMissingOrFractionalCentPricesAndOtherSeatCounts() {
        assertThrows(IllegalArgumentException.class, () -> SeatTicketPricing.price(null, 2));
        assertThrows(IllegalArgumentException.class, () -> price("0", 2));
        assertThrows(IllegalArgumentException.class, () -> price("-1.00", 2));
        assertThrows(IllegalArgumentException.class, () -> price("29.905", 2));
        assertThrows(IllegalArgumentException.class, () -> price("29.90", 3));
        assertThrows(IllegalArgumentException.class, () -> price("29.90", 1));
        assertEquals(new BigDecimal("49.90"), price("29.9", 2));
        assertEquals(new BigDecimal("49.90"), price("29.9000", 2));
    }
}
