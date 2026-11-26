package com.chengyinhub.web.controller.api;

import com.chengyinhub.business.access.merchant.IMerchantAccessService;
import com.chengyinhub.business.access.merchant.MerchantAccessContext;
import com.chengyinhub.business.access.merchant.MerchantPermission;
import com.chengyinhub.business.access.merchant.MerchantRoleCode;
import com.chengyinhub.business.domain.MemberCapability;
import com.chengyinhub.business.domain.MmsMerchant;
import com.chengyinhub.business.domain.vo.TopicTemplateChapterVO;
import com.chengyinhub.business.domain.vo.TopicTemplateDetailVO;
import com.chengyinhub.business.domain.vo.TopicTemplateRecruitVO;
import com.chengyinhub.business.service.ICapabilityService;
import com.chengyinhub.business.domain.CmsTopicChapter;
import com.chengyinhub.business.service.ICmsTopicChapterService;
import com.chengyinhub.business.service.ICmsTopicService;
import com.chengyinhub.business.service.IMmsMerchantService;
import com.chengyinhub.business.service.IPlayerWxacodeService;
import com.chengyinhub.common.constant.ProductType;
import com.chengyinhub.common.core.domain.AjaxResult;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 商家发现页只可读取服务端过滤后的自由探索章节，不能从普通主题详情猜容量或品类。 */
class ApiTopicMerchantRecruitmentControllerTest {

    private ApiTopicController controller;
    private ICmsTopicService topicService;
    private ICapabilityService capabilityService;
    private IMmsMerchantService merchantService;
    private IMerchantAccessService merchantAccessService;
    private ICmsTopicChapterService chapterService;

    @BeforeEach
    void setUp() {
        topicService = mock(ICmsTopicService.class);
        capabilityService = mock(ICapabilityService.class);
        merchantService = mock(IMmsMerchantService.class);
        merchantAccessService = mock(IMerchantAccessService.class);
        chapterService = mock(ICmsTopicChapterService.class);
        controller = spy(new ApiTopicController());
        doReturn(7L).when(controller).getAppUserId();
        ReflectionTestUtils.setField(controller, "cmsTopicService", topicService);
        ReflectionTestUtils.setField(controller, "capabilityService", capabilityService);
        ReflectionTestUtils.setField(controller, "mmsMerchantService", merchantService);
        ReflectionTestUtils.setField(controller, "merchantAccessService", merchantAccessService);
        ReflectionTestUtils.setField(controller, "cmsTopicChapterService", chapterService);
    }

    @Test
    void merchant_receives_only_server_eligible_chapters() {
        when(capabilityService.hasCapability(7L, MemberCapability.CAP_MERCHANT)).thenReturn(true);
        MmsMerchant merchant = new MmsMerchant();
        merchant.setCategoryId(18);
        when(merchantService.selectMmsMerchantByMemberId(7L)).thenReturn(merchant);

        TopicTemplateDetailVO detail = new TopicTemplateDetailVO();
        detail.setProductType(ProductType.FREE_EXPLORE);
        detail.setChapters(Arrays.asList(chapter(1L, true), chapter(2L, false), chapter(3L, null)));
        when(topicService.buildTopicTemplateDetail(42L, true, 18)).thenReturn(detail);
        when(chapterService.selectCmsTopicChapterList(any())).thenReturn(
                Arrays.asList(new CmsTopicChapter(), new CmsTopicChapter(), new CmsTopicChapter()));

        AjaxResult result = controller.merchantRecruitmentChapters("42", null, null);

        assertEquals(200, result.get("code"));
        // 有章节(哪怕都没开)就不是零章节主题,不能借建章绕过主办方的招商
        assertEquals(3, result.get("chapterCount"));
        assertEquals(false, result.get("emptyTopicJoinable"));
        List<TopicTemplateChapterVO> chapters = (List<TopicTemplateChapterVO>) result.get("data");
        assertEquals(1, chapters.size(), "不匹配、已满或关闭的章节不能泄给商家发现端点");
        assertEquals(1L, chapters.get(0).getId());
        verify(topicService).buildTopicTemplateDetail(42L, true, 18);
    }

    private TopicTemplateChapterVO chapter(Long id, Boolean open) {
        TopicTemplateChapterVO chapter = new TopicTemplateChapterVO();
        chapter.setId(id);
        if (open != null) {
            TopicTemplateRecruitVO recruit = new TopicTemplateRecruitVO();
            recruit.setIsOpen(open);
            chapter.setRecruitStatus(recruit);
        }
        return chapter;
    }

    @Test
    void non_merchant_gets_join_entry_without_chapter_list() {
        when(capabilityService.hasCapability(7L, MemberCapability.CAP_MERCHANT)).thenReturn(false);
        when(topicService.selectCmsTopicById(42L)).thenReturn(topic(ProductType.FREE_EXPLORE, 1, 900L));
        when(chapterService.selectCmsTopicChapterById(5L)).thenReturn(slot(5L, 42L, 1, "小吃"));

        AjaxResult result = controller.merchantRecruitmentChapters("42", null, "5");

        assertEquals(200, result.get("code"));
        assertEquals(true, result.get("needMerchantJoin"));
        assertEquals("NONE", result.get("merchantJoinState"));
        assertEquals("风味巡游", result.get("topicName"));
        assertEquals("小吃", result.get("slotName"));
        assertTrue(((List<?>) result.get("data")).isEmpty(), "章节清单仍只给商家");
        verify(topicService, never()).buildTopicTemplateDetail(any(), eq(true), any());
    }

    @Test
    void join_entry_reports_pending_or_rejected_application_and_hides_foreign_or_closed_slot() {
        when(capabilityService.hasCapability(7L, MemberCapability.CAP_MERCHANT)).thenReturn(false);
        when(topicService.selectCmsTopicById(42L)).thenReturn(topic(ProductType.FREE_EXPLORE, 1, 900L));
        MmsMerchant applied = new MmsMerchant();
        applied.setStatus(0L);
        when(merchantService.selectMmsMerchantByMemberId(7L)).thenReturn(applied);
        when(chapterService.selectCmsTopicChapterById(5L)).thenReturn(slot(5L, 43L, 1, "别的主题"));
        when(chapterService.selectCmsTopicChapterById(6L)).thenReturn(slot(6L, 42L, 0, "未开放"));

        AjaxResult pending = controller.merchantRecruitmentChapters("42", null, "5");
        assertEquals("PENDING", pending.get("merchantJoinState"));
        assertEquals(null, pending.get("slotName"));
        assertEquals(null, controller.merchantRecruitmentChapters("42", null, "6").get("slotName"));

        applied.setStatus(2L);
        assertEquals("REJECTED", controller.merchantRecruitmentChapters("42", null, null).get("merchantJoinState"));
    }

    @Test
    void join_entry_keeps_rejection_for_approved_merchant_without_capability_and_hides_unpublished_topic() {
        when(capabilityService.hasCapability(7L, MemberCapability.CAP_MERCHANT)).thenReturn(false);
        MmsMerchant disabled = new MmsMerchant();
        disabled.setStatus(1L);
        when(merchantService.selectMmsMerchantByMemberId(7L)).thenReturn(disabled);

        AjaxResult rejected = controller.merchantRecruitmentChapters("42", null, null);
        assertEquals(500, rejected.get("code"));
        assertTrue(String.valueOf(rejected.get("msg")).contains("商家"));

        when(merchantService.selectMmsMerchantByMemberId(7L)).thenReturn(null);
        when(topicService.selectCmsTopicById(42L)).thenReturn(topic(ProductType.FREE_EXPLORE, 0, 900L));
        when(chapterService.selectCmsTopicChapterById(5L)).thenReturn(slot(5L, 42L, 1, "小吃"));
        AjaxResult draft = controller.merchantRecruitmentChapters("42", null, "5");
        assertEquals(true, draft.get("needMerchantJoin"));
        assertEquals(null, draft.get("topicName"), "未上架主题不向未入驻的人下发名称");
        assertEquals(null, draft.get("slotName"));

        when(topicService.selectCmsTopicById(42L)).thenReturn(null);
        assertEquals(500, controller.merchantRecruitmentChapters("42", null, null).get("code"));
    }

    @Test
    void recruit_slot_qrcode_is_owner_only_and_bound_to_an_open_slot_of_that_topic() {
        IPlayerWxacodeService codes = mock(IPlayerWxacodeService.class);
        ReflectionTestUtils.setField(controller, "playerWxacodeService", codes);
        when(codes.getOrCreateScene("rc.42.5")).thenReturn("https://img/code.png");
        when(topicService.selectCmsTopicById(42L)).thenReturn(topic(ProductType.FREE_EXPLORE, 1, 7L));
        when(chapterService.selectCmsTopicChapterById(5L)).thenReturn(slot(5L, 42L, 1, "小吃"));
        when(chapterService.selectCmsTopicChapterById(6L)).thenReturn(slot(6L, 42L, 0, "未开放"));
        when(chapterService.selectCmsTopicChapterById(8L)).thenReturn(slot(8L, 43L, 1, "别的主题"));

        AjaxResult ok = controller.recruitSlotQrcode("42", "5", null);
        assertEquals(200, ok.get("code"));
        java.util.Map<?, ?> data = (java.util.Map<?, ?>) ok.get("data");
        assertEquals("https://img/code.png", data.get("qrcodeUrl"));
        assertEquals("小吃", data.get("chapterName"));
        assertEquals(5L, data.get("chapterId"));

        assertEquals(500, controller.recruitSlotQrcode("42", "6", null).get("code"));
        assertEquals(500, controller.recruitSlotQrcode("42", "8", null).get("code"));
        assertEquals(500, controller.recruitSlotQrcode("42", "0", null).get("code"));

        when(topicService.selectCmsTopicById(42L)).thenReturn(topic(ProductType.FREE_EXPLORE, 1, 900L));
        AjaxResult foreign = controller.recruitSlotQrcode("42", "5", null);
        assertEquals(500, foreign.get("code"));
        assertTrue(String.valueOf(foreign.get("msg")).contains("无权"));
        verify(codes, org.mockito.Mockito.times(1)).getOrCreateScene(any());
    }

    private com.chengyinhub.business.domain.CmsTopic topic(int productType, int status, Long ownerId) {
        com.chengyinhub.business.domain.CmsTopic topic = new com.chengyinhub.business.domain.CmsTopic();
        topic.setId(42L);
        topic.setName("风味巡游");
        topic.setProductType(productType);
        topic.setStatus(status);
        topic.setUserStatus(status);
        topic.setDelFlag(0);
        topic.setMemberId(ownerId);
        return topic;
    }

    private CmsTopicChapter slot(Long id, Long topicId, int recruitEnabled, String name) {
        CmsTopicChapter chapter = new CmsTopicChapter();
        chapter.setId(id);
        chapter.setTopicId(topicId);
        chapter.setRecruitEnabled(recruitEnabled);
        chapter.setName(name);
        return chapter;
    }

    @Test
    void city_orienteering_never_exposes_chapter_application_list() {
        when(capabilityService.hasCapability(7L, MemberCapability.CAP_MERCHANT)).thenReturn(true);
        MmsMerchant merchant = new MmsMerchant();
        merchant.setCategoryId(18);
        when(merchantService.selectMmsMerchantByMemberId(7L)).thenReturn(merchant);
        TopicTemplateDetailVO detail = new TopicTemplateDetailVO();
        detail.setProductType(ProductType.ORIENTEERING);
        when(topicService.buildTopicTemplateDetail(42L, true, 18)).thenReturn(detail);

        AjaxResult result = controller.merchantRecruitmentChapters("42", null, null);

        assertEquals(500, result.get("code"));
        assertTrue(String.valueOf(result.get("msg")).contains("自由探索"));
    }

    @Test
    void managerScopeReadsOwnerMerchantCategory() {
        when(merchantAccessService.require(7L, MerchantPermission.COOP_MANAGE)).thenReturn(
                new MerchantAccessContext(7L, 77L, 900L, MerchantRoleCode.MERCHANT_MANAGER));
        MmsMerchant merchant = new MmsMerchant();
        merchant.setId(77L);
        merchant.setMemberId(900L);
        merchant.setCategoryId(18);
        when(merchantService.selectMmsMerchantById(77L)).thenReturn(merchant);
        TopicTemplateDetailVO detail = new TopicTemplateDetailVO();
        detail.setProductType(ProductType.FREE_EXPLORE);
        detail.setChapters(Arrays.asList(chapter(1L, true)));
        when(topicService.buildTopicTemplateDetail(42L, true, 18)).thenReturn(detail);

        when(chapterService.selectCmsTopicChapterList(any())).thenReturn(Arrays.asList(new CmsTopicChapter()));

        AjaxResult result = controller.merchantRecruitmentChapters("42", "MERCHANT", null);

        assertEquals(200, result.get("code"));
        verify(merchantService).selectMmsMerchantById(77L);
        verify(capabilityService, never()).hasCapability(any(), any());
    }
}
