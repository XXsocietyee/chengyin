package com.chengyinhub.web.controller.api;

import com.chengyinhub.business.domain.CmsMemberTemplate;
import com.chengyinhub.business.domain.CmsRegistration;
import com.chengyinhub.business.domain.CmsTopic;
import com.chengyinhub.business.domain.CmsTopicChapter;
import com.chengyinhub.business.domain.CmsTopicNode;
import com.chengyinhub.business.domain.GameRuntimeSession;
import com.chengyinhub.business.domain.PlayerNodeProgress;
import com.chengyinhub.business.mapper.CmsActivityMapper;
import com.chengyinhub.business.mapper.CmsMemberTemplateMapper;
import com.chengyinhub.business.mapper.CmsRegistrationMapper;
import com.chengyinhub.business.mapper.CmsTopicChapterMapper;
import com.chengyinhub.business.mapper.CmsTopicMapper;
import com.chengyinhub.business.mapper.CmsTopicNodeMapper;
import com.chengyinhub.business.mapper.GameRuntimeSessionMapper;
import com.chengyinhub.business.mapper.PlayTeamMapper;
import com.chengyinhub.business.service.ICmsActivityService;
import com.chengyinhub.business.service.ICmsMemberTemplateService;
import com.chengyinhub.business.service.ICmsPointsSettingService;
import com.chengyinhub.business.service.ICmsRegistrationService;
import com.chengyinhub.business.service.ICmsTopicChapterService;
import com.chengyinhub.business.service.ICmsTopicNodeService;
import com.chengyinhub.business.service.ICmsTopicService;
import com.chengyinhub.business.service.IOmsTicketService;
import com.chengyinhub.business.service.IPlayerNodeProgressService;
import com.chengyinhub.business.service.IPuzzlePlayService;
import com.chengyinhub.business.service.ITopicRouteRuntimeService;
import com.chengyinhub.business.service.impl.AdvancedGameRuntimeServiceImpl;
import com.chengyinhub.business.service.impl.NpcProfileService;
import com.chengyinhub.business.service.support.PlayNodeAccessService;
import com.chengyinhub.common.core.domain.AjaxResult;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.math.BigDecimal;
import java.util.Arrays;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * §3.2 Item 3 第 1 站免费试玩契约测试：
 * - PlayEntryApplication / GET /api/play/nodes?trial=true 放行第 1 站完整内容，严格剥离第 2 站+剧情/题面/线索/配置；
 * - PlayNodeAccessService 放行第 1 站写操作并拒绝第 2 站+（402）；
 * - AdvancedGameRuntimeServiceImpl 放行第 1 站高级玩法启动并拒绝第 2 站+与不可见主题；
 * - 购票后同入口平滑退出 trialMode 并保留第 1 站进度（零进度丢失）。
 */
class ApiPlayFirstStationTrialTest {

    private static final Long MEMBER = 71L;
    private static final Long TOPIC = 88L;
    private static final Long CHAPTER_1 = 301L;
    private static final Long CHAPTER_2 = 302L;
    private static final Long STATION_1 = 1001L;
    private static final Long STATION_2 = 1002L;
    private static final Long TPL_1 = 5001L;
    private static final Long TPL_2 = 5002L;

    private ApiPlayProgressController controller;
    private ICmsRegistrationService registrationService;
    private ICmsTopicService topicService;
    private ICmsTopicNodeService nodeService;
    private ICmsTopicChapterService chapterService;
    private IPlayerNodeProgressService progressService;
    private CmsTopic topic;
    private CmsTopicNode node1;
    private CmsTopicNode node2;
    private CmsTopicChapter chapter1;
    private CmsTopicChapter chapter2;

    @BeforeEach
    void setUp() {
        ICmsActivityService activityService = mock(ICmsActivityService.class);
        registrationService = mock(ICmsRegistrationService.class);
        topicService = mock(ICmsTopicService.class);
        nodeService = mock(ICmsTopicNodeService.class);
        chapterService = mock(ICmsTopicChapterService.class);
        progressService = mock(IPlayerNodeProgressService.class);
        ICmsMemberTemplateService templateService = mock(ICmsMemberTemplateService.class);

        controller = spy(new ApiPlayProgressController());
        doReturn(MEMBER).when(controller).getAppUserId();
        PlayNodeAccessTestFixtures.setField(controller, "cmsActivityService", activityService);
        PlayNodeAccessTestFixtures.setField(controller, "cmsRegistrationService", registrationService);
        PlayNodeAccessTestFixtures.setField(controller, "cmsTopicService", topicService);
        PlayNodeAccessTestFixtures.setField(controller, "cmsTopicNodeService", nodeService);
        PlayNodeAccessTestFixtures.setField(controller, "npcProfileService", mock(NpcProfileService.class));
        PlayNodeAccessTestFixtures.setField(controller, "playerNodeProgressService", progressService);
        PlayNodeAccessTestFixtures.setField(controller, "cmsMemberTemplateService", templateService);
        PlayNodeAccessTestFixtures.setField(controller, "nodeMerchantOverrideService",
                new com.chengyinhub.business.service.impl.NodeMerchantOverrideServiceImpl(
                        mock(com.chengyinhub.business.service.ICmsRegistrationMerchantService.class)));
        PlayNodeAccessTestFixtures.setField(controller, "omsTicketService", mock(IOmsTicketService.class));
        PlayNodeAccessTestFixtures.setField(controller, "cmsTopicChapterService", chapterService);
        PlayNodeAccessTestFixtures.setField(controller, "puzzlePlayService", mock(IPuzzlePlayService.class));
        PlayNodeAccessTestFixtures.setField(controller, "topicOnsiteMetricsMapper",
                mock(com.chengyinhub.business.mapper.TopicOnsiteMetricsMapper.class));
        PlayNodeAccessTestFixtures.setField(controller, "topicTemplateMetaMapper",
                mock(com.chengyinhub.business.mapper.CmsTopicTemplateMetaMapper.class));
        PlayNodeAccessTestFixtures.setField(controller, "merchantChapterOfferMapper",
                mock(com.chengyinhub.business.mapper.MerchantChapterOfferMapper.class));
        PlayNodeAccessTestFixtures.setField(controller, "coopPerkMapper",
                mock(com.chengyinhub.business.mapper.CoopPerkMapper.class));
        NodeHintUnlockTestFixtures.pricing(controller, mock(ICmsPointsSettingService.class));

        topic = new CmsTopic();
        topic.setId(TOPIC);
        topic.setName("法租界旧信");
        topic.setProductType(1); // 城市定向
        topic.setSelfPlay(1);
        topic.setSelfPlayPrice(new BigDecimal("39.00"));
        topic.setStatus(1);
        when(topicService.selectCmsTopicById(TOPIC)).thenReturn(topic);
        when(topicService.selectCmsTopicDetailById(TOPIC, MEMBER)).thenReturn(topic);

        chapter1 = new CmsTopicChapter();
        chapter1.setId(CHAPTER_1);
        chapter1.setTopicId(TOPIC);
        chapter1.setName("第一章：启封");
        chapter1.setDescription("第一章公开剧情");
        chapter1.setSortId(1L);

        chapter2 = new CmsTopicChapter();
        chapter2.setId(CHAPTER_2);
        chapter2.setTopicId(TOPIC);
        chapter2.setName("第二章：暗室");
        chapter2.setDescription("第二章机密剧情绝不外泄");
        chapter2.setSortId(2L);
        chapter2.setAudioUrl("https://cdn.example.com/ch2-secret.mp3");
        when(chapterService.selectCmsTopicChapterList(any())).thenReturn(Arrays.asList(chapter1, chapter2));

        node1 = new CmsTopicNode();
        node1.setId(STATION_1);
        node1.setTopicId(TOPIC);
        node1.setChapterId(CHAPTER_1);
        node1.setSortId(1L);
        node1.setStatus(1L);
        node1.setName("梧桐路口邮筒");
        node1.setAddress("武康路 1 号");
        node1.setImgUrl("https://cdn.example.com/s1.jpg");
        node1.setDescription("第一站公开导语");
        node1.setTemplateId(TPL_1);

        node2 = new CmsTopicNode();
        node2.setId(STATION_2);
        node2.setTopicId(TOPIC);
        node2.setChapterId(CHAPTER_2);
        node2.setSortId(2L);
        node2.setStatus(1L);
        node2.setName("旧书店阁楼");
        node2.setAddress("安福路 99 号秘密地址");
        node2.setImgUrl("https://cdn.example.com/s2-secret.jpg");
        node2.setDescription("第二站秘密导语");
        node2.setTemplateId(TPL_2);
        when(nodeService.selectCmsTopicNodeList(any())).thenReturn(Arrays.asList(node1, node2));

        CmsMemberTemplate tpl1 = new CmsMemberTemplate();
        tpl1.setId(TPL_1);
        tpl1.setTitle("第一站谜题");
        tpl1.setValidationMethod(1);
        tpl1.setStoryText("第一站完整故事正文");
        tpl1.setQuestionName("邮筒上的年份是哪一年？");
        tpl1.setHint1("看铸铁底座");
        when(templateService.selectCmsMemberTemplateById(TPL_1)).thenReturn(tpl1);

        CmsMemberTemplate tpl2 = new CmsMemberTemplate();
        tpl2.setId(TPL_2);
        tpl2.setTitle("第二站付费谜题");
        tpl2.setValidationMethod(3);
        tpl2.setStoryText("第二站完整付费剧情不可抓取");
        tpl2.setQuestionName("书架第三层藏着什么暗号？");
        tpl2.setQuestionA("密码甲");
        tpl2.setQuestionB("密码乙");
        tpl2.setHint1("第二站付费提示");
        tpl2.setAdvancedConfigJson("{\"schemaVersion\":1,\"qa\":{\"enabled\":true}}");
        when(templateService.selectCmsMemberTemplateById(TPL_2)).thenReturn(tpl2);

        when(registrationService.selectCmsRegistrationList(any())).thenReturn(Collections.emptyList());
        when(progressService.selectPlayerNodeProgressList(any())).thenReturn(Collections.emptyList());
    }

    @Test
    @SuppressWarnings("unchecked")
    void trialEntryReturnsFullStation1AndStripsStation2PlusContent() throws Exception {
        AjaxResult res = controller.nodes(null, TOPIC, null, null, null, true, null);

        assertEquals(200, res.get(AjaxResult.CODE_TAG));
        Map<String, Object> data = (Map<String, Object>) res.get(AjaxResult.DATA_TAG);
        assertEquals(Boolean.TRUE, data.get("trialMode"));
        assertEquals(STATION_1, data.get("trialStationId"));
        assertEquals(Boolean.FALSE, data.get("registered"));
        assertEquals(new BigDecimal("39.00"), data.get("selfPlayPrice"));

        List<Map<String, Object>> nodes = (List<Map<String, Object>>) data.get("nodes");
        assertEquals(2, nodes.size());

        Map<String, Object> s1 = nodes.get(0);
        assertEquals(STATION_1, s1.get("nodeId"));
        assertEquals(Boolean.TRUE, s1.get("trialStation"));
        assertEquals("第一站完整故事正文", s1.get("storyText"));
        assertEquals("邮筒上的年份是哪一年？", s1.get("question"));
        assertEquals("武康路 1 号", s1.get("address"));
        assertEquals("https://cdn.example.com/s1.jpg", s1.get("imgUrl"));

        Map<String, Object> s2 = nodes.get(1);
        assertEquals(STATION_2, s2.get("nodeId"));
        assertEquals(Boolean.TRUE, s2.get("trialLocked"));
        assertEquals(Boolean.TRUE, s2.get("locked"));
        assertEquals(Boolean.TRUE, s2.get("imgHidden"));
        assertEquals(Boolean.TRUE, s2.get("addressHidden"));
        assertNull(s2.get("storyText"));
        assertNull(s2.get("question"));
        assertNull(s2.get("options"));
        assertNull(s2.get("hint1"));
        assertNull(s2.get("address"));
        assertNull(s2.get("imgUrl"));
        assertNull(s2.get("advancedConfigJson"));

        String json = new ObjectMapper().writeValueAsString(res);
        assertTrue(json.contains("第一站完整故事正文"));
        assertFalse(json.contains("第二站完整付费剧情不可抓取"), "第 2 站剧情不得下发:" + json);
        assertFalse(json.contains("书架第三层藏着什么暗号"), "第 2 站题面不得下发:" + json);
        assertFalse(json.contains("密码甲"), "第 2 站选项不得下发:" + json);
        assertFalse(json.contains("第二站付费提示"), "第 2 站提示不得下发:" + json);
        assertFalse(json.contains("安福路 99 号秘密地址"), "第 2 站地址不得下发:" + json);
        assertFalse(json.contains("s2-secret.jpg"), "第 2 站图片不得下发:" + json);
        assertFalse(json.contains("第二章机密剧情绝不外泄"), "第 2 章正文不得下发:" + json);
        assertFalse(json.contains("ch2-secret.mp3"), "第 2 章音频不得下发:" + json);
    }

    @Test
    void nonTrialUnticketedRequestStillReturns402() {
        AjaxResult res = controller.nodes(null, TOPIC);
        assertEquals(402, res.get(AjaxResult.CODE_TAG));
        assertEquals("请先购买自玩通行证", res.get(AjaxResult.MSG_TAG));
        verify(nodeService, never()).selectCmsTopicNodeList(any());
    }

    @Test
    void invisibleTopicCannotBeEnteredInTrialMode() {
        when(topicService.selectCmsTopicDetailById(TOPIC, MEMBER)).thenReturn(null);

        AjaxResult res = controller.nodes(null, TOPIC, null, null, null, true, null);
        assertEquals(500, res.get(AjaxResult.CODE_TAG));
        assertEquals("活动或主题不存在", res.get(AjaxResult.MSG_TAG));
        verify(nodeService, never()).selectCmsTopicNodeList(any());
    }

    @Test
    void freeCollectAndNonSelfPlayTopicsRejectTrialEntry() {
        topic.setProductType(2); // 自由探索不允许免票试玩
        AjaxResult exploreRes = controller.nodes(null, TOPIC, null, null, null, true, null);
        assertEquals(402, exploreRes.get(AjaxResult.CODE_TAG));

        topic.setProductType(1);
        topic.setSelfPlay(0); // 非自玩主题不允许试玩
        AjaxResult nonSelfPlayRes = controller.nodes(null, TOPIC, null, null, null, true, null);
        assertEquals(402, nonSelfPlayRes.get(AjaxResult.CODE_TAG));
    }

    @Test
    @SuppressWarnings("unchecked")
    void afterPurchaseSameEntryUpgradesOutOfTrialModeAndPreservesStation1Progress() {
        CmsRegistration pass = new CmsRegistration();
        pass.setId(901L);
        pass.setMemberId(MEMBER);
        pass.setOwnerType(1L);
        pass.setOwnerId(TOPIC);
        pass.setRegistrationStatus(2);
        pass.setExpiresAt(new Date(System.currentTimeMillis() + 86400000L));
        when(registrationService.selectCmsRegistrationList(any())).thenReturn(Collections.singletonList(pass));

        PlayerNodeProgress doneStation1 = new PlayerNodeProgress();
        doneStation1.setMemberId(MEMBER);
        doneStation1.setActivityId(0L);
        doneStation1.setTopicId(TOPIC);
        doneStation1.setNodeId(STATION_1);
        doneStation1.setStatus(1);
        when(progressService.selectPlayerNodeProgressList(any())).thenReturn(Collections.singletonList(doneStation1));

        AjaxResult res = controller.nodes(null, TOPIC, null, null, null, true, null);
        assertEquals(200, res.get(AjaxResult.CODE_TAG));
        Map<String, Object> data = (Map<String, Object>) res.get(AjaxResult.DATA_TAG);
        assertFalse(data.containsKey("trialMode"), "持有效通行证后自动退出试玩态");
        assertEquals(Boolean.TRUE, data.get("registered"));
        assertEquals(1, ((Number) data.get("doneCount")).intValue());
        List<Map<String, Object>> nodes = (List<Map<String, Object>>) data.get("nodes");
        assertEquals(Boolean.TRUE, nodes.get(0).get("done"));
        assertEquals("第二站完整付费剧情不可抓取", nodes.get(1).get("storyText"));
    }

    @Test
    void playNodeAccessServicePermitsStation1TrialWriteAndBlocksStation2() {
        CmsRegistrationMapper regMapper = mock(CmsRegistrationMapper.class);
        when(regMapper.selectCmsRegistrationList(any())).thenReturn(Collections.emptyList());
        ITopicRouteRuntimeService routes = mock(ITopicRouteRuntimeService.class);
        when(routes.hasRunningSession(MEMBER, TOPIC, 0L)).thenReturn(false);

        PlayNodeAccessService access = new PlayNodeAccessService(
                mock(ICmsActivityService.class), mock(CmsActivityMapper.class), regMapper,
                nodeService, progressService, topicService, mock(IOmsTicketService.class),
                null, null, chapterService, routes);

        PlayNodeAccessService.NodeScope scope1 = new PlayNodeAccessService.NodeScope(
                STATION_1, TOPIC, CHAPTER_1, 1L, 1L, null);
        PlayNodeAccessService.Context ctx1 = access.resolveContext(MEMBER, null, String.valueOf(TOPIC), scope1);
        assertNull(ctx1.failure(), "第 1 站试玩写入口应放行");
        assertTrue(ctx1.trialMode());
        assertTrue(ctx1.selfPlay());
        assertNull(ctx1.registrationId());
        assertNull(access.routeAccessError(MEMBER, 0L, TOPIC, scope1, "act-1"), "第 1 站试玩路线闸应放行");

        PlayNodeAccessService.NodeScope scope2 = new PlayNodeAccessService.NodeScope(
                STATION_2, TOPIC, CHAPTER_2, 2L, 1L, null);
        PlayNodeAccessService.Context ctx2 = access.resolveContext(MEMBER, null, String.valueOf(TOPIC), scope2);
        assertNotNull(ctx2.failure(), "第 2 站未购票必须拒绝");
        assertEquals(402, ctx2.failure().originalAjaxCode());
        assertFalse(ctx2.trialMode());

        // 显式指定无效票据 ID 不得绕过降级到试玩态
        PlayNodeAccessService.Context explicitTicketDenied = access.resolveContext(
                MEMBER, null, String.valueOf(TOPIC), scope1, 999L);
        assertNotNull(explicitTicketDenied.failure());
        assertEquals(402, explicitTicketDenied.failure().originalAjaxCode());
    }

    @Test
    void advancedGameRuntimePermitsStation1TrialStartAndRejectsStation2() {
        AdvancedGameRuntimeServiceImpl runtime = new AdvancedGameRuntimeServiceImpl();
        CmsTopicNodeMapper nodeMapper = mock(CmsTopicNodeMapper.class);
        CmsMemberTemplateMapper tplMapper = mock(CmsMemberTemplateMapper.class);
        CmsRegistrationMapper regMapper = mock(CmsRegistrationMapper.class);
        CmsTopicMapper topicMapper = mock(CmsTopicMapper.class);
        CmsTopicChapterMapper chapterMapper = mock(CmsTopicChapterMapper.class);
        GameRuntimeSessionMapper sessionMapper = mock(GameRuntimeSessionMapper.class);

        ReflectionTestUtils.setField(runtime, "nodeMapper", nodeMapper);
        ReflectionTestUtils.setField(runtime, "templateMapper", tplMapper);
        ReflectionTestUtils.setField(runtime, "registrationMapper", regMapper);
        ReflectionTestUtils.setField(runtime, "activityMapper", mock(CmsActivityMapper.class));
        ReflectionTestUtils.setField(runtime, "teamMapper", mock(PlayTeamMapper.class));
        ReflectionTestUtils.setField(runtime, "sessionMapper", sessionMapper);
        ReflectionTestUtils.setField(runtime, "cmsTopicMapper", topicMapper);
        ReflectionTestUtils.setField(runtime, "cmsTopicChapterMapper", chapterMapper);

        when(topicMapper.selectCmsTopicDetailById(TOPIC, MEMBER)).thenReturn(topic);
        when(chapterMapper.selectCmsTopicChapterList(any())).thenReturn(Arrays.asList(chapter1, chapter2));
        when(nodeMapper.selectCmsTopicNodeById(STATION_1)).thenReturn(node1);
        when(nodeMapper.selectCmsTopicNodeById(STATION_2)).thenReturn(node2);
        when(nodeMapper.selectCmsTopicNodeList(any())).thenReturn(Arrays.asList(node1, node2));
        when(regMapper.selectCmsRegistrationList(any())).thenReturn(Collections.emptyList());

        CmsMemberTemplate advTpl = new CmsMemberTemplate();
        advTpl.setId(TPL_1);
        advTpl.setAdvancedConfigJson("{\"schemaVersion\":1,\"hangman\":{\"enabled\":true,\"answer\":\"ABC\"}}");
        when(tplMapper.selectCmsMemberTemplateById(TPL_1)).thenReturn(advTpl);
        when(tplMapper.selectCmsMemberTemplateById(TPL_2)).thenReturn(advTpl);
        when(sessionMapper.insert(any(GameRuntimeSession.class))).thenAnswer(inv -> {
            GameRuntimeSession s = inv.getArgument(0);
            s.setId(777L);
            return 1;
        });

        Map<String, Object> started = runtime.start(MEMBER, 0L, TOPIC, STATION_1, null);
        assertEquals(777L, started.get("sessionId"));

        // 第 2 站未购票必须拒绝
        IllegalStateException s2Err = assertThrows(IllegalStateException.class,
                () -> runtime.start(MEMBER, 0L, TOPIC, STATION_2, null));
        assertTrue(s2Err.getMessage().contains("通行证"));

        // 不可见主题即使第 1 站也必须拒绝（fail-closed）
        when(topicMapper.selectCmsTopicDetailById(TOPIC, MEMBER)).thenReturn(null);
        assertThrows(IllegalStateException.class,
                () -> runtime.start(MEMBER, 0L, TOPIC, STATION_1, null));
    }
}
