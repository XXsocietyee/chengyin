package com.chengyinhub.business.service;

import com.chengyinhub.business.domain.CmsTopic;
import com.chengyinhub.business.domain.CmsTopicChapter;
import com.chengyinhub.business.domain.MerchantChapterOffer;
import com.chengyinhub.business.mapper.CmsTopicChapterMapper;
import com.chengyinhub.business.mapper.CmsTopicMapper;
import com.chengyinhub.business.mapper.MerchantChapterOfferMapper;
import com.chengyinhub.business.mapper.RegistrationEntitlementMapper;
import com.chengyinhub.business.service.impl.MerchantOfferServiceImpl;
import com.chengyinhub.business.service.support.TopicSupplyReviewService;
import com.chengyinhub.common.constant.ProductType;
import com.chengyinhub.common.constant.TermsMode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Collections;
import java.util.Date;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** P1-7:承接方调自己供给的名额、暂停 / 恢复新售。 */
class MerchantOfferOwnQuotaPauseTest {
    private static final Long OFFER = 9L, CHAPTER = 33L, TOPIC = 10L, MERCHANT = 500L;
    private MerchantChapterOfferMapper offers;
    private CmsTopicChapterMapper chapters;
    private CmsTopicMapper topics;
    private RegistrationEntitlementMapper entitlements;
    private TopicSupplyReviewService review;
    private ITopicSaleCanonicalMutationService canonical;
    private MerchantOfferServiceImpl service;
    private MerchantChapterOffer offer;
    private CmsTopic topic;

    @BeforeEach
    void setUp() {
        offers = mock(MerchantChapterOfferMapper.class);
        chapters = mock(CmsTopicChapterMapper.class);
        topics = mock(CmsTopicMapper.class);
        entitlements = mock(RegistrationEntitlementMapper.class);
        review = mock(TopicSupplyReviewService.class);
        canonical = mock(ITopicSaleCanonicalMutationService.class);
        service = new MerchantOfferServiceImpl();
        ReflectionTestUtils.setField(service, "supplyReviewService", review);
        ReflectionTestUtils.setField(service, "offerMapper", offers);
        ReflectionTestUtils.setField(service, "chapterMapper", chapters);
        ReflectionTestUtils.setField(service, "cmsTopicMapper", topics);
        ReflectionTestUtils.setField(service, "registrationEntitlementMapper", entitlements);
        ReflectionTestUtils.setField(service, "canonicalMutationService", canonical);
        offer = new MerchantChapterOffer();
        offer.setId(OFFER); offer.setTopicId(TOPIC); offer.setChapterId(CHAPTER);
        offer.setMerchantId(MERCHANT); offer.setStatus(1); offer.setTermsMode(TermsMode.PERK);
        offer.setQuotaTotal(20); offer.setQuotaUsed(6);
        CmsTopicChapter chapter = new CmsTopicChapter();
        chapter.setId(CHAPTER); chapter.setTopicId(TOPIC);
        topic = new CmsTopic();
        topic.setId(TOPIC); topic.setDelFlag(0); topic.setProductType(ProductType.FREE_EXPLORE);
        topic.setLifecycle(3); topic.setUserStatus(1); topic.setMemberId(501L);
        when(offers.selectById(OFFER)).thenReturn(offer);
        when(offers.selectByIdForUpdate(OFFER)).thenReturn(offer);
        when(chapters.lockChaptersForCapacity(Collections.singletonList(CHAPTER)))
                .thenReturn(Collections.singletonList(CHAPTER));
        when(chapters.selectCmsTopicChapterById(CHAPTER)).thenReturn(chapter);
        when(topics.selectCmsTopicByIdForUpdate(TOPIC)).thenReturn(topic);
        when(offers.updateOwnQuota(anyLong(), anyLong(), anyInt())).thenReturn(1);
        when(offers.updateOwnSalePaused(anyLong(), anyLong(), anyInt())).thenReturn(1);
    }

    private String refused(Runnable action) {
        return assertThrows(IllegalStateException.class, action::run).getMessage();
    }

    @Test
    void raisingQuotaTakesChapterTopicOfferLocksInOrderAndSkipsTheSoldCheck() {
        service.setOwnQuota(OFFER, MERCHANT, 30);
        InOrder order = inOrder(review, chapters, topics, offers);
        order.verify(offers).selectById(OFFER);
        order.verify(review).lockBeforeChapter(CHAPTER);
        order.verify(chapters).lockChaptersForCapacity(Collections.singletonList(CHAPTER));
        order.verify(topics).selectCmsTopicByIdForUpdate(TOPIC);
        order.verify(offers).selectByIdForUpdate(OFFER);
        order.verify(offers).updateOwnQuota(OFFER, MERCHANT, 30);
        verify(offers, never()).sumRemainingQuotaByChapterForUpdate(anyLong());
        verifyNoInteractions(entitlements, canonical);
    }

    @Test
    void raisingIsAllowedAfterPriceLock() {
        topic.setLifecycle(com.chengyinhub.business.domain.enums.TopicLifecycleState.SELLING.getCode());
        service.setOwnQuota(OFFER, MERCHANT, 21);
        verify(offers).updateOwnQuota(OFFER, MERCHANT, 21);
    }

    @Test
    void quotaBelowUsedIsRefusedBeforeAnyWrite() {
        assertTrue(refused(() -> service.setOwnQuota(OFFER, MERCHANT, 5)).contains("已核销的 6 份"));
        verify(offers, never()).updateOwnQuota(anyLong(), anyLong(), anyInt());
    }

    @Test
    void quotaEqualToUsedIsAllowedWhenNothingSoldIsLeftUncovered() {
        when(offers.sumRemainingQuotaByChapterForUpdate(CHAPTER)).thenReturn(14);
        when(entitlements.countUnredeemedByChapterForUpdate(CHAPTER)).thenReturn(0);
        service.setOwnQuota(OFFER, MERCHANT, 6);
        verify(offers).updateOwnQuota(OFFER, MERCHANT, 6);
    }

    @Test
    void loweringBelowSoldButUnredeemedIsRefused() {
        // 本章剩余 14 份(20-6),已售未核销 10 张;调到 15 ⇒ 剩余 9 < 10。
        when(offers.sumRemainingQuotaByChapterForUpdate(CHAPTER)).thenReturn(14);
        when(entitlements.countUnredeemedByChapterForUpdate(CHAPTER)).thenReturn(10);
        assertEquals("已售出的份数超过新额度", refused(() -> service.setOwnQuota(OFFER, MERCHANT, 15)));
        verify(offers, never()).updateOwnQuota(anyLong(), anyLong(), anyInt());
    }

    @Test
    void loweringThatStillCoversSoldTicketsIsAllowed() {
        when(offers.sumRemainingQuotaByChapterForUpdate(CHAPTER)).thenReturn(14);
        when(entitlements.countUnredeemedByChapterForUpdate(CHAPTER)).thenReturn(10);
        service.setOwnQuota(OFFER, MERCHANT, 16);
        verify(offers).updateOwnQuota(OFFER, MERCHANT, 16);
    }

    @Test
    void anotherShopsSupplyCountsTowardCoveringSoldTickets() {
        // 本章两家合计剩余 34 份,已售未核销 10 张;本店调到 6(只留已核销)仍够。
        when(offers.sumRemainingQuotaByChapterForUpdate(CHAPTER)).thenReturn(34);
        when(entitlements.countUnredeemedByChapterForUpdate(CHAPTER)).thenReturn(10);
        service.setOwnQuota(OFFER, MERCHANT, 6);
        verify(offers).updateOwnQuota(OFFER, MERCHANT, 6);
    }

    @Test
    void concurrentRedemptionPastTheNewQuotaIsRefusedByTheGuardedUpdate() {
        when(offers.updateOwnQuota(OFFER, MERCHANT, 30)).thenReturn(0);
        assertTrue(refused(() -> service.setOwnQuota(OFFER, MERCHANT, 30)).contains("请刷新后重试"));
    }

    @Test
    void anotherMerchantCannotChangeTheQuota() {
        assertTrue(refused(() -> service.setOwnQuota(OFFER, 999L, 30)).contains("不属于当前商家"));
        verify(chapters, never()).lockChaptersForCapacity(anyList());
        verify(offers, never()).updateOwnQuota(anyLong(), anyLong(), anyInt());
    }

    @Test
    void ownershipIsRecheckedOnTheLockedRow() {
        MerchantChapterOffer changed = new MerchantChapterOffer();
        changed.setId(OFFER); changed.setMerchantId(999L); changed.setStatus(1); changed.setChapterId(CHAPTER);
        when(offers.selectByIdForUpdate(OFFER)).thenReturn(changed);
        assertTrue(refused(() -> service.setOwnQuota(OFFER, MERCHANT, 30)).contains("不属于当前商家"));
        verify(offers, never()).updateOwnQuota(anyLong(), anyLong(), anyInt());
    }

    @Test
    void inactiveOfferAndNonPerkOfferCannotChangeQuota() {
        offer.setStatus(0);
        assertTrue(refused(() -> service.setOwnQuota(OFFER, MERCHANT, 30)).contains("不属于当前商家"));
        offer.setStatus(1); offer.setTermsMode(TermsMode.REVSHARE);
        assertTrue(refused(() -> service.setOwnQuota(OFFER, MERCHANT, 30)).contains("权益档"));
        verify(offers, never()).updateOwnQuota(anyLong(), anyLong(), anyInt());
    }

    @Test
    void quotaMustBeAPositiveBoundedInteger() {
        assertThrows(IllegalStateException.class, () -> service.setOwnQuota(OFFER, MERCHANT, null));
        assertThrows(IllegalStateException.class, () -> service.setOwnQuota(OFFER, MERCHANT, 0));
        assertThrows(IllegalStateException.class, () -> service.setOwnQuota(OFFER, MERCHANT, -3));
        assertThrows(IllegalStateException.class, () -> service.setOwnQuota(OFFER, MERCHANT, 1000000));
        verifyNoInteractions(offers);
    }

    @Test
    void expiredOfferIsNotInSupplySoLoweringItNeedsNoSoldCheck() {
        offer.setValidEnd(new Date(System.currentTimeMillis() - 86400000L));
        service.setOwnQuota(OFFER, MERCHANT, 10);
        verify(offers, never()).sumRemainingQuotaByChapterForUpdate(anyLong());
        verify(offers).updateOwnQuota(OFFER, MERCHANT, 10);
    }

    @Test
    void pauseAndResumeWriteOnlyTheOwnersLiveRow() {
        assertTrue(service.setOwnSalePaused(OFFER, MERCHANT, true));
        verify(offers).updateOwnSalePaused(OFFER, MERCHANT, 1);
        assertFalse(service.setOwnSalePaused(OFFER, MERCHANT, false));
        verify(offers).updateOwnSalePaused(OFFER, MERCHANT, 0);
        verify(offers, never()).deactivate(any());
        verify(offers, never()).consumeQuota(any());
        verifyNoInteractions(canonical);
    }

    @Test
    void anotherMerchantCannotPause() {
        assertTrue(refused(() -> service.setOwnSalePaused(OFFER, 999L, true)).contains("不属于当前商家"));
        verify(offers, never()).updateOwnSalePaused(anyLong(), anyLong(), anyInt());
    }

    @Test
    void withdrawnOfferAndNonPerkOfferCannotPause() {
        offer.setStatus(0);
        assertTrue(refused(() -> service.setOwnSalePaused(OFFER, MERCHANT, true)).contains("不属于当前商家"));
        offer.setStatus(1); offer.setTermsMode(TermsMode.TRAFFIC);
        assertTrue(refused(() -> service.setOwnSalePaused(OFFER, MERCHANT, true)).contains("权益档"));
        verify(offers, never()).updateOwnSalePaused(anyLong(), anyLong(), anyInt());
    }

    @Test
    void pauseRefusesWhenTheScopedUpdateTouchesNoRow() {
        when(offers.updateOwnSalePaused(OFFER, MERCHANT, 1)).thenReturn(0);
        assertTrue(refused(() -> service.setOwnSalePaused(OFFER, MERCHANT, true)).contains("请刷新后重试"));
    }
}
