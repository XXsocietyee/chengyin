package com.chengyinhub.web.service.play;

import com.chengyinhub.business.domain.CmsRegistration;
import com.chengyinhub.business.domain.PlayerNodeProgress;
import com.chengyinhub.business.service.ICmsTopicNodeService;
import com.chengyinhub.business.service.IPlayerNodeProgressService;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** 自玩进度探针必须带上当前主题，避免把别的主题进度混进这一局。 */
class PlayEntrySelfPlayProbeTest {

    @Test
    void selfPlayProgressProbeCarriesTopicId() {
        PlayEntryApplication app = new PlayEntryApplication();
        PlayCompletionFacts facts = mock(PlayCompletionFacts.class);
        when(facts.validSelfPlayPass(7L, 21L)).thenReturn(new CmsRegistration());
        ICmsTopicNodeService nodes = mock(ICmsTopicNodeService.class);
        when(nodes.selectCmsTopicNodeList(any())).thenReturn(List.of());
        IPlayerNodeProgressService progress = mock(IPlayerNodeProgressService.class);
        AtomicReference<PlayerNodeProgress> captured = new AtomicReference<>();
        when(progress.selectPlayerNodeProgressList(any())).thenAnswer(invocation -> {
            captured.set(invocation.getArgument(0));
            return List.of();
        });
        ReflectionTestUtils.setField(app, "playCompletionFacts", facts);
        ReflectionTestUtils.setField(app, "cmsTopicNodeService", nodes);
        ReflectionTestUtils.setField(app, "playerNodeProgressService", progress);
        try {
            app.nodes(7L, null, 21L);
        } catch (RuntimeException ignored) {
            // 探针之后的拼图计分不在这次改动里。
        }
        PlayerNodeProgress probe = captured.get();
        assertNotNull(probe);
        assertEquals(7L, probe.getMemberId());
        assertEquals(0L, probe.getActivityId());
        assertEquals(21L, probe.getTopicId());
    }
}
