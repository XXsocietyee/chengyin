package com.chengyinhub.web.controller.api;

import com.chengyinhub.business.domain.CmsMemberTemplate;
import com.chengyinhub.business.domain.CmsTopicNode;
import com.chengyinhub.business.domain.PlayTeam;
import com.chengyinhub.business.domain.PlayTeamMember;
import com.chengyinhub.business.domain.SeatRecipientFact;
import com.chengyinhub.business.domain.TopicRouteSession;
import com.chengyinhub.business.mapper.PlayTeamMapper;
import com.chengyinhub.business.mapper.TopicRouteSessionMapper;
import com.chengyinhub.business.service.ICmsMemberTemplateService;
import com.chengyinhub.business.service.ICmsTopicNodeService;
import com.chengyinhub.business.service.IPlayerNodeProgressService;
import com.chengyinhub.business.service.IRegistrationSeatRecipientEligibility;
import com.chengyinhub.business.service.IShopDayProofService;
import com.chengyinhub.business.service.impl.NpcProfileService;
import com.chengyinhub.business.service.impl.PlayEncounterServiceImpl;
import com.chengyinhub.common.core.domain.AjaxResult;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.when;

/**
 * §3.2 Item 4 自玩双人不对称角色视角（无需重型建队）契约测试：
 * - 自玩局（activityId=0）放开 ownerType=1 队伍真分角（A 只看 A，B 只看 B，下发真实 otherRoleLabel）；
 * - 轻量 roleHint=A/B 无需建队即可按角色下发不对称视图；
 * - 逃生舱 roleHint=SOLO 在任意分角态下返回全量视图，永不软锁；
 * - 自玩多人/双人票受让人席位（seatNo=2）自动分配 B 视角。
 */
class ApiPlaySelfPlayDuoRoleViewTest {

    private static final Long MEMBER = 71L;
    private static final Long PARTNER = 72L;
    private static final Long TOPIC = 81L;
    private static final Long NODE = 102L;
    private static final Long TEMPLATE = 502L;
    private static final Long RUN = 9002L;
    private static final Long TEAM = 661L;

    private static final String CONFIG = "{\"schemaVersion\":1,\"roleViews\":{"
            + "\"enabled\":true,"
            + "\"roles\":[{\"id\":\"A\",\"label\":\"看实物\"},{\"id\":\"B\",\"label\":\"查档案\"}],"
            + "\"views\":["
            + "{\"roleId\":\"A\",\"title\":\"A 的实物清单\",\"body\":\"先看实物\","
            + "\"items\":[{\"label\":\"铜牌\",\"text\":\"边缘磨亮了\"}]},"
            + "{\"roleId\":\"B\",\"title\":\"B 的档案摘录\",\"body\":\"再查档案\","
            + "\"items\":[{\"label\":\"旧账\",\"text\":\"第三页缺角\"}]}]}}";

    private ApiPlayEncounterController controller;
    private PlayTeamMapper teamMapper;
    private IRegistrationSeatRecipientEligibility seatEligibility;

    @BeforeEach
    void setUp() {
        ICmsTopicNodeService nodeService = mock(ICmsTopicNodeService.class);
        ICmsMemberTemplateService templateService = mock(ICmsMemberTemplateService.class);
        TopicRouteSessionMapper routeSessionMapper = mock(TopicRouteSessionMapper.class);
        IShopDayProofService shopDayProofService = mock(IShopDayProofService.class);
        IPlayerNodeProgressService progressService = mock(IPlayerNodeProgressService.class);
        teamMapper = mock(PlayTeamMapper.class);
        seatEligibility = mock(IRegistrationSeatRecipientEligibility.class);

        PlayEncounterServiceImpl service = new PlayEncounterServiceImpl();
        ReflectionTestUtils.setField(service, "cmsTopicNodeService", nodeService);
        ReflectionTestUtils.setField(service, "cmsMemberTemplateService", templateService);
        ReflectionTestUtils.setField(service, "topicRouteSessionMapper", routeSessionMapper);
        ReflectionTestUtils.setField(service, "shopDayProofService", shopDayProofService);
        ReflectionTestUtils.setField(service, "npcProfileService", mock(NpcProfileService.class));
        ReflectionTestUtils.setField(service, "playerNodeProgressService", progressService);
        ReflectionTestUtils.setField(service, "playTeamMapper", teamMapper);
        ReflectionTestUtils.setField(service, "seatRecipientEligibility", seatEligibility);

        controller = spy(new ApiPlayEncounterController());
        doReturn(MEMBER).when(controller).getAppUserId();
        ReflectionTestUtils.setField(controller, "playEncounterService", service);

        CmsTopicNode node = new CmsTopicNode();
        node.setId(NODE);
        node.setTopicId(TOPIC);
        node.setName("码头仓房");
        node.setTemplateId(TEMPLATE);
        when(nodeService.selectCmsTopicNodeById(NODE)).thenReturn(node);

        CmsMemberTemplate template = new CmsMemberTemplate();
        template.setId(TEMPLATE);
        template.setTitle("对不上的两本账");
        template.setAdvancedConfigJson(CONFIG);
        when(templateService.selectCmsMemberTemplateById(TEMPLATE)).thenReturn(template);

        TopicRouteSession session = new TopicRouteSession();
        session.setId(RUN);
        session.setMemberId(MEMBER);
        session.setTopicId(TOPIC);
        session.setActivityId(0L);
        session.setVersion(1);
        session.setStateJson("{\"status\":\"ACTIVE\",\"variables\":{},\"tags\":[],\"completedNodeIds\":[]}");
        when(routeSessionMapper.selectMemberTopicSessions(MEMBER, TOPIC)).thenReturn(Collections.singletonList(session));
        when(routeSessionMapper.selectCurrentByOwner(0L, TOPIC, MEMBER)).thenReturn(session);
        when(shopDayProofService.hasArrived(any(), any(), any())).thenReturn(false);
        when(progressService.selectPlayerNodeProgressList(any())).thenReturn(Collections.emptyList());
        when(teamMapper.selectMyTeams(MEMBER)).thenReturn(Collections.emptyList());
        when(seatEligibility.playFacts(MEMBER, 1L, TOPIC)).thenReturn(Collections.emptyList());
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> roleView(AjaxResult response) {
        assertEquals(200, response.get("code"));
        Map<String, Object> data = (Map<String, Object>) response.get("data");
        return (Map<String, Object>) data.get("roleView");
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> views(Map<String, Object> roleView) {
        return (List<Map<String, Object>>) roleView.get("views");
    }

    private PlayTeamMember member(Long memberId) {
        PlayTeamMember m = new PlayTeamMember();
        m.setTeamId(TEAM);
        m.setMemberId(memberId);
        m.setStatus(PlayTeamMember.STATUS_JOINED);
        return m;
    }

    private void givenSelfPlayTeam(PlayTeamMember... members) {
        PlayTeam team = new PlayTeam();
        team.setId(TEAM);
        team.setOwnerType(1); // 自玩主题队伍
        team.setOwnerId(TOPIC);
        team.setStatus(PlayTeam.STATUS_STARTED);
        when(teamMapper.selectMyTeams(MEMBER)).thenReturn(Collections.singletonList(team));
        when(teamMapper.selectActiveMembers(TEAM)).thenReturn(Arrays.asList(members));
    }

    @Test
    void selfPlayOwnerType1DuoTeamSplitsAAndBWithoutLeakingOtherHalf() throws Exception {
        givenSelfPlayTeam(member(MEMBER), member(PARTNER));
        AjaxResult resA = controller.encounter(TOPIC, 0L, NODE, null);
        Map<String, Object> rvA = roleView(resA);
        assertEquals("A", rvA.get("role"));
        assertEquals("看实物", rvA.get("roleLabel"));
        assertEquals("查档案", rvA.get("otherRoleLabel"));
        assertEquals(1, views(rvA).size());
        String jsonA = new ObjectMapper().writeValueAsString(resA);
        assertTrue(jsonA.contains("A 的实物清单"));
        assertFalse(jsonA.contains("B 的档案摘录"), "自玩双人队 A 不得泄漏 B 视图:" + jsonA);

        givenSelfPlayTeam(member(PARTNER), member(MEMBER));
        AjaxResult resB = controller.encounter(TOPIC, 0L, NODE, null);
        Map<String, Object> rvB = roleView(resB);
        assertEquals("B", rvB.get("role"));
        assertEquals("查档案", rvB.get("roleLabel"));
        assertEquals("看实物", rvB.get("otherRoleLabel"));
        assertEquals(1, views(rvB).size());
        String jsonB = new ObjectMapper().writeValueAsString(resB);
        assertTrue(jsonB.contains("B 的档案摘录"));
        assertFalse(jsonB.contains("A 的实物清单"), "自玩双人队 B 不得泄漏 A 视图:" + jsonB);
    }

    @Test
    void selfPlayLightweightRoleHintSplitsWithoutHeavyTeamCreation() throws Exception {
        AjaxResult resA = controller.encounter(TOPIC, 0L, NODE, "A");
        Map<String, Object> rvA = roleView(resA);
        assertEquals("A", rvA.get("role"));
        assertEquals("看实物", rvA.get("roleLabel"));
        assertEquals("查档案", rvA.get("otherRoleLabel"));
        assertEquals(1, views(rvA).size());
        String jsonA = new ObjectMapper().writeValueAsString(resA);
        assertTrue(jsonA.contains("A 的实物清单"));
        assertFalse(jsonA.contains("B 的档案摘录"));

        AjaxResult resB = controller.encounter(TOPIC, 0L, NODE, "b");
        Map<String, Object> rvB = roleView(resB);
        assertEquals("B", rvB.get("role"));
        assertEquals("查档案", rvB.get("roleLabel"));
        assertEquals("看实物", rvB.get("otherRoleLabel"));
        assertEquals(1, views(rvB).size());
        String jsonB = new ObjectMapper().writeValueAsString(resB);
        assertTrue(jsonB.contains("B 的档案摘录"));
        assertFalse(jsonB.contains("A 的实物清单"));
    }

    @Test
    void selfPlaySoloEscapeHatchAlwaysReturnsFullClues() throws Exception {
        givenSelfPlayTeam(member(MEMBER), member(PARTNER));
        AjaxResult escaped = controller.encounter(TOPIC, 0L, NODE, "SOLO");
        Map<String, Object> rv = roleView(escaped);
        assertEquals("SOLO", rv.get("role"));
        assertEquals(2, views(rv).size());
        String json = new ObjectMapper().writeValueAsString(escaped);
        assertTrue(json.contains("A 的实物清单") && json.contains("B 的档案摘录"));
    }

    @Test
    void selfPlayDuoSeatRecipientAutomaticallyGetsRoleB() throws Exception {
        SeatRecipientFact seat2 = new SeatRecipientFact();
        seat2.setRegistrationId(555L);
        seat2.setSeatNo(2);
        seat2.setInviteeMemberId(MEMBER);
        when(seatEligibility.playFacts(MEMBER, 1L, TOPIC)).thenReturn(Collections.singletonList(seat2));

        AjaxResult res = controller.encounter(TOPIC, 0L, NODE, null);
        Map<String, Object> rv = roleView(res);
        assertEquals("B", rv.get("role"));
        assertEquals("看实物", rv.get("otherRoleLabel"));
        assertEquals(1, views(rv).size());
        String json = new ObjectMapper().writeValueAsString(res);
        assertTrue(json.contains("B 的档案摘录"));
        assertFalse(json.contains("A 的实物清单"));
    }

    @Test
    void invalidRoleHintFallsBackSafelyToSolo() {
        AjaxResult res = controller.encounter(TOPIC, 0L, NODE, "INVALID");
        Map<String, Object> rv = roleView(res);
        assertEquals("SOLO", rv.get("role"));
        assertEquals(2, views(rv).size());
    }
}
