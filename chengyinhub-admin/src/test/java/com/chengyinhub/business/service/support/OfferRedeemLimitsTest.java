package com.chengyinhub.business.service.support;

import org.junit.jupiter.api.Test;

import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/** 每日名额 / 开始日期的判定与文案(柜台与玩家端共用同一句)。 */
class OfferRedeemLimitsTest {
    private static final LocalDate TODAY = LocalDate.of(2026, 11, 23);

    @Test
    void nullMeansNoLimit() {
        assertNull(OfferRedeemLimits.rejection(null, null, 500, TODAY));
    }

    @Test
    void capacityIsReachedAtExactlyTheDeclaredNumber() {
        assertNull(OfferRedeemLimits.rejection(20, null, 19, TODAY));
        assertEquals("今日名额已满，请改天再来", OfferRedeemLimits.rejection(20, null, 20, TODAY));
        assertEquals("今日名额已满，请改天再来", OfferRedeemLimits.rejection(20, null, 21, TODAY));
    }

    @Test
    void startDateIsInclusiveAndWordedWithMonthAndDay() {
        assertEquals("权益还没开始，12月1日起可用",
                OfferRedeemLimits.rejection(null, LocalDate.of(2026, 12, 1), 0, TODAY));
        assertNull(OfferRedeemLimits.rejection(null, TODAY, 0, TODAY));
        assertNull(OfferRedeemLimits.rejection(null, TODAY.minusDays(1), 0, TODAY));
    }

    @Test
    void notStartedWinsOverFullCapacity() {
        assertEquals("权益还没开始，11月24日起可用",
                OfferRedeemLimits.rejection(1, TODAY.plusDays(1), 1, TODAY));
    }

    @Test
    void parseDateAcceptsDateAndDateTimeText() {
        assertEquals(TODAY, OfferRedeemLimits.parseDate("2026-11-23"));
        assertEquals(TODAY, OfferRedeemLimits.parseDate("2026-11-23 00:00:00"));
        assertNull(OfferRedeemLimits.parseDate(null));
        assertNull(OfferRedeemLimits.parseDate("明天"));
    }
}
