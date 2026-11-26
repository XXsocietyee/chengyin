package com.chengyinhub.business.service;

import com.chengyinhub.business.domain.CmsTopic;
import com.chengyinhub.business.domain.CmsTopicChapter;
import com.chengyinhub.business.domain.MerchantChapterOffer;
import com.chengyinhub.business.mapper.CmsTopicChapterMapper;
import com.chengyinhub.business.mapper.CmsTopicMapper;
import com.chengyinhub.business.mapper.MerchantChapterApplicationMapper;
import com.chengyinhub.business.mapper.MerchantChapterOfferMapper;
import com.chengyinhub.business.mapper.RegistrationEntitlementMapper;
import com.chengyinhub.business.service.impl.MerchantOfferServiceImpl;
import com.chengyinhub.business.service.support.CommittedBusinessNotice;
import com.chengyinhub.business.service.support.TopicSupplyReviewService;
import com.chengyinhub.common.constant.ProductType;
import com.chengyinhub.common.constant.TermsMode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Arrays;
import java.util.Collections;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** P1-7:主办方移除某家店的生效供给(必须填原因),副作用同商家退出,通知被移除的商家。 */
class MerchantChapterOfferOrganizerRemoveTest {
    private static final Long OFFER = 9L, CHAPTER = 33L, TOPIC = 10L, MERCHANT = 500L, ORGANIZER = 501L;
    private MerchantChapterOfferMapper offers;
    private MerchantChapterApplicationMapper applications;
    private CmsTopicChapterMapper chapters;
    private CmsTopicMapper topics;
    private ICmsTopicService topicService;
    private ITopicSaleCanonicalMutationService canonical;
    private TopicSupplyReviewService review;
    private CommittedBusinessNotice notices;
    private RegistrationEntitlementMapper entitlements;
    private INotifyService notify;
    private ISystemNotificationIntentService intents;
    private MerchantOfferServiceImpl service;
    private MerchantChapterOffer offer;
    private CmsTopicChapter chapter;
    private CmsTopic topic;

    @BeforeEach
    void setUp() {
        offers = mock(MerchantChapterOfferMapper.class);
        applications = mock(MerchantChapterApplicationMapper.class);
        chapters = mock(CmsTopicChapterMapper.class);
        topics = mock(CmsTopicMapper.class);
        topicService = mock(ICmsTopicService.class);
        canonical = mock(ITopicSaleCanonicalMutationService.class);
        review = mock(TopicSupplyReviewService.class);
        notices = mock(CommittedBusinessNotice.class);
        entitlements = mock(RegistrationEntitlementMapper.class);
        notify = mock(INotifyService.class);
        intents = mock(ISystemNotificationIntentService.class);
        service = new MerchantOfferServiceImpl();
        ReflectionTestUtils.setField(service, "supplyReviewService", review);
        ReflectionTestUtils.setField(service, "systemNotificationIntents", intents);
        ReflectionTestUtils.setField(service, "businessNotice", notices);
        ReflectionTestUtils.setField(service, "registrationEntitlementMapper", entitlements);
        ReflectionTestUtils.setField(service, "notifyService", notify);
        ReflectionTestUtils.setField(service, "offerMapper", offers);
        ReflectionTestUtils.setField(service, "applicationMapper", applications);
        ReflectionTestUtils.setField(service, "chapterMapper", chapters);
        ReflectionTestUtils.setField(service, "cmsTopicMapper", topics);
        ReflectionTestUtils.setField(service, "cmsTopicService", topicService);
        ReflectionTestUtils.setField(service, "canonicalMutationService", canonical);
        offer = new MerchantChapterOffer();
        offer.setId(OFFER); offer.setTopicId(TOPIC); offer.setChapterId(CHAPTER);
        offer.setMerchantId(MERCHANT); offer.setStatus(1); offer.setTermsMode(TermsMode.PERK);
        offer.setQuotaTotal(20); offer.setQuotaUsed(6);
        chapter = new CmsTopicChapter();
        chapter.setId(CHAPTER); chapter.setTopicId(TOPIC); chapter.setRequired(1);
        topic = new CmsTopic();
        topic.setId(TOPIC); topic.setDelFlag(0); topic.setProductType(ProductType.FREE_EXPLORE);
        topic.setLifecycle(3); topic.setUserStatus(1); topic.setMemberId(ORGANIZER); topic.setName("夜游");
        when(offers.selectById(OFFER)).thenReturn(offer);
        when(offers.selectByIdForUpdate(OFFER)).thenReturn(offer);
        when(chapters.lockChaptersForCapacity(Collections.singletonList(CHAPTER)))
                .thenReturn(Collections.singletonList(CHAPTER));
        when(chapters.selectCmsTopicChapterById(CHAPTER)).thenReturn(chapter);
        when(topics.selectCmsTopicByIdForUpdate(TOPIC)).thenReturn(topic);
        when(topicService.casUserStatus(TOPIC, 1, 0)).thenReturn(1);
        when(offers.removeByOrganizer(eq(OFFER), eq(TOPIC), anyString(), anyBoolean(), eq(ORGANIZER))).thenReturn(1);
    }

    private String refused(Long operator, String reason) {
        return assertThrows(IllegalStateException.class,
                () -> service.removeChapterOfferAsOrganizer(OFFER, operator, reason)).getMessage();
    }

    private void verifyNothingRemoved() {
        verify(offers, never()).removeByOrganizer(anyLong(), anyLong(), anyString(), anyBoolean(), anyLong());
        verify(offers, never()).withdrawOwned(anyLong(), anyLong(), anyString(), anyBoolean());
        verify(applications, never()).retireApprovedForSupplyExit(anyLong(), anyLong(), anyLong());
    }

    @Test
    void organizerRemovalEndsTheOfferWithPrefixedReasonAndOperatorUnderTheSameLocks() {
        assertTrue(service.removeChapterOfferAsOrganizer(OFFER, ORGANIZER, "  多次爽约  "));
        InOrder order = inOrder(review, chapters, topics, offers, topicService, applications);
        order.verify(offers).selectById(OFFER);
        order.verify(review).lockBeforeChapter(CHAPTER);
        order.verify(chapters).lockChaptersForCapacity(Collections.singletonList(CHAPTER));
        order.verify(chapters).selectCmsTopicChapterById(CHAPTER);
        order.verify(topics).selectCmsTopicByIdForUpdate(TOPIC);
        order.verify(offers).selectByIdForUpdate(OFFER);
        order.verify(topicService).casUserStatus(TOPIC, 1, 0);
        order.verify(offers).removeByOrganizer(OFFER, TOPIC, "主办方移除：多次爽约", true, ORGANIZER);
        order.verify(applications).retireApprovedForSupplyExit(TOPIC, CHAPTER, MERCHANT);
        verify(offers, never()).withdrawOwned(anyLong(), anyLong(), anyString(), anyBoolean());
        verify(canonical).invalidateApprovedCanonical(TOPIC, "ordinary-chapter-supply-organizer-remove");
        verify(review).invalidate(TOPIC, ORGANIZER);
        assertEquals(6, offer.getQuotaUsed());
    }

    @Test
    void removedMerchantGetsTheReasonAndTheOrganizerIsNotNotified() {
        service.removeChapterOfferAsOrganizer(OFFER, ORGANIZER, "多次爽约");
        verifyNoInteractions(intents);
        ArgumentCaptor<Supplier<Boolean>> toMerchant = ArgumentCaptor.forClass(Supplier.class);
        verify(notices).executeAfterCommit(eq("chapter-supply-remove-merchant"), eq(OFFER), toMerchant.capture());
        ArgumentCaptor<Supplier<Boolean>> toPlayers = ArgumentCaptor.forClass(Supplier.class);
        verify(notices).executeAfterCommit(eq("chapter-supply-withdraw-players"), eq(OFFER), toPlayers.capture());
        verifyNoInteractions(notify);
        when(notify.notifyOfficialBroadcast(anyLong(), anyString(), anyString())).thenReturn(true);
        assertTrue(toMerchant.getValue().get());
        verify(notify).notifyOfficialBroadcast(eq(MERCHANT), anyString(), contains("原因：多次爽约"));
        when(entitlements.selectAffectedPaidMembers(TOPIC, CHAPTER)).thenReturn(Arrays.asList(ORGANIZER, 601L, 601L));
        assertTrue(toPlayers.getValue().get());
        verify(notify).notifyOfficialBroadcast(eq(601L), anyString(), anyString());
        verify(notify, never()).notifyOfficialBroadcast(eq(ORGANIZER), anyString(), anyString());
    }

    @Test
    void optionalChapterRemovalDoesNotPauseTheRoute() {
        chapter.setRequired(0);
        assertFalse(service.removeChapterOfferAsOrganizer(OFFER, ORGANIZER, "多次爽约"));
        verify(topicService, never()).casUserStatus(anyLong(), anyInt(), anyInt());
        verify(offers).removeByOrganizer(OFFER, TOPIC, "主办方移除：多次爽约", false, ORGANIZER);
    }

    @Test
    void reasonIsRequiredAndBoundedBeforeReadingAnyOffer() {
        assertTrue(refused(ORGANIZER, null).contains("移除原因"));
        assertTrue(refused(ORGANIZER, "   ").contains("移除原因"));
        assertTrue(refused(ORGANIZER, String.join("", Collections.nCopies(495, "长"))).contains("移除原因"));
        verifyNoInteractions(offers);
    }

    @Test
    void longestAcceptedReasonStillFitsTheReasonColumn() {
        String longest = String.join("", Collections.nCopies(494, "长"));
        service.removeChapterOfferAsOrganizer(OFFER, ORGANIZER, longest);
        ArgumentCaptor<String> stored = ArgumentCaptor.forClass(String.class);
        verify(offers).removeByOrganizer(eq(OFFER), eq(TOPIC), stored.capture(), eq(true), eq(ORGANIZER));
        assertEquals(500, stored.getValue().length());
    }

    @Test
    void nonOrganizerIsRefusedIncludingTheMerchantItself() {
        assertTrue(refused(999L, "多次爽约").contains("仅主题发布者"));
        assertTrue(refused(MERCHANT, "多次爽约").contains("仅主题发布者"));
        verifyNothingRemoved();
        verify(topicService, never()).casUserStatus(anyLong(), anyInt(), anyInt());
        verifyNoInteractions(canonical, notices);
    }

    @Test
    void authorSelfSuppliedOfferIsOutOfScope() {
        offer.setSupplierKind(MerchantChapterOffer.SUPPLIER_AUTHOR);
        offer.setMerchantId(ORGANIZER); offer.setSupplierMemberId(ORGANIZER);
        assertTrue(refused(ORGANIZER, "不做了").contains("撤回自己承接"));
        verifyNothingRemoved();
        verifyNoInteractions(canonical, notices);
    }

    @Test
    void missingOfferAndOfferMovedToAnotherTopicAreRefused() {
        when(offers.selectById(OFFER)).thenReturn(null);
        assertTrue(refused(ORGANIZER, "多次爽约").contains("不存在"));
        when(offers.selectById(OFFER)).thenReturn(offer);
        MerchantChapterOffer moved = new MerchantChapterOffer();
        moved.setId(OFFER); moved.setMerchantId(MERCHANT); moved.setChapterId(CHAPTER); moved.setTopicId(77L);
        moved.setStatus(1);
        when(offers.selectByIdForUpdate(OFFER)).thenReturn(moved);
        assertTrue(refused(ORGANIZER, "多次爽约").contains("归属已变化"));
        verifyNothingRemoved();
    }

    @Test
    void circleTopicAndEndedTopicStayOutsideThisEntry() {
        topic.setCircleThemeCode("AFTER_WORK");
        assertTrue(refused(ORGANIZER, "多次爽约").contains("普通自由探索"));
        topic.setCircleThemeCode(null); topic.setLifecycle(6);
        assertTrue(refused(ORGANIZER, "多次爽约").contains("已结束"));
        verifyNothingRemoved();
    }

    @Test
    void failedScopedUpdateCannotReleaseTheApprovalOrNotifyAnyone() {
        when(offers.removeByOrganizer(eq(OFFER), eq(TOPIC), anyString(), anyBoolean(), eq(ORGANIZER))).thenReturn(0);
        assertTrue(refused(ORGANIZER, "多次爽约").contains("请刷新后重试"));
        verify(applications, never()).retireApprovedForSupplyExit(anyLong(), anyLong(), anyLong());
        verifyNoInteractions(canonical, notices);
    }

    @Test
    void alreadyExitedOfferIsNotRemovedTwice() {
        offer.setStatus(0); offer.setWithdrawReason("暂停营业"); topic.setUserStatus(0);
        assertTrue(service.removeChapterOfferAsOrganizer(OFFER, ORGANIZER, "多次爽约"));
        verifyNothingRemoved();
        verifyNoInteractions(canonical, notices);
        assertEquals("暂停营业", offer.getWithdrawReason());
    }

    @Test
    void removedRowSatisfiesTheReplacementInvitePredicate() {
        // 补位邀请(MerchantChapterApplicationServiceImpl.invite)与 enroll 的补位分支只认:
        // 同主题同章节、status=0、withdraw_reason 非空。主办方移除写入的正是这三项。
        service.removeChapterOfferAsOrganizer(OFFER, ORGANIZER, "多次爽约");
        ArgumentCaptor<String> stored = ArgumentCaptor.forClass(String.class);
        verify(offers).removeByOrganizer(eq(OFFER), eq(TOPIC), stored.capture(), anyBoolean(), any());
        assertFalse(stored.getValue().trim().isEmpty());
    }
}
