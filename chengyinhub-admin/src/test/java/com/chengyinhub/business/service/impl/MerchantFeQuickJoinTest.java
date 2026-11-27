package com.chengyinhub.business.service.impl;

import com.chengyinhub.business.access.merchant.IMerchantAccessService;
import com.chengyinhub.business.access.merchant.MerchantAccessContext;
import com.chengyinhub.business.access.merchant.MerchantPermission;
import com.chengyinhub.business.domain.CmsTopic;
import com.chengyinhub.business.domain.CmsTopicChapter;
import com.chengyinhub.business.domain.CmsTopicNode;
import com.chengyinhub.business.domain.CoopPerkTemplate;
import com.chengyinhub.business.domain.MerchantChapterApplication;
import com.chengyinhub.business.domain.MerchantChapterOffer;
import com.chengyinhub.business.domain.MmsMerchant;
import com.chengyinhub.business.domain.dto.MerchantFeQuickJoinDTO;
import com.chengyinhub.business.mapper.CmsTopicChapterMapper;
import com.chengyinhub.business.mapper.CmsTopicMapper;
import com.chengyinhub.business.mapper.MerchantChapterApplicationMapper;
import com.chengyinhub.business.mapper.MmsMerchantMapper;
import com.chengyinhub.business.service.IChapterMerchantNodeService;
import com.chengyinhub.business.service.ICoopInviteService;
import com.chengyinhub.business.service.IMerchantChapterApplicationService;
import com.chengyinhub.business.service.IMerchantFeQuickJoinService;
import com.chengyinhub.business.service.IMerchantOfferService;
import com.chengyinhub.business.service.support.OfferRedeemLimits;
import com.chengyinhub.common.constant.ProductType;
import com.chengyinhub.common.constant.TermsMode;
import com.chengyinhub.common.core.domain.AjaxResult;
import com.chengyinhub.common.exception.ServiceException;
import com.chengyinhub.web.controller.api.ApiMerchantFeQuickJoinController;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Collections;
import java.util.Date;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * §4.3 (3) 白话快速加入聚合接口（POST /api/merchant/fe/quick-join）及 OfferRedeemLimits 闲时时段测试。
 */
class MerchantFeQuickJoinTest {

    private static final Long MERCHANT_OWNER = 88L;
    private static final Long OTHER_MERCHANT = 99L;
    private static final Long HOST_OWNER = 5L;
    private static final Long TOPIC_ID = 100L;
    private static final Long CHAPTER_ID = 20L;
    private static final Long APP_ID = 301L;

    private CmsTopicChapterMapper chapterMapper;
    private CmsTopicMapper topicMapper;
    private MmsMerchantMapper merchantMapper;
    private MerchantChapterApplicationMapper applicationMapper;
    private IMerchantChapterApplicationService applicationService;
    private IChapterMerchantNodeService nodeService;
    private ICoopInviteService coopInviteService;
    private IMerchantOfferService offerService;
    private MerchantFeQuickJoinServiceImpl service;

    @BeforeEach
    void setUp() {
        chapterMapper = mock(CmsTopicChapterMapper.class);
        topicMapper = mock(CmsTopicMapper.class);
        merchantMapper = mock(MmsMerchantMapper.class);
        applicationMapper = mock(MerchantChapterApplicationMapper.class);
        applicationService = mock(IMerchantChapterApplicationService.class);
        nodeService = mock(IChapterMerchantNodeService.class);
        coopInviteService = mock(ICoopInviteService.class);
        offerService = mock(IMerchantOfferService.class);

        service = new MerchantFeQuickJoinServiceImpl(
                chapterMapper, topicMapper, merchantMapper, applicationMapper,
                applicationService, nodeService, coopInviteService, offerService);

        MmsMerchant merchant = new MmsMerchant();
        merchant.setId(50L);
        merchant.setMemberId(MERCHANT_OWNER);
        merchant.setName("角落手冲咖啡");
        merchant.setAddress("星海街 8 号");
        merchant.setLocationLat(31.30D);
        merchant.setLocationLng(120.70D);
        merchant.setCoverImage("https://www.chengyinhub.com/prod-api/profile/apply-photo.jpg");
        merchant.setStatus(1L);
        merchant.setAccountStatus(1L);
        merchant.setDelFlag(0);
        when(merchantMapper.selectMmsMerchantByMemberId(MERCHANT_OWNER)).thenReturn(merchant);

        CmsTopicChapter chapter = new CmsTopicChapter();
        chapter.setId(CHAPTER_ID);
        chapter.setTopicId(TOPIC_ID);
        chapter.setTermsMode(TermsMode.PERK);
        chapter.setRecruitEnabled(1);
        chapter.setPerkMinValue(new BigDecimal("18"));
        when(chapterMapper.selectCmsTopicChapterById(CHAPTER_ID)).thenReturn(chapter);

        CmsTopic topic = new CmsTopic();
        topic.setId(TOPIC_ID);
        topic.setMemberId(HOST_OWNER);
        topic.setProductType(ProductType.FREE_EXPLORE);
        topic.setDelFlag(0);
        topic.setEndDate(new Date(System.currentTimeMillis() + 30 * 86400_000L));
        when(topicMapper.selectCmsTopicById(TOPIC_ID)).thenReturn(topic);

        CmsTopicNode savedNode = new CmsTopicNode();
        savedNode.setId(601L);
        when(nodeService.submit(eq(MERCHANT_OWNER), eq(CHAPTER_ID), any())).thenReturn(savedNode);
        when(coopInviteService.savePerkTemplate(any())).thenReturn(701L);
        when(offerService.enroll(any(), eq(MERCHANT_OWNER))).thenReturn(801L);
    }

    @Test
    void invitedMerchantQuickJoinsInOneCallDefaultingPhotoAndMappingRedeemLimits() {
        MerchantChapterApplication invite = new MerchantChapterApplication();
        invite.setId(APP_ID);
        invite.setChapterId(CHAPTER_ID);
        invite.setMerchantId(MERCHANT_OWNER);
        invite.setSource(MerchantChapterApplication.SOURCE_INVITE);
        invite.setStatus(MerchantChapterApplication.STATUS_PENDING);
        invite.setDelFlag(0);
        when(applicationMapper.selectMerchantChapterApplicationById(APP_ID)).thenReturn(invite);

        MerchantChapterApplication accepted = new MerchantChapterApplication();
        accepted.setId(APP_ID);
        accepted.setChapterId(CHAPTER_ID);
        accepted.setMerchantId(MERCHANT_OWNER);
        accepted.setSource(MerchantChapterApplication.SOURCE_INVITE);
        accepted.setStatus(MerchantChapterApplication.STATUS_APPROVED);
        accepted.setDelFlag(0);
        when(applicationService.respondInvite(APP_ID, MERCHANT_OWNER, true)).thenReturn(accepted);

        MerchantFeQuickJoinDTO dto = new MerchantFeQuickJoinDTO();
        dto.setChapterId(CHAPTER_ID);
        dto.setApplicationId(APP_ID);
        dto.setPerkDescription("手冲美式一杯");
        dto.setOriginalPrice(new BigDecimal("28"));
        dto.setOffPeakHours("14:00-17:00");
        dto.setDailyCap(15);
        dto.setTermsAgreed(true);
        // storefrontPhoto 故意不传：默认继承入驻门头照

        Map<String, Object> out = service.quickJoin(MERCHANT_OWNER, dto);

        assertEquals("JOINED", out.get("status"));
        assertEquals(601L, out.get("nodeId"));
        assertEquals(701L, out.get("perkTemplateId"));
        assertEquals(801L, out.get("offerId"));
        assertEquals("https://www.chengyinhub.com/prod-api/profile/apply-photo.jpg", out.get("storefrontPhoto"));

        ArgumentCaptor<CmsTopicNode> nodeCap = ArgumentCaptor.forClass(CmsTopicNode.class);
        verify(nodeService).submit(eq(MERCHANT_OWNER), eq(CHAPTER_ID), nodeCap.capture());
        assertNull(nodeCap.getValue().getTemplateId(), "快速加入节点不强迫绑定玩法模板");

        ArgumentCaptor<CoopPerkTemplate> tplCap = ArgumentCaptor.forClass(CoopPerkTemplate.class);
        verify(coopInviteService).savePerkTemplate(tplCap.capture());
        assertEquals("手冲美式一杯", tplCap.getValue().getName());
        assertEquals(new BigDecimal("28"), tplCap.getValue().getRetailValue());
        assertTrue(tplCap.getValue().getRedeemRule().contains("14:00-17:00"));
        assertTrue(tplCap.getValue().getRedeemRule().contains("每日限量15份"));

        ArgumentCaptor<MerchantChapterOffer> offerCap = ArgumentCaptor.forClass(MerchantChapterOffer.class);
        verify(offerService).enroll(offerCap.capture(), eq(MERCHANT_OWNER));
        assertEquals(Integer.valueOf(15), offerCap.getValue().getDailyCapacity());
        assertEquals("https://www.chengyinhub.com/prod-api/profile/apply-photo.jpg", offerCap.getValue().getStorefrontImg());
        assertEquals(Boolean.TRUE, offerCap.getValue().getTermsAgreed());
    }

    @Test
    void crossMerchantApplicationIdIsRejectedIdorSafe() {
        MerchantChapterApplication othersInvite = new MerchantChapterApplication();
        othersInvite.setId(APP_ID);
        othersInvite.setChapterId(CHAPTER_ID);
        othersInvite.setMerchantId(OTHER_MERCHANT);
        othersInvite.setSource(MerchantChapterApplication.SOURCE_INVITE);
        othersInvite.setStatus(MerchantChapterApplication.STATUS_PENDING);
        othersInvite.setDelFlag(0);
        when(applicationMapper.selectMerchantChapterApplicationById(APP_ID)).thenReturn(othersInvite);

        MerchantFeQuickJoinDTO dto = new MerchantFeQuickJoinDTO();
        dto.setChapterId(CHAPTER_ID);
        dto.setApplicationId(APP_ID);
        dto.setPerkDescription("拿铁一杯");
        dto.setOriginalPrice(new BigDecimal("30"));
        dto.setTermsAgreed(true);

        IllegalStateException err = assertThrows(IllegalStateException.class,
                () -> service.quickJoin(MERCHANT_OWNER, dto));
        assertTrue(err.getMessage().contains("不属于当前商家"));
        verify(offerService, never()).enroll(any(), any());
    }

    @Test
    void selfApplyDoesNotBypassHostApproval() {
        when(applicationMapper.selectByChapterAndMerchant(CHAPTER_ID, MERCHANT_OWNER)).thenReturn(null);
        MerchantChapterApplication pending = new MerchantChapterApplication();
        pending.setId(399L);
        pending.setChapterId(CHAPTER_ID);
        pending.setMerchantId(MERCHANT_OWNER);
        pending.setStatus(MerchantChapterApplication.STATUS_PENDING);
        pending.setSource(MerchantChapterApplication.SOURCE_APPLY);
        pending.setDelFlag(0);
        when(applicationService.apply(CHAPTER_ID, MERCHANT_OWNER, null)).thenReturn(pending);

        MerchantFeQuickJoinDTO dto = new MerchantFeQuickJoinDTO();
        dto.setChapterId(CHAPTER_ID);
        dto.setPerkDescription("招牌拿铁");
        dto.setOriginalPrice(new BigDecimal("26"));
        dto.setDailyCap(10);

        Map<String, Object> out = service.quickJoin(MERCHANT_OWNER, dto);
        assertEquals("PENDING_APPROVAL", out.get("status"));
        assertNull(out.get("offerId"), "自申请未过审时绝不跳过主办审批直接落生效供给");
        verify(offerService, never()).enroll(any(), any());
    }

    @Test
    void controllerEnforcesLoginAndMerchantPermissions() {
        IMerchantAccessService accessSvc = mock(IMerchantAccessService.class);
        IMerchantFeQuickJoinService joinSvc = mock(IMerchantFeQuickJoinService.class);

        ApiMerchantFeQuickJoinController unauth = new ApiMerchantFeQuickJoinController() {
            @Override
            public Long getAppUserId() { return 0L; }
        };
        ReflectionTestUtils.setField(unauth, "merchantAccessService", accessSvc);
        ReflectionTestUtils.setField(unauth, "quickJoinService", joinSvc);
        assertNotEquals(200, unauth.quickJoin(new MerchantFeQuickJoinDTO()).get(AjaxResult.CODE_TAG));

        ApiMerchantFeQuickJoinController noPerm = new ApiMerchantFeQuickJoinController() {
            @Override
            public Long getAppUserId() { return MERCHANT_OWNER; }
        };
        when(accessSvc.require(MERCHANT_OWNER, MerchantPermission.COOP_MANAGE))
                .thenThrow(new ServiceException("无合作管理权限", 403));
        ReflectionTestUtils.setField(noPerm, "merchantAccessService", accessSvc);
        ReflectionTestUtils.setField(noPerm, "quickJoinService", joinSvc);
        AjaxResult denied = noPerm.quickJoin(new MerchantFeQuickJoinDTO());
        assertEquals(403, denied.get(AjaxResult.CODE_TAG));
        verify(joinSvc, never()).quickJoin(any(), any());

        ApiMerchantFeQuickJoinController allowed = new ApiMerchantFeQuickJoinController() {
            @Override
            public Long getAppUserId() { return 777L; }
        };
        MerchantAccessContext ctx = mock(MerchantAccessContext.class);
        when(ctx.getOwnerMemberId()).thenReturn(MERCHANT_OWNER);
        when(accessSvc.require(777L, MerchantPermission.COOP_MANAGE)).thenReturn(ctx);
        when(accessSvc.require(777L, MerchantPermission.PROJECT_MANAGE)).thenReturn(ctx);
        when(joinSvc.quickJoin(eq(MERCHANT_OWNER), any())).thenReturn(Collections.singletonMap("status", "JOINED"));
        ReflectionTestUtils.setField(allowed, "merchantAccessService", accessSvc);
        ReflectionTestUtils.setField(allowed, "quickJoinService", joinSvc);

        AjaxResult ok = allowed.quickJoin(new MerchantFeQuickJoinDTO());
        assertEquals(200, ok.get(AjaxResult.CODE_TAG));
        verify(joinSvc).quickJoin(eq(MERCHANT_OWNER), any());
    }

    @Test
    void offerRedeemLimitsEnforcesOffPeakHoursAndDailyCap() {
        assertEquals("14:00-17:00", OfferRedeemLimits.normalizeOffPeakHours("14:00-17:00"));
        assertEquals("工作日 10:00-17:00", OfferRedeemLimits.normalizeOffPeakHours("工作日 10:00~17:00"));
        assertNull(OfferRedeemLimits.normalizeOffPeakHours("全天可用"));
        assertThrows(IllegalArgumentException.class, () -> OfferRedeemLimits.normalizeOffPeakHours("18:00-14:00"));

        String rule = OfferRedeemLimits.composeRedeemRule("工作日 14:00-17:00", 10);
        LocalDate thursday = LocalDate.of(2026, 11, 26); // Thursday
        assertNull(OfferRedeemLimits.rejection(10, null, 3, thursday, rule, LocalDateTime.of(2026, 11, 26, 15, 0)));
        assertTrue(OfferRedeemLimits.rejection(10, null, 3, thursday, rule, LocalDateTime.of(2026, 11, 26, 12, 0))
                .contains("14:00-17:00"));
        // Saturday outside 工作日
        assertTrue(OfferRedeemLimits.rejection(10, null, 3, LocalDate.of(2026, 11, 28), rule,
                LocalDateTime.of(2026, 11, 28, 15, 0)).contains("工作日 14:00-17:00"));
        // Daily cap still enforced first
        assertEquals(OfferRedeemLimits.DAILY_FULL,
                OfferRedeemLimits.rejection(10, null, 10, thursday, rule, LocalDateTime.of(2026, 11, 26, 15, 0)));
    }
}
