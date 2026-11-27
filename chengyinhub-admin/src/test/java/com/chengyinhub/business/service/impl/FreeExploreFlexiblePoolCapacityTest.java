package com.chengyinhub.business.service.impl;

import com.chengyinhub.business.domain.CmsTopic;
import com.chengyinhub.business.domain.CmsTopicChapter;
import com.chengyinhub.business.domain.enums.TopicLifecycleState;
import com.chengyinhub.business.domain.snapshot.TopicSaleCanonicalV1;
import com.chengyinhub.business.mapper.CmsTopicChapterMapper;
import com.chengyinhub.business.mapper.CmsTopicMapper;
import com.chengyinhub.business.mapper.MerchantChapterOfferMapper;
import com.chengyinhub.business.mapper.RedemptionMapper;
import com.chengyinhub.business.mapper.RegistrationEntitlementMapper;
import com.chengyinhub.business.service.ITopicLifecycleService;
import com.chengyinhub.business.service.support.FreeExplorePoolPolicy;
import com.chengyinhub.business.service.support.FreeExploreSlotProgress;
import com.chengyinhub.common.constant.ProductType;
import com.chengyinhub.common.constant.TermsMode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * §4.3 (4) 弹性 1-4 店与 N 选 K（N-choose-K）权益池：
 * FreeExploreSlotProgress / TopicSaleCanonicalV1 / PerkLedgerServiceImpl 容量与预占对齐测试。
 */
class FreeExploreFlexiblePoolCapacityTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    @Test
    void poolSellableCapacityUsesSumDivKAndOneSoldOutStoreDoesNotHaltBundle() {
        // 4 选 2：1 店售罄(0)，其余 3 店各余 10 → (0 + 10 + 10 + 10) / 2 = 15
        assertEquals(15, FreeExplorePoolPolicy.poolSellableCapacity(Arrays.asList(0, 10, 10, 10), 0, 2));
        // 4 选 3：1 店售罄(0)，其余 3 店各余 12 → 36 / 3 = 12
        assertEquals(12, FreeExplorePoolPolicy.poolSellableCapacity(Arrays.asList(0, 12, 12, 12), 0, 3));
        // 4 选 2：仅剩 1 店有余量（active=1 < K=2）→ 0
        assertEquals(0, FreeExplorePoolPolicy.poolSellableCapacity(Arrays.asList(0, 0, 0, 50), 0, 2));
        // 弹性 1 店（1 选 1）
        assertEquals(20, FreeExplorePoolPolicy.poolSellableCapacity(Arrays.asList(20), 0, 1));
    }

    @Test
    void slotProgressSupportsFlexible1To4StoresAndAdvancesPoolOnceKFilled() {
        CmsTopicMapper topicMapper = mock(CmsTopicMapper.class);
        MerchantChapterOfferMapper offerMapper = mock(MerchantChapterOfferMapper.class);
        ITopicLifecycleService lifecycle = mock(ITopicLifecycleService.class);
        FreeExploreSlotProgress progress = new FreeExploreSlotProgress(topicMapper, offerMapper, lifecycle);

        // 1-4 店弹性全承接都能推进到待定价
        for (int storeCount = 1; storeCount <= 4; storeCount++) {
            long topicId = 100L + storeCount;
            CmsTopic t = freeExploreTopic(topicId, TopicLifecycleState.RECRUITING, null);
            when(topicMapper.selectCmsTopicByIdForUpdate(topicId)).thenReturn(t);
            when(offerMapper.countRequiredChapters(topicId)).thenReturn(storeCount);
            when(offerMapper.countRequiredChaptersWithoutLiveOffer(topicId)).thenReturn(0);
            when(lifecycle.transition(topicId, TopicLifecycleState.RECRUITING, TopicLifecycleState.PRICING))
                    .thenReturn(true);
            assertTrue(progress.tryAdvanceToPricing(topicId), storeCount + " 店应可顺利进入待定价");
        }

        // N 选 K（4 选 2）：只需承接 2 店即可进入待定价；退到 1 店时回退招募中
        long poolTopicId = 200L;
        CmsTopic poolTopic = freeExploreTopic(poolTopicId, TopicLifecycleState.RECRUITING, "{\"poolChooseK\":2}");
        when(topicMapper.selectCmsTopicByIdForUpdate(poolTopicId)).thenReturn(poolTopic);
        when(topicMapper.selectCmsTopicById(poolTopicId)).thenReturn(poolTopic);
        when(offerMapper.countRequiredChapters(poolTopicId)).thenReturn(4);
        when(offerMapper.countRequiredChaptersWithoutLiveOffer(poolTopicId)).thenReturn(2); // 2 filled, 2 open
        when(lifecycle.transition(poolTopicId, TopicLifecycleState.RECRUITING, TopicLifecycleState.PRICING))
                .thenReturn(true);

        assertTrue(progress.slots(poolTopicId).isReadyForPricing());
        assertTrue(progress.tryAdvanceToPricing(poolTopicId));

        // 处于待定价且仍有 2 店承接（≥ K=2）不回退招募中
        poolTopic.setLifecycle(TopicLifecycleState.PRICING.getCode());
        assertFalse(progress.reopenRecruitingIfSlotOpen(poolTopicId));

        // 跌到 1 店承接（3 open, 1 filled < K=2）→ 回退招募中
        when(offerMapper.countRequiredChaptersWithoutLiveOffer(poolTopicId)).thenReturn(3);
        when(lifecycle.transition(poolTopicId, TopicLifecycleState.PRICING, TopicLifecycleState.RECRUITING))
                .thenReturn(true);
        assertTrue(progress.reopenRecruitingIfSlotOpen(poolTopicId));
    }

    @Test
    void perkLedgerNChooseKPoolDoesNotHaltWhenOneStoreSellsOut() {
        CmsTopicChapterMapper chapterMapper = mock(CmsTopicChapterMapper.class);
        CmsTopicMapper topicMapper = mock(CmsTopicMapper.class);
        MerchantChapterOfferMapper offerMapper = mock(MerchantChapterOfferMapper.class);
        RegistrationEntitlementMapper entitlementMapper = mock(RegistrationEntitlementMapper.class);
        RedemptionMapper redemptionMapper = mock(RedemptionMapper.class);

        PerkLedgerServiceImpl ledger = new PerkLedgerServiceImpl();
        ReflectionTestUtils.setField(ledger, "chapterMapper", chapterMapper);
        ReflectionTestUtils.setField(ledger, "topicMapper", topicMapper);
        ReflectionTestUtils.setField(ledger, "offerMapper", offerMapper);
        ReflectionTestUtils.setField(ledger, "entitlementMapper", entitlementMapper);
        ReflectionTestUtils.setField(ledger, "redemptionMapper", redemptionMapper);

        long topicId = 300L;
        CmsTopic poolTopic = freeExploreTopic(topicId, TopicLifecycleState.SELLING, "{\"poolChooseK\":2}");
        when(topicMapper.selectCmsTopicById(topicId)).thenReturn(poolTopic);

        List<CmsTopicChapter> chapters = Arrays.asList(
                perkChapter(11L, topicId), perkChapter(12L, topicId),
                perkChapter(13L, topicId), perkChapter(14L, topicId));
        when(chapterMapper.selectRequiredByTopic(topicId)).thenReturn(chapters);
        when(chapterMapper.lockChaptersForCapacity(Arrays.asList(11L, 12L, 13L, 14L)))
                .thenReturn(Arrays.asList(11L, 12L, 13L, 14L));

        // 门店 11 售罄(0)，门店 12/13/14 各余 10 → sum/K = 30/2 = 15
        when(offerMapper.sumRemainingQuotaByChapter(11L)).thenReturn(0);
        when(offerMapper.sumRemainingQuotaByChapter(12L)).thenReturn(10);
        when(offerMapper.sumRemainingQuotaByChapter(13L)).thenReturn(10);
        when(offerMapper.sumRemainingQuotaByChapter(14L)).thenReturn(10);
        when(offerMapper.sumRemainingQuotaByChapterForUpdate(11L)).thenReturn(0);
        when(offerMapper.sumRemainingQuotaByChapterForUpdate(12L)).thenReturn(10);
        when(offerMapper.sumRemainingQuotaByChapterForUpdate(13L)).thenReturn(10);
        when(offerMapper.sumRemainingQuotaByChapterForUpdate(14L)).thenReturn(10);

        assertEquals(15, ledger.topicSellableCapacity(topicId));
        ledger.reserveEntitlements(9001L, topicId);
        verify(entitlementMapper, times(4)).insertRegistrationEntitlement(any());

        // N 选 K（4 选 2）：核销 2 家即通关
        when(redemptionMapper.countActiveRequiredChaptersRedeemed(9001L, topicId)).thenReturn(2);
        assertTrue(ledger.isExploreCompleted(9001L, topicId));
        when(redemptionMapper.countActiveRequiredChaptersRedeemed(9001L, topicId)).thenReturn(1);
        assertFalse(ledger.isExploreCompleted(9001L, topicId));

        // 若降为非池化固定套票（completeRuleJson = null），11 号店售罄即停售（回归守卫）
        poolTopic.setCompleteRuleJson(null);
        assertEquals(0, ledger.topicSellableCapacity(topicId));
        assertThrows(RuntimeException.class, () -> ledger.reserveEntitlements(9002L, topicId));
    }

    @Test
    void topicSaleCanonicalSupportsFlexible1To4StoresAndPoolChooseK() throws Exception {
        for (int n = 1; n <= 4; n++) {
            ObjectNode json = flexibleCanonical(n, n >= 2 ? 2 : 1);
            TopicSaleCanonicalV1 snapshot = JSON.treeToValue(json, TopicSaleCanonicalV1.class);
            snapshot.validateComplete(ProductType.FREE_EXPLORE);
            assertEquals(Integer.valueOf(n >= 2 ? 2 : 1), snapshot.poolChooseK());
        }

        // K > storeCount 必须 fail-closed 拒绝
        ObjectNode invalidK = flexibleCanonical(2, 3);
        TopicSaleCanonicalV1 bad = JSON.treeToValue(invalidK, TopicSaleCanonicalV1.class);
        assertEquals("SALE_SNAPSHOT_MISSING_COMPLETION_POLICY",
                assertThrows(IllegalStateException.class, () -> bad.validateComplete(ProductType.FREE_EXPLORE))
                        .getMessage());
    }

    private static CmsTopic freeExploreTopic(long id, TopicLifecycleState state, String completeRuleJson) {
        CmsTopic t = new CmsTopic();
        t.setId(id);
        t.setProductType(ProductType.FREE_EXPLORE);
        t.setLifecycle(state.getCode());
        t.setDelFlag(0);
        t.setCompleteRuleJson(completeRuleJson);
        return t;
    }

    private static CmsTopicChapter perkChapter(long id, long topicId) {
        CmsTopicChapter c = new CmsTopicChapter();
        c.setId(id);
        c.setTopicId(topicId);
        c.setRequired(1);
        c.setTermsMode(TermsMode.PERK);
        return c;
    }

    private static ObjectNode flexibleCanonical(int storeCount, int poolChooseK) {
        ObjectNode root = JSON.createObjectNode();
        root.put("storeCount", storeCount);

        ArrayNode tickets = JSON.createArrayNode();
        tickets.add(JSON.createObjectNode().put("id", 1L).put("price", "39.00").put("totalInventory", 50)
                .put("startTime", 1790000000000L).put("endTime", 1791000000000L).put("refundRule", "标准退票"));
        root.set("ticketPricingPolicy", JSON.createObjectNode().put("pointsAllowed", false)
                .put("discountMode", "NONE").set("tickets", tickets));
        root.put("salesTargetTotal", 50L);
        root.set("sessionWindows", JSON.createObjectNode().put("startDate", 1790000000000L)
                .put("endDate", 1791000000000L).set("tickets", tickets.deepCopy()));
        root.set("participationUnitPolicy", JSON.createObjectNode().put("adultCount", 1).put("petMax", 0)
                .put("childrenPolicy", "WITH_GUARDIAN").put("extraAdultPolicy", "NOT_ALLOWED")
                .put("companionPolicy", "SAME_TICKET"));
        root.set("sessionVenues", JSON.createObjectNode().put("adultCapacity", 50).put("petCapacity", 0)
                .put("authorization", "店铺营业场所").put("rainPlan", "店铺营业场所")
                .put("evacuationPlan", "店铺营业场所").put("responsibleParty", "店铺负责")
                .put("insuranceScope", "店铺营业场所").set("tickets", tickets.deepCopy()));

        ArrayNode chapters = JSON.createArrayNode();
        ArrayNode offers = JSON.createArrayNode();
        ArrayNode stores = JSON.createArrayNode();
        ArrayNode perks = JSON.createArrayNode();
        ArrayNode requiredIds = JSON.createArrayNode();
        for (int i = 1; i <= storeCount; i++) {
            long chId = 10L + i;
            long mId = 100L + i;
            long perkId = 200L + i;
            chapters.add(JSON.createObjectNode().put("id", chId).put("required", 1)
                    .put("termsMode", "PERK").put("description", "门店" + i).put("blocksJson", "[]"));
            offers.add(JSON.createObjectNode().put("id", 300L + i).put("chapterId", chId)
                    .put("merchantId", mId).put("termsMode", "PERK").put("perkId", perkId));
            stores.add(JSON.createObjectNode().put("nodeId", 400L + i).put("chapterId", chId)
                    .put("merchantMemberId", mId).put("address", "星海街" + i + "号")
                    .put("longitude", "120.7").put("latitude", "31.3"));
            perks.add(JSON.createObjectNode().put("id", perkId).put("name", "美式咖啡")
                    .put("perkType", 0).put("retailValue", "28").put("redeemRule", "到店扫码核销"));
            requiredIds.add(chId);
        }

        ObjectNode settlement = JSON.createObjectNode().put("merchantDepositRequired", false);
        settlement.set("chapters", chapters.deepCopy());
        settlement.set("offers", offers.deepCopy());
        root.set("merchantCashSettlementMode", settlement);
        root.set("storeCluster", stores);

        ObjectNode micro = JSON.createObjectNode();
        micro.set("chapters", chapters.deepCopy());
        micro.set("offers", offers.deepCopy());
        micro.set("perks", perks);
        root.set("microExperienceCatalog", micro);

        ObjectNode work = JSON.createObjectNode();
        work.set("chapters", chapters.deepCopy());
        work.set("workItems", JSON.createArrayNode());
        root.set("merchantWorkPackage", work);

        ObjectNode clubWork = JSON.createObjectNode().put("opening", "无").put("patrol", "无")
                .put("photoWrap", "无").put("closing", "无").put("community", "无")
                .put("HPlan", "无").put("contractRef", "无");
        clubWork.set("organizerActor", JSON.createObjectNode().put("roleId", 1L).put("actorType", "MEMBER")
                .put("actorId", 5L).put("declaredBy", 5L).put("declaredAt", 1790000000000L));
        clubWork.set("organizers", JSON.createArrayNode());
        root.set("clubWorkPackage", clubWork);

        ObjectNode rights = JSON.createObjectNode().put("assetRef", "topic:1").put("owner", "member:5")
                .put("licensedEntity", "chengyin").put("validFrom", 1790000000000L)
                .put("validTo", 1791000000000L).put("editingRight", true)
                .put("humanPortraitConsent", false).put("petPortraitConsent", false);
        rights.putArray("channels").add("mini-program");
        root.set("contentRightsPackage", rights);

        ObjectNode completion = JSON.createObjectNode().put("evidenceRule", "STORE_REDEEM")
                .put("poolChooseK", poolChooseK);
        completion.set("requiredChapterIds", requiredIds);
        root.set("completionPolicy", completion);

        root.set("relationshipPolicy", JSON.createObjectNode().put("platformTransaction", true)
                .put("clubCommunityOptIn", false).put("forcedFollow", false)
                .put("forcedGroupJoin", false).put("merchantContactDisclosure", false));
        ObjectNode refund = JSON.createObjectNode().put("rescheduleDeadline", 1790000000000L)
                .put("rescheduleLimit", 0).put("cancellationPolicy", "标准退票")
                .put("merchantAbsencePolicy", "FULL_REFUND").put("noShowPolicy", "NO_REFUND")
                .put("crossEditionTransferAllowed", false);
        refund.set("ticketPolicies", tickets.deepCopy());
        root.set("refundReschedulePolicy", refund);
        return root;
    }
}
