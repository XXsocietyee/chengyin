package com.chengyinhub.web.service.play;

import com.chengyinhub.business.domain.CmsTopicNode;
import com.chengyinhub.business.domain.MerchantChapterOffer;
import com.chengyinhub.business.mapper.MerchantChapterOfferMapper;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** FE-G5 本店权益展示条款与 FE-G7 perkOnly:只加字段,读失败只让新字段缺席。 */
class PerkDisplayTermsTest {

    private static CmsTopicNode node(long chapterId) {
        CmsTopicNode n = new CmsTopicNode();
        n.setChapterId(chapterId);
        return n;
    }

    @Test
    void termsAreKeyedByChapterAndMerchantAndRenderedAsBooleans() {
        MerchantChapterOfferMapper mapper = mock(MerchantChapterOfferMapper.class);
        MerchantChapterOffer offer = new MerchantChapterOffer();
        offer.setChapterId(3L); offer.setMerchantId(500L);
        offer.setIncluded(0); offer.setExtraSpendText("饮品另付"); offer.setReserveRequired(1);
        when(mapper.selectLiveDisplayByChapterIds(List.of(3L))).thenReturn(List.of(offer));

        Map<String, MerchantChapterOffer> terms = PerkDisplayTerms.load(mapper, List.of(node(3L), node(3L)));
        Map<String, Object> perk = new LinkedHashMap<>();
        PerkDisplayTerms.put(perk, terms.get("3:500"));
        assertEquals(Boolean.FALSE, perk.get("included"));
        assertEquals("饮品另付", perk.get("extraSpendText"));
        assertEquals(Boolean.TRUE, perk.get("reserveRequired"));
    }

    @Test
    void readFailureOnlyDropsTheNewFields() {
        MerchantChapterOfferMapper mapper = mock(MerchantChapterOfferMapper.class);
        when(mapper.selectLiveDisplayByChapterIds(anyList())).thenThrow(new RuntimeException("Unknown column 'included'"));
        Map<String, MerchantChapterOffer> terms = PerkDisplayTerms.load(mapper, List.of(node(3L)));
        assertTrue(terms.isEmpty());
        Map<String, Object> perk = new LinkedHashMap<>();
        perk.put("name", "美式一杯");
        PerkDisplayTerms.put(perk, terms.get("3:500"));
        assertEquals(Map.of("name", "美式一杯"), perk);
    }

    /** P1-2 / 门店照片:每日容量、开始日期、售罄或替代规则随权益下发;门店照片成为章节卡图,没有就保持原图。 */
    @Test
    void shopTermsAndStorefrontAreExposedAndFallBackToTheOriginalImage() {
        MerchantChapterOffer second = new MerchantChapterOffer();
        second.setId(8L); second.setChapterId(3L); second.setMerchantId(501L);
        second.setStorefrontImg("/profile/upload/b.jpg");
        MerchantChapterOffer first = new MerchantChapterOffer();
        first.setId(7L); first.setChapterId(3L); first.setMerchantId(500L);
        first.setDailyCapacity(20); first.setValidStart(java.sql.Date.valueOf("2026-12-01"));
        first.setSoldOutRuleText("售罄换同价饮品"); first.setStorefrontImg("/profile/upload/a.jpg");
        MerchantChapterOffer bare = new MerchantChapterOffer();
        bare.setId(9L); bare.setChapterId(4L); bare.setMerchantId(502L);
        Map<String, MerchantChapterOffer> terms = new LinkedHashMap<>();
        terms.put("3:501", second); terms.put("3:500", first); terms.put("4:502", bare);

        Map<String, Object> perk = new LinkedHashMap<>();
        PerkDisplayTerms.put(perk, first);
        assertEquals(20, perk.get("dailyCapacity"));
        assertEquals("2026-12-01", perk.get("validStart"));
        assertEquals("售罄换同价饮品", perk.get("soldOutRuleText"));
        assertEquals("/profile/upload/a.jpg", PerkDisplayTerms.storefront(first));
        assertNull(PerkDisplayTerms.storefront(bare));
        assertEquals("/profile/upload/a.jpg", PerkDisplayTerms.chapterImg(terms, 3L, "template.jpg"), "同章多家取最早的供给");
        assertEquals("template.jpg", PerkDisplayTerms.chapterImg(terms, 4L, "template.jpg"), "没有门店照片回落原图");
        assertEquals("template.jpg", PerkDisplayTerms.chapterImg(null, 3L, "template.jpg"));
    }

    private static CmsTopicNode shopNode(long chapterId, long merchantId) {
        CmsTopicNode n = node(chapterId);
        n.setMerchantMemberId(merchantId);
        return n;
    }

    /** P1-9:已退出的供给按(章节, 商家)标成 WITHDRAWN / REPLACING;读失败只让字段缺席。 */
    @Test
    void withdrawnSupplyIsReportedPerChapterMerchantAndReadFailureOnlyDropsTheField() {
        MerchantChapterOfferMapper mapper = mock(MerchantChapterOfferMapper.class);
        Map<String, Object> gone = new LinkedHashMap<>();
        gone.put("chapterId", 3L); gone.put("merchantId", 500L); gone.put("replacing", 0);
        Map<String, Object> replacing = new LinkedHashMap<>();
        replacing.put("chapterId", 4L); replacing.put("merchantId", 501L); replacing.put("replacing", 1L);
        when(mapper.selectWithdrawnByChapterIds(List.of(3L, 4L))).thenReturn(List.of(gone, replacing));

        Map<String, String> states = PerkDisplayTerms.supplyStates(mapper,
                List.of(shopNode(3L, 500L), shopNode(4L, 501L), node(5L)));
        assertEquals("WITHDRAWN", states.get("3:500"));
        assertEquals("REPLACING", states.get("4:501"));
        assertNull(states.get("5:null"), "没有店铺的节点不查也不标");

        when(mapper.selectWithdrawnByChapterIds(anyList())).thenThrow(new RuntimeException("db down"));
        assertTrue(PerkDisplayTerms.supplyStates(mapper, List.of(shopNode(3L, 500L))).isEmpty());
    }

    @Test
    void perkOnlyOnlyWhenEveryFreeExploreNodeHasNoGame() {
        Map<String, Object> noGame = Map.of("hasGame", false);
        Map<String, Object> game = Map.of("hasGame", true);
        Map<String, Object> unknown = Map.of("id", 1L);
        assertTrue(PerkDisplayTerms.perkOnly(2, List.of(noGame, noGame)));
        assertFalse(PerkDisplayTerms.perkOnly(2, List.of(noGame, game)));
        assertFalse(PerkDisplayTerms.perkOnly(2, List.of(noGame, unknown)), "未算 hasGame 的节点不当作无游戏");
        assertFalse(PerkDisplayTerms.perkOnly(1, List.of(noGame)), "经典定向恒为游戏");
        assertNull(PerkDisplayTerms.perkOnly(2, List.of()));
    }

    private static MerchantChapterOffer limited(Long id, Integer dailyCapacity, java.time.LocalDate start) {
        MerchantChapterOffer offer = new MerchantChapterOffer();
        offer.setId(id); offer.setChapterId(3L); offer.setMerchantId(500L);
        offer.setDailyCapacity(dailyCapacity);
        if (start != null) offer.setValidStart(java.sql.Date.valueOf(start));
        return offer;
    }

    @Test
    void playerSeesTheSameWordingAsTheCounterWhenTodayIsFullOrNotStarted() {
        java.time.LocalDate today = java.time.LocalDate.of(2026, 11, 23);
        MerchantChapterOfferMapper mapper = mock(MerchantChapterOfferMapper.class);
        MerchantChapterOffer full = limited(7L, 2, null);
        when(mapper.selectDailyUsedByOfferIds(List.of(7L), "2026-11-23"))
                .thenReturn(List.of(Map.of("offerId", 7L, "usedToday", 2)));
        Map<Long, Integer> used = PerkDisplayTerms.dailyUsed(mapper, Map.of("3:500", full), today);
        Map<String, Object> perk = new LinkedHashMap<>();
        PerkDisplayTerms.putRedeemBlocked(perk, full, used, today);
        assertEquals("今日名额已满，请改天再来", perk.get("redeemBlockedText"));

        Map<String, Object> later = new LinkedHashMap<>();
        PerkDisplayTerms.putRedeemBlocked(later, limited(8L, null, today.plusDays(8)), used, today);
        assertEquals("权益还没开始，12月1日起可用", later.get("redeemBlockedText"));
    }

    @Test
    void redeemableOrUnlimitedOffersCarryNoBlockedTextAndSkipTheCountQuery() {
        java.time.LocalDate today = java.time.LocalDate.of(2026, 11, 23);
        MerchantChapterOfferMapper mapper = mock(MerchantChapterOfferMapper.class);
        MerchantChapterOffer unlimited = limited(9L, null, null);
        assertTrue(PerkDisplayTerms.dailyUsed(mapper, Map.of("3:500", unlimited), today).isEmpty());
        org.mockito.Mockito.verifyNoInteractions(mapper);
        Map<String, Object> perk = new LinkedHashMap<>();
        PerkDisplayTerms.putRedeemBlocked(perk, unlimited, Map.of(), today);
        PerkDisplayTerms.putRedeemBlocked(perk, limited(7L, 2, today), Map.of(7L, 1), today);
        assertFalse(perk.containsKey("redeemBlockedText"));
    }

    @Test
    void countReadFailureOnlyDropsTheBlockedText() {
        java.time.LocalDate today = java.time.LocalDate.of(2026, 11, 23);
        MerchantChapterOfferMapper mapper = mock(MerchantChapterOfferMapper.class);
        when(mapper.selectDailyUsedByOfferIds(anyList(), org.mockito.ArgumentMatchers.anyString()))
                .thenThrow(new RuntimeException("Unknown column 'daily_used'"));
        assertTrue(PerkDisplayTerms.dailyUsed(mapper, Map.of("3:500", limited(7L, 2, null)), today).isEmpty());
    }
}
