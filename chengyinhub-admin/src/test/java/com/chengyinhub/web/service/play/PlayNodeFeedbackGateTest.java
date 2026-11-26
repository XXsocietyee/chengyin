package com.chengyinhub.web.service.play;

import com.chengyinhub.business.domain.CmsMemberTemplate;
import com.chengyinhub.business.domain.CmsTopicNode;
import com.chengyinhub.business.domain.vo.NodeMerchantOverride;
import com.chengyinhub.business.service.ICmsMemberTemplateService;
import com.chengyinhub.business.service.INodeMerchantOverrideService;
import com.chengyinhub.common.constant.PlayMode;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** 文字反馈只跟着完成事实走。解题前不下发，解出后仍下发。 */
class PlayNodeFeedbackGateTest {

    @Test
    void feedbackTextFollowsCompletionFact() {
        Map<String, Object> unsolved = project(List.of());
        assertFalse(unsolved.containsKey("feedbackText"));

        Map<String, Object> solved = project(List.of(11L));
        assertEquals("恭喜你解开了", solved.get("feedbackText"));
    }

    private Map<String, Object> project(List<Long> doneNodeIds) {
        PlayNodeQueryApplication query = new PlayNodeQueryApplication();
        INodeMerchantOverrideService overrides = mock(INodeMerchantOverrideService.class);
        when(overrides.forNode(11L)).thenReturn(NodeMerchantOverride.empty());
        ICmsMemberTemplateService templates = mock(ICmsMemberTemplateService.class);
        CmsMemberTemplate template = new CmsMemberTemplate();
        template.setFeedbackText("恭喜你解开了");
        when(templates.selectCmsMemberTemplateById(9L)).thenReturn(template);
        ReflectionTestUtils.setField(query, "nodeMerchantOverrideService", overrides);
        ReflectionTestUtils.setField(query, "cmsMemberTemplateService", templates);
        ReflectionTestUtils.setField(query, "playNodeContext", new PlayNodeContext());
        CmsTopicNode node = new CmsTopicNode();
        node.setId(11L);
        node.setTopicId(21L);
        node.setName("终点");
        node.setTemplateId(9L);
        node.setStatus(1L);
        PlayNodeQueryApplication.NodeProjection read = new PlayNodeQueryApplication.NodeProjection(
                7L, true, 21L, 0L, null, true, false, null, List.of(node), doneNodeIds,
                Map.of(), Map.of(), new HashSet<>(), 10, new HashSet<>(), new ArrayList<>(), null,
                PlayMode.LINEAR_ORIENTEERING, null, false, null);
        read.playableNodeIds = new HashSet<>();
        read.puzzleHintLevelByNode = Map.of();
        read.nodeNpcCache = new java.util.HashMap<>();
        read.nodeNpcCache.put(11L, null);
        read.merchantClosedCache = new java.util.HashMap<>();
        read.merchantClosedCache.put(null, false);
        read.entitlementByChapter = new java.util.HashMap<>();
        read.perkByChapterMerchant = new java.util.HashMap<>();
        read.inStoreLoadByChapter = new java.util.HashMap<>();
        read.capacityByChapter = new java.util.HashMap<>();
        read.nodeXpCache = new java.util.HashMap<>();
        read.visitConfigByNode = new java.util.HashMap<>();
        read.visitedChapterIds = new HashSet<>();
        read.placeChapterIds = new HashSet<>();
        read.teamVisitedChapterIds = new HashSet<>();
        return query.projectNodeBeforeRuntime(read, node).view();
    }
}
