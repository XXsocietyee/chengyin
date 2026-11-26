package com.chengyinhub.business.service.impl;

import com.chengyinhub.business.domain.MerchantChapterOffer;
import com.chengyinhub.business.mapper.MerchantChapterOfferMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** P1-2 / 门店照片:每日容量 / 开始日期 / 售罄或替代规则 / 门店照片只收合法值,改动只落本商家的生效行。 */
class MerchantOfferShopTermsTest {

    private static MerchantChapterOffer offer(Long merchantId, int status) {
        MerchantChapterOffer o = new MerchantChapterOffer();
        o.setId(9L);
        o.setMerchantId(merchantId);
        o.setStatus(status);
        return o;
    }

    private static MerchantChapterOffer shopTerms() {
        MerchantChapterOffer t = new MerchantChapterOffer();
        t.setDailyCapacity(30);
        t.setValidStart(java.sql.Date.valueOf("2026-12-01"));
        t.setSoldOutRuleText(" 售罄换同价饮品 ");
        t.setStorefrontImg(" /profile/upload/2026/11/22/store.jpg ");
        return t;
    }

    @Test
    void normalizeTrimsAndRejectsOutOfRangeValues() {
        MerchantChapterOffer o = shopTerms();
        MerchantOfferServiceImpl.normalizeShopTerms(o);
        assertEquals("售罄换同价饮品", o.getSoldOutRuleText());
        assertEquals("/profile/upload/2026/11/22/store.jpg", o.getStorefrontImg());
        o.setSoldOutRuleText("  ");
        o.setStorefrontImg("");
        MerchantOfferServiceImpl.normalizeShopTerms(o);
        assertNull(o.getSoldOutRuleText());
        assertNull(o.getStorefrontImg());

        o.setDailyCapacity(0);
        assertThrows(IllegalStateException.class, () -> MerchantOfferServiceImpl.normalizeShopTerms(o));
        o.setDailyCapacity(MerchantOfferServiceImpl.DAILY_CAPACITY_MAX + 1);
        assertThrows(IllegalStateException.class, () -> MerchantOfferServiceImpl.normalizeShopTerms(o));
        o.setDailyCapacity(null);
        o.setSoldOutRuleText("长".repeat(MerchantOfferServiceImpl.SOLD_OUT_RULE_TEXT_MAX + 1));
        assertThrows(IllegalStateException.class, () -> MerchantOfferServiceImpl.normalizeShopTerms(o));
        o.setSoldOutRuleText(null);
        o.setStorefrontImg("/a.jpg,/b.jpg");
        assertThrows(IllegalStateException.class, () -> MerchantOfferServiceImpl.normalizeShopTerms(o), "只收一张");
        o.setStorefrontImg("/a.jpg\" onerror=\"x");
        assertThrows(IllegalStateException.class, () -> MerchantOfferServiceImpl.normalizeShopTerms(o));
    }

    @Test
    void ownerUpdatesShopTermsOnOwnLiveOffer() {
        MerchantChapterOfferMapper mapper = mock(MerchantChapterOfferMapper.class);
        MerchantOfferServiceImpl svc = new MerchantOfferServiceImpl();
        ReflectionTestUtils.setField(svc, "offerMapper", mapper);
        when(mapper.selectByIdForUpdate(9L)).thenReturn(offer(500L, 1));
        when(mapper.updateDisplayTerms(any())).thenReturn(1);
        when(mapper.updateShopTerms(any())).thenReturn(1);

        svc.setDisplayTerms(9L, 500L, 1, null, 1, shopTerms());

        ArgumentCaptor<MerchantChapterOffer> patch = ArgumentCaptor.forClass(MerchantChapterOffer.class);
        verify(mapper).updateShopTerms(patch.capture());
        assertEquals(9L, patch.getValue().getId());
        assertEquals(500L, patch.getValue().getMerchantId(), "归属随 patch 进 where");
        assertEquals(30, patch.getValue().getDailyCapacity());
        assertEquals(java.sql.Date.valueOf("2026-12-01"), patch.getValue().getValidStart());
        assertEquals("售罄换同价饮品", patch.getValue().getSoldOutRuleText());
        assertEquals("/profile/upload/2026/11/22/store.jpg", patch.getValue().getStorefrontImg());
    }

    @Test
    void legacyCallWithoutShopTermsDoesNotTouchThem() {
        MerchantChapterOfferMapper mapper = mock(MerchantChapterOfferMapper.class);
        MerchantOfferServiceImpl svc = new MerchantOfferServiceImpl();
        ReflectionTestUtils.setField(svc, "offerMapper", mapper);
        when(mapper.selectByIdForUpdate(9L)).thenReturn(offer(500L, 1));
        when(mapper.updateDisplayTerms(any())).thenReturn(1);

        svc.setDisplayTerms(9L, 500L, 1, null, 1);
        svc.setDisplayTerms(9L, 500L, 1, null, 1, null);

        verify(mapper, never()).updateShopTerms(any());
    }

    @Test
    void foreignOrInactiveOfferIsRefusedAndBadValuesNeverReachTheMapper() {
        MerchantChapterOfferMapper mapper = mock(MerchantChapterOfferMapper.class);
        MerchantOfferServiceImpl svc = new MerchantOfferServiceImpl();
        ReflectionTestUtils.setField(svc, "offerMapper", mapper);
        when(mapper.selectByIdForUpdate(9L)).thenReturn(offer(999L, 1));
        assertThrows(IllegalStateException.class, () -> svc.setDisplayTerms(9L, 500L, 1, null, 1, shopTerms()));
        when(mapper.selectByIdForUpdate(9L)).thenReturn(offer(500L, 0));
        assertThrows(IllegalStateException.class, () -> svc.setDisplayTerms(9L, 500L, 1, null, 1, shopTerms()));
        when(mapper.selectByIdForUpdate(9L)).thenReturn(offer(500L, 1));
        MerchantChapterOffer bad = shopTerms();
        bad.setDailyCapacity(-3);
        assertThrows(IllegalStateException.class, () -> svc.setDisplayTerms(9L, 500L, 1, null, 1, bad));
        verify(mapper, never()).updateDisplayTerms(any());
        verify(mapper, never()).updateShopTerms(any());
    }

    @Test
    void lostRaceOnShopTermsIsReported() {
        MerchantChapterOfferMapper mapper = mock(MerchantChapterOfferMapper.class);
        MerchantOfferServiceImpl svc = new MerchantOfferServiceImpl();
        ReflectionTestUtils.setField(svc, "offerMapper", mapper);
        when(mapper.selectByIdForUpdate(9L)).thenReturn(offer(500L, 1));
        when(mapper.updateDisplayTerms(any())).thenReturn(1);
        when(mapper.updateShopTerms(any())).thenReturn(0);
        assertThrows(IllegalStateException.class, () -> svc.setDisplayTerms(9L, 500L, 1, null, 1, shopTerms()));
    }

    /** 读回只按(供给 id, 本商家)查;查不到(别人的 / 已失效)直接拒,不回落到按 id 读。 */
    @Test
    void readBackIsScopedToTheOwner() {
        MerchantChapterOfferMapper mapper = mock(MerchantChapterOfferMapper.class);
        MerchantOfferServiceImpl svc = new MerchantOfferServiceImpl();
        ReflectionTestUtils.setField(svc, "offerMapper", mapper);
        when(mapper.selectDisplayTermsOwned(9L, 500L)).thenReturn(offer(500L, 1));
        assertEquals(9L, svc.displayTerms(9L, 500L).getId());
        assertThrows(IllegalStateException.class, () -> svc.displayTerms(9L, 999L));
        verify(mapper, never()).selectById(any());
        verify(mapper, never()).selectByIdForUpdate(any());
    }

    /** 购票前的逐店卡片带上门店条款与门店照片(玩家可见字段;配额、单价等结算面数据仍不下发)。 */
    @Test
    void playerCardCarriesShopTermsBeforePurchase() {
        MerchantChapterOffer o = shopTerms();
        MerchantOfferServiceImpl.normalizeShopTerms(o);
        o.setId(9L);
        o.setChapterId(3L);
        o.setQuotaTotal(50);
        java.util.Map<String, Object> card = FreeExploreBundleServiceImpl
                .merchantCards(java.util.List.of(o), java.util.Map.of(3L, "咖啡")).get(0);
        assertEquals(30, card.get("dailyCapacity"));
        assertEquals(java.sql.Date.valueOf("2026-12-01"), card.get("validStart"));
        assertEquals("售罄换同价饮品", card.get("soldOutRuleText"));
        assertEquals("/profile/upload/2026/11/22/store.jpg", card.get("storefrontImg"));
        assertEquals(false, card.containsKey("quotaTotal"));
    }
}
