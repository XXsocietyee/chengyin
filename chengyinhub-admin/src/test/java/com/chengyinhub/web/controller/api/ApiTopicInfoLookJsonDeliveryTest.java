package com.chengyinhub.web.controller.api;

import com.chengyinhub.business.domain.CmsTopic;
import com.chengyinhub.business.domain.vo.TopicInfoVO;
import com.chengyinhub.business.mapper.CmsTopicMapper;
import com.chengyinhub.business.service.ICmsTopicChapterService;
import com.chengyinhub.business.service.ICmsTopicNodeService;
import com.chengyinhub.business.service.ICmsTopicService;
import com.chengyinhub.business.service.IOmsTicketService;
import com.chengyinhub.business.service.IUmsMemberService;
import com.chengyinhub.business.service.IViewCollaboratorsService;
import com.chengyinhub.common.core.domain.AjaxResult;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 主题详情(info-to-user)下发主题外观 lookJson:路线地图据此取底图与配色。
 *
 * <p>look_json 不在通用列清单里,由 selectLookJsonById 单独读、原样字符串下发;
 * 未配置 = null;调用者看不到的主题(详情查询返回 null)不读外观。
 */
class ApiTopicInfoLookJsonDeliveryTest {

    private static final long VIEWER = 901L;
    private static final long TOPIC_ID = 7001L;
    private static final String LOOK = "{\"style\":\"PAPER\",\"transition\":\"fade\"}";

    private CmsTopic topic() {
        CmsTopic topic = new CmsTopic();
        topic.setId(TOPIC_ID);
        topic.setMemberId(VIEWER);
        topic.setDelFlag(0);
        topic.setStatus(0);
        topic.setUserStatus(0);
        topic.setProductType(1);
        topic.setPublishMode("pro");
        topic.setLifecycle(0);
        topic.setName("测试主题");
        return topic;
    }

    /** 存了外观:原样字符串下发,序列化后的响应里带 lookJson 键。 */
    @Test
    void topicInfo_deliversStoredLookJsonUnchanged() throws Exception {
        CmsTopicMapper mapper = mock(CmsTopicMapper.class);
        when(mapper.selectLookJsonById(TOPIC_ID)).thenReturn(LOOK);

        AjaxResult result = topicInfo(topic(), mapper);

        assertEquals(200, result.get(AjaxResult.CODE_TAG), result.toString());
        TopicInfoVO data = (TopicInfoVO) result.get("data");
        assertEquals(LOOK, data.getLookJson());
        assertEquals("测试主题", data.getName(), "已有字段不能被挤掉");
        JsonNode json = new ObjectMapper().valueToTree(data);
        assertTrue(json.has("lookJson"));
        assertEquals(LOOK, json.get("lookJson").asText());
    }

    /** 没存外观 = null,客户端按黑底兜底。 */
    @Test
    void topicInfo_withoutStoredLook_deliversNull() {
        CmsTopicMapper mapper = mock(CmsTopicMapper.class);
        when(mapper.selectLookJsonById(TOPIC_ID)).thenReturn(null);

        AjaxResult result = topicInfo(topic(), mapper);

        assertEquals(200, result.get(AjaxResult.CODE_TAG), result.toString());
        assertNull(((TopicInfoVO) result.get("data")).getLookJson());
    }

    /** 可见性闸没放行(详情查询返回 null):404,且不去读外观。 */
    @Test
    void topicInfo_invisibleTopic_neverReadsLook() {
        CmsTopicMapper mapper = mock(CmsTopicMapper.class);

        AjaxResult result = topicInfo(null, mapper);

        assertEquals(404, result.get(AjaxResult.CODE_TAG), result.toString());
        verify(mapper, never()).selectLookJsonById(anyLong());
    }

    /** topicInfo 的最小依赖集:空章节/无票/无报名,足够走到组装 TopicInfoVO 并返回。 */
    private AjaxResult topicInfo(CmsTopic topic, CmsTopicMapper mapper) {
        ICmsTopicService topicService = mock(ICmsTopicService.class);
        when(topicService.selectCmsTopicDetailById(TOPIC_ID, VIEWER)).thenReturn(topic);
        ApiTopicController controller = spy(new ApiTopicController());
        ReflectionTestUtils.setField(controller, "merchantBusinessStatusService",
                mock(com.chengyinhub.business.service.IMerchantBusinessStatusService.class));
        doReturn(VIEWER).when(controller).getAppUserId();
        ReflectionTestUtils.setField(controller, "cmsTopicService", topicService);
        ReflectionTestUtils.setField(controller, "cmsTopicMapper", mapper);
        ICmsTopicChapterService chapterService = mock(ICmsTopicChapterService.class);
        when(chapterService.selectCmsTopicChapterList(any())).thenReturn(Collections.emptyList());
        ReflectionTestUtils.setField(controller, "cmsTopicChapterService", chapterService);
        ReflectionTestUtils.setField(controller, "cmsTopicNodeService", mock(ICmsTopicNodeService.class));
        IOmsTicketService ticketService = mock(IOmsTicketService.class);
        when(ticketService.selectOmsTicketList(any())).thenReturn(Collections.emptyList());
        ReflectionTestUtils.setField(controller, "omsTicketService", ticketService);
        ReflectionTestUtils.setField(controller, "viewCollaboratorsService", mock(IViewCollaboratorsService.class));
        ReflectionTestUtils.setField(controller, "umsMemberService", mock(IUmsMemberService.class));
        ReflectionTestUtils.setField(controller, "cmsRegistrationMerchantService",
                mock(com.chengyinhub.business.service.ICmsRegistrationMerchantService.class));
        ReflectionTestUtils.setField(controller, "umsCommentService",
                mock(com.chengyinhub.business.service.IUmsCommentService.class));
        ReflectionTestUtils.setField(controller, "commentService",
                mock(com.chengyinhub.business.service.IViewCommentService.class));
        ReflectionTestUtils.setField(controller, "viewRegistrationService",
                mock(com.chengyinhub.business.service.IViewRegistrationService.class));
        ReflectionTestUtils.setField(controller, "cmsActivityService",
                mock(com.chengyinhub.business.service.ICmsActivityService.class));
        ReflectionTestUtils.setField(controller, "cmsRegistrationMapper",
                mock(com.chengyinhub.business.mapper.CmsRegistrationMapper.class));
        ReflectionTestUtils.setField(controller, "playerNodeProgressService",
                mock(com.chengyinhub.business.service.IPlayerNodeProgressService.class));

        return controller.topicInfo(String.valueOf(TOPIC_ID));
    }
}
