package com.chengyinhub.business.service.impl;

import com.chengyinhub.business.domain.CmsMemberTemplate;
import com.chengyinhub.business.domain.CmsTopic;
import com.chengyinhub.business.domain.CmsTopicChapter;
import com.chengyinhub.business.domain.CmsTopicNode;
import com.chengyinhub.business.domain.MerchantChapterApplication;
import com.chengyinhub.business.domain.MerchantChapterOffer;
import com.chengyinhub.business.domain.enums.TopicLifecycleState;
import com.chengyinhub.business.mapper.CmsTopicChapterMapper;
import com.chengyinhub.business.mapper.CmsTopicMapper;
import com.chengyinhub.business.mapper.MerchantChapterApplicationMapper;
import com.chengyinhub.business.mapper.MerchantChapterOfferMapper;
import com.chengyinhub.business.service.ICmsMemberTemplateService;
import com.chengyinhub.business.service.ICmsTopicChapterService;
import com.chengyinhub.business.service.ICmsTopicNodeService;
import com.chengyinhub.business.service.ICmsTopicService;
import com.chengyinhub.business.service.support.TopicSupplyReviewService;
import com.chengyinhub.common.constant.TermsMode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Collections;
import java.util.Date;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * §4.3 (1) 解锁 Catch-22 requireOwnTemplate：PERK / TRAFFIC 章节允许 templateId=null，
 * 但只要传了 templateId 仍严格校验归属；REVSHARE 仍要求自有玩法模板。
 */
class MerchantFiveMinJoinUnlockTemplateTest {

    private static final Long ME = 88L;
    private static final Long OTHER = 99L;
    private static final Long CHAPTER = 9L;
    private static final Long TOPIC = 100L;
    private static final Long PUBLISHER = 5L;

    private ICmsTopicNodeService nodeSvc;
    private ICmsTopicChapterService chapterSvc;
    private ICmsTopicService topicSvc;
    private ICmsMemberTemplateService tplSvc;
    private MerchantChapterOfferMapper offerMapper;
    private MerchantChapterApplicationMapper applicationMapper;
    private CmsTopicChapterMapper chapterMapper;
    private CmsTopicMapper topicMapper;
    private ChapterMerchantNodeServiceImpl service;
    private CmsTopicChapter chapter;

    @BeforeEach
    void setUp() {
        nodeSvc = mock(ICmsTopicNodeService.class);
        chapterSvc = mock(ICmsTopicChapterService.class);
        topicSvc = mock(ICmsTopicService.class);
        tplSvc = mock(ICmsMemberTemplateService.class);
        offerMapper = mock(MerchantChapterOfferMapper.class);
        applicationMapper = mock(MerchantChapterApplicationMapper.class);
        chapterMapper = mock(CmsTopicChapterMapper.class);
        topicMapper = mock(CmsTopicMapper.class);

        service = new ChapterMerchantNodeServiceImpl(
                nodeSvc, chapterSvc, topicSvc, tplSvc, offerMapper, applicationMapper);
        ReflectionTestUtils.setField(service, "supplyReviewService", mock(TopicSupplyReviewService.class));
        ReflectionTestUtils.setField(service, "chapterMapper", chapterMapper);
        ReflectionTestUtils.setField(service, "topicMapper", topicMapper);

        when(chapterMapper.lockChaptersForCapacity(Collections.singletonList(CHAPTER)))
                .thenReturn(Collections.singletonList(CHAPTER));

        chapter = new CmsTopicChapter();
        chapter.setId(CHAPTER);
        chapter.setTopicId(TOPIC);
        chapter.setTermsMode(TermsMode.PERK);
        chapter.setAllowedValidationMethods("1,2");
        when(chapterSvc.selectCmsTopicChapterById(CHAPTER)).thenReturn(chapter);

        CmsTopic topic = new CmsTopic();
        topic.setId(TOPIC);
        topic.setMemberId(PUBLISHER);
        topic.setLifecycle(TopicLifecycleState.RECRUITING.getCode());
        topic.setStartDate(new Date(System.currentTimeMillis() + 5 * 86400000L));
        when(topicSvc.selectCmsTopicById(TOPIC)).thenReturn(topic);
        when(topicMapper.selectCmsTopicByIdForUpdate(TOPIC)).thenReturn(topic);

        when(nodeSvc.selectCmsTopicNodeList(any())).thenReturn(Collections.emptyList());

        MerchantChapterApplication app = new MerchantChapterApplication();
        app.setChapterId(CHAPTER);
        app.setMerchantId(ME);
        app.setStatus(MerchantChapterApplication.STATUS_APPROVED);
        app.setSource(MerchantChapterApplication.SOURCE_INVITE);
        when(applicationMapper.selectByChapterAndMerchantForUpdate(CHAPTER, ME)).thenReturn(app);
    }

    private CmsTopicNode baseDraft(Long templateId) {
        CmsTopicNode n = new CmsTopicNode();
        n.setName("角落手冲咖啡");
        n.setAddress("星海街 8 号");
        n.setLongitude("120.7");
        n.setLatitude("31.3");
        n.setTemplateId(templateId);
        return n;
    }

    @Test
    void perkChapterAllowsNullTemplateIdAndDoesNotQueryTemplateService() {
        chapter.setTermsMode(TermsMode.PERK);

        service.submit(ME, CHAPTER, baseDraft(null));

        ArgumentCaptor<CmsTopicNode> cap = ArgumentCaptor.forClass(CmsTopicNode.class);
        verify(nodeSvc).insertCmsTopicNode(cap.capture());
        assertNull(cap.getValue().getTemplateId());
        assertEquals(ME, cap.getValue().getMerchantMemberId());
        verify(tplSvc, never()).selectCmsMemberTemplateById(any());
    }

    @Test
    void trafficChapterAllowsNullTemplateId() {
        chapter.setTermsMode(TermsMode.TRAFFIC);

        service.submit(ME, CHAPTER, baseDraft(0L));

        ArgumentCaptor<CmsTopicNode> cap = ArgumentCaptor.forClass(CmsTopicNode.class);
        verify(nodeSvc).insertCmsTopicNode(cap.capture());
        assertNull(cap.getValue().getTemplateId());
        verify(tplSvc, never()).selectCmsMemberTemplateById(any());
    }

    @Test
    void perkChapterStillRejectsForeignTemplateIdWhenProvided() {
        chapter.setTermsMode(TermsMode.PERK);
        CmsMemberTemplate foreign = new CmsMemberTemplate();
        foreign.setId(701L);
        foreign.setMemberId(OTHER);
        when(tplSvc.selectCmsMemberTemplateById(701L)).thenReturn(foreign);

        IllegalStateException err = assertThrows(IllegalStateException.class,
                () -> service.submit(ME, CHAPTER, baseDraft(701L)));
        assertTrue(err.getMessage().contains("不属于你"));
        verify(nodeSvc, never()).insertCmsTopicNode(any());
    }

    @Test
    void revshareChapterStillRequiresOwnTemplateId() {
        chapter.setTermsMode(TermsMode.REVSHARE);

        IllegalStateException err = assertThrows(IllegalStateException.class,
                () -> service.submit(ME, CHAPTER, baseDraft(null)));
        assertTrue(err.getMessage().contains("玩法模板"));
        verify(nodeSvc, never()).insertCmsTopicNode(any());
    }

    @Test
    void emptyTopicDraftAllowsNullTemplateButStillRejectsForeignTemplate() {
        service.assertEmptyTopicDraft(ME, baseDraft(null));
        verify(tplSvc, never()).selectCmsMemberTemplateById(any());

        CmsMemberTemplate foreign = new CmsMemberTemplate();
        foreign.setId(702L);
        foreign.setMemberId(OTHER);
        when(tplSvc.selectCmsMemberTemplateById(702L)).thenReturn(foreign);
        assertThrows(IllegalStateException.class, () -> service.assertEmptyTopicDraft(ME, baseDraft(702L)));
    }
}
