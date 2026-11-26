package com.chengyinhub.business.service;

import com.chengyinhub.business.domain.MerchantChapterApplication;
import com.chengyinhub.business.mapper.MerchantChapterApplicationMapper;
import com.chengyinhub.business.mapper.MerchantChapterOfferMapper;
import com.chengyinhub.business.service.impl.MerchantChapterApplicationServiceImpl;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** P1-7:「我的申请」回显暂停新售;库里没有该列时列表照常返回,只缺这一项。 */
class MerchantChapterApplicationSalePausedTest {
    private static final Long MERCHANT = 500L;
    private MerchantChapterApplicationMapper applications;
    private MerchantChapterOfferMapper offers;
    private MerchantChapterApplicationServiceImpl service;

    @BeforeEach
    void setUp() {
        applications = mock(MerchantChapterApplicationMapper.class);
        offers = mock(MerchantChapterOfferMapper.class);
        service = new MerchantChapterApplicationServiceImpl();
        ReflectionTestUtils.setField(service, "applicationMapper", applications);
        ReflectionTestUtils.setField(service, "offerMapper", offers);
        when(applications.selectByMerchantId(MERCHANT)).thenReturn(Arrays.asList(row(1L, 11L), row(2L, 12L), row(3L, null)));
    }

    private static MerchantChapterApplication row(Long id, Long offerId) {
        MerchantChapterApplication row = new MerchantChapterApplication();
        row.setId(id);
        row.setOfferId(offerId);
        return row;
    }

    @Test
    void onlyTheMerchantsPausedOffersAreMarked() {
        when(offers.selectSalePausedIdsByMerchant(MERCHANT)).thenReturn(Collections.singletonList(12L));
        List<MerchantChapterApplication> rows = service.selectMine(MERCHANT);
        assertNull(rows.get(0).getOfferSalePaused());
        assertEquals(Boolean.TRUE, rows.get(1).getOfferSalePaused());
        assertNull(rows.get(2).getOfferSalePaused());
    }

    @Test
    void missingColumnStillReturnsTheList() {
        when(offers.selectSalePausedIdsByMerchant(MERCHANT))
                .thenThrow(new IllegalStateException("Unknown column 'sale_paused'"));
        List<MerchantChapterApplication> rows = service.selectMine(MERCHANT);
        assertEquals(3, rows.size());
        assertNull(rows.get(1).getOfferSalePaused());
    }
}
