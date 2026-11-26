package com.chengyinhub.business.service;

import com.chengyinhub.business.mapper.MerchantChapterOfferMapper;
import com.chengyinhub.business.mapper.RegistrationEntitlementMapper;
import com.chengyinhub.business.service.impl.PerkLedgerServiceImpl;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** P1-7:暂停新售的供给不计入可售容量;没有暂停供给或库里没有该列时,容量与原公式一致。 */
class PerkLedgerPausedCapacityTest {
    private static final Long CH = 33L;
    private MerchantChapterOfferMapper offers;
    private RegistrationEntitlementMapper entitlements;
    private PerkLedgerServiceImpl service;

    @BeforeEach
    void setUp() {
        offers = mock(MerchantChapterOfferMapper.class);
        entitlements = mock(RegistrationEntitlementMapper.class);
        service = new PerkLedgerServiceImpl();
        ReflectionTestUtils.setField(service, "offerMapper", offers);
        ReflectionTestUtils.setField(service, "entitlementMapper", entitlements);
    }

    private void supply(int remaining, int held) {
        when(offers.sumRemainingQuotaByChapter(CH)).thenReturn(remaining);
        when(entitlements.countUnredeemedByChapter(CH)).thenReturn(held);
        when(offers.sumRemainingQuotaByChapterForUpdate(CH)).thenReturn(remaining);
        when(entitlements.countUnredeemedByChapterForUpdate(CH)).thenReturn(held);
    }

    private int currentReadCapacity() {
        Integer value = ReflectionTestUtils.invokeMethod(service, "chapterCapacityForUpdate", CH);
        return value;
    }

    @Test
    void pausedRemainingIsSubtractedFromSellableCapacity() {
        supply(10, 3);
        when(offers.sumPausedRemainingQuotaByChapter(CH)).thenReturn(4);
        when(offers.sumPausedRemainingQuotaByChapterForUpdate(CH)).thenReturn(4);
        assertEquals(3, service.chapterCapacity(CH));
        assertEquals(3, currentReadCapacity());
    }

    @Test
    void purchasePathReadsPausedSupplyWithCurrentReadOnly() {
        supply(10, 3);
        currentReadCapacity();
        verify(offers).sumPausedRemainingQuotaByChapterForUpdate(CH);
        verify(offers, never()).sumPausedRemainingQuotaByChapter(anyLong());
    }

    @Test
    void fullyPausedChapterStopsSellingAtZeroNotBelow() {
        supply(10, 3);
        when(offers.sumPausedRemainingQuotaByChapter(CH)).thenReturn(10);
        when(offers.sumPausedRemainingQuotaByChapterForUpdate(CH)).thenReturn(10);
        assertEquals(0, service.chapterCapacity(CH));
        assertEquals(0, currentReadCapacity());
    }

    @Test
    void noPausedOfferKeepsTheOriginalFormula() {
        supply(8, 4);
        assertEquals(4, service.chapterCapacity(CH));
        assertEquals(4, currentReadCapacity());
    }

    @Test
    void oversoldChapterStaysNegativeAndSkipsThePausedQuery() {
        supply(2, 5);
        when(offers.sumPausedRemainingQuotaByChapter(CH)).thenReturn(2);
        assertEquals(-3, service.chapterCapacity(CH));
        assertEquals(-3, currentReadCapacity());
        verify(offers, never()).sumPausedRemainingQuotaByChapter(anyLong());
        verify(offers, never()).sumPausedRemainingQuotaByChapterForUpdate(anyLong());
    }

    @Test
    void missingColumnFailsOpenToTodaysCapacity() {
        supply(8, 4);
        when(offers.sumPausedRemainingQuotaByChapter(CH))
                .thenThrow(new org.springframework.jdbc.BadSqlGrammarException("select", "sql",
                        new java.sql.SQLException("Unknown column 'sale_paused' in 'where clause'")));
        when(offers.sumPausedRemainingQuotaByChapterForUpdate(CH))
                .thenThrow(new IllegalStateException("Unknown column 'sale_paused'"));
        assertEquals(4, service.chapterCapacity(CH));
        assertEquals(4, currentReadCapacity());
    }

    @Test
    void nullOrNegativePausedSumIsTreatedAsNothingPaused() {
        supply(8, 4);
        when(offers.sumPausedRemainingQuotaByChapter(CH)).thenReturn(null);
        when(offers.sumPausedRemainingQuotaByChapterForUpdate(CH)).thenReturn(-2);
        assertEquals(4, service.chapterCapacity(CH));
        assertEquals(4, currentReadCapacity());
    }
}
