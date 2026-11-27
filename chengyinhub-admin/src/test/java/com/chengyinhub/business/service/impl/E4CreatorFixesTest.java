package com.chengyinhub.business.service.impl;

import com.chengyinhub.business.access.merchant.IMerchantAccessService;
import com.chengyinhub.business.access.merchant.MerchantAccessContext;
import com.chengyinhub.business.access.merchant.MerchantPermission;
import com.chengyinhub.business.domain.CmsTopic;
import com.chengyinhub.business.domain.CmsTopicNode;
import com.chengyinhub.business.domain.dto.TopicUpdateDTO;
import com.chengyinhub.business.mapper.CmsTopicMapper;
import com.chengyinhub.business.mapper.CmsTopicNodeMapper;
import com.chengyinhub.business.service.ICmsTopicNodeService;
import com.chengyinhub.business.service.ICmsTopicService;
import com.chengyinhub.business.service.support.AppMediaPublicationGuard;
import com.chengyinhub.business.service.support.FreeExploreVisitConfigRules;
import com.chengyinhub.common.core.domain.AjaxResult;
import com.chengyinhub.web.controller.api.ApiTopicController;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.Collections;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class E4CreatorFixesTest {

    private static void setField(Object target, String name, Object value) throws Exception {
        Class<?> c = target.getClass();
        while (c != null) {
            try {
                Field f = c.getDeclaredField(name);
                f.setAccessible(true);
                f.set(target, value);
                return;
            } catch (NoSuchFieldException ignored) {
                c = c.getSuperclass();
            }
        }
        throw new NoSuchFieldException(name);
    }

    @Test
    void whitelistEditPersistsNormalizedLookJson() throws Exception {
        CmsTopicServiceImpl service = new CmsTopicServiceImpl();
        CmsTopicMapper mapper = mock(CmsTopicMapper.class);
        AppMediaPublicationGuard mediaGuard = mock(AppMediaPublicationGuard.class);
        setField(service, "cmsTopicMapper", mapper);
        setField(service, "mediaPublicationGuard", mediaGuard);

        CmsTopic exist = new CmsTopic();
        exist.setId(88L);
        exist.setMemberId(7L);

        TopicUpdateDTO dto = new TopicUpdateDTO();
        dto.setName("末日寒冬 · 零下72小时");
        dto.setLook("{\"style\":\"STARDUST\",\"palette\":\"WHITE\",\"map\":\"white\",\"storyFont\":\"HEI\"}");

        Method m = CmsTopicServiceImpl.class.getDeclaredMethod("applyWhitelistEdit", CmsTopic.class, TopicUpdateDTO.class, String.class);
        m.setAccessible(true);
        m.invoke(service, exist, dto, "tester");

        ArgumentCaptor<CmsTopic> captor = ArgumentCaptor.forClass(CmsTopic.class);
        verify(mapper).updateCmsTopic(captor.capture());
        String savedLook = captor.getValue().getLookJson();
        assertNotNull(savedLook);
        assertTrue(savedLook.contains("\"style\":\"STARDUST\""), savedLook);
        assertTrue(savedLook.contains("\"palette\":\"WHITE\""), savedLook);
    }

    @Test
    void merchantStaffWithProjectManageResolvesOwnerForFreeExploreVisitConfig() throws Exception {
        ApiTopicController controller = new ApiTopicController();
        ICmsTopicService topicService = mock(ICmsTopicService.class);
        ICmsTopicNodeService nodeService = mock(ICmsTopicNodeService.class);
        CmsTopicNodeMapper nodeMapper = mock(CmsTopicNodeMapper.class);
        IMerchantAccessService merchantAccessService = mock(IMerchantAccessService.class);

        setField(controller, "cmsTopicService", topicService);
        setField(controller, "cmsTopicNodeService", nodeService);
        setField(controller, "visitConfigNodeMapper", nodeMapper);
        setField(controller, "merchantAccessService", merchantAccessService);

        CmsTopic topic = new CmsTopic();
        topic.setId(50L);
        topic.setMemberId(101L);
        topic.setProductType(2);
        when(topicService.selectCmsTopicById(50L)).thenReturn(topic);

        CmsTopicNode node = new CmsTopicNode();
        node.setId(500L);
        node.setTopicId(50L);
        node.setName("站点A");
        node.setLatitude("31.23");
        node.setLongitude("121.47");
        when(nodeService.selectCmsTopicNodeById(500L)).thenReturn(node);
        when(nodeService.selectCmsTopicNodeList(any())).thenReturn(Collections.singletonList(node));
        when(nodeMapper.selectVisitConfigByTopicId(50L)).thenReturn(Collections.emptyList());
        when(nodeMapper.updateVisitConfig(500L, 1, null)).thenReturn(1);

        MerchantAccessContext staffCtx = mock(MerchantAccessContext.class);
        when(staffCtx.hasPermission(MerchantPermission.PROJECT_MANAGE)).thenReturn(true);
        when(staffCtx.getOwnerMemberId()).thenReturn(101L);
        when(merchantAccessService.resolve(202L)).thenReturn(staffCtx);

        Method resolve = ApiTopicController.class.getDeclaredMethod(
                "resolveVisitConfigActorId", Long.class, Long.class, Long.class, String.class);
        resolve.setAccessible(true);

        Long resolvedForList = (Long) resolve.invoke(controller, 202L, 50L, null, null);
        assertEquals(101L, resolvedForList);

        Long resolvedForUpdate = (Long) resolve.invoke(controller, 202L, null, 500L, null);
        assertEquals(101L, resolvedForUpdate);

        FreeExploreVisitConfigRules rules = new FreeExploreVisitConfigRules(topicService, nodeService, nodeMapper);
        AjaxResult listRes = rules.list(resolvedForList, 50L);
        assertEquals(200, listRes.get("code"));
        AjaxResult updRes = rules.update(resolvedForUpdate, 500L, "SCAN", null);
        assertEquals(200, updRes.get("code"));
        verify(nodeMapper).updateVisitConfig(500L, 1, null);

        // Unauthorized staff (missing PROJECT_MANAGE) stays as principal 202L -> 403
        when(staffCtx.hasPermission(MerchantPermission.PROJECT_MANAGE)).thenReturn(false);
        Long deniedActor = (Long) resolve.invoke(controller, 202L, null, 500L, null);
        assertEquals(202L, deniedActor);
        assertEquals(403, rules.update(deniedActor, 500L, "SCAN", null).get("code"));
    }
}
