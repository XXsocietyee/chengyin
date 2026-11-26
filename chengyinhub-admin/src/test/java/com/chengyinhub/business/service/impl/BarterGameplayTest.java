package com.chengyinhub.business.service.impl;

import com.chengyinhub.business.service.impl.AdvancedActionJudgement.Action;
import com.chengyinhub.business.service.impl.AdvancedActionJudgement.Input;
import com.chengyinhub.business.service.impl.AdvancedActionJudgement.Plan;
import com.chengyinhub.business.service.support.AdvancedGameConfigValidator;
import com.chengyinhub.business.service.support.BarterGameplay;
import com.chengyinhub.business.service.support.ContentCapabilityRequirements;
import com.chengyinhub.business.service.support.GameplayOutcomeRules;
import com.chengyinhub.business.service.support.GameplaySupportMatrix;
import com.chengyinhub.business.service.support.NodeJourneySnapshot;
import com.chengyinhub.business.util.AdvancedGamePublicProjection;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 以物换物(barter)端到端合同:保存校验上下限、服务端重放判定(含非法一步)、目标判定、
 * 有次数时答错不结算、投影不漏 fb、能力键与发布闸登记。题面内容均为虚构样例。
 */
class BarterGameplayTest {
    private final ObjectMapper json = new ObjectMapper();
    private final AdvancedGameConfigValidator validator = new AdvancedGameConfigValidator();

    /** 虚构样例:两枚夹子 + 一个杯垫;要拿到车票,还要留住杯垫。正解:甲(夹子→胶带)、乙(胶带→车票)。 */
    private ObjectNode section() throws Exception {
        return (ObjectNode) json.readTree("{\"enabled\":true,\"title\":\"换一张去海边的车票\","
                + "\"items\":[{\"id\":\"clip\",\"name\":\"夹子\",\"icon\":\"clip\"},{\"id\":\"coaster\",\"name\":\"杯垫\",\"icon\":\"coaster\"},"
                + "{\"id\":\"tape\",\"name\":\"胶带\",\"icon\":\"tape\"},{\"id\":\"ticket\",\"name\":\"车票\",\"icon\":\"ticket\"},"
                + "{\"id\":\"key\",\"name\":\"钥匙\"}],"
                + "\"start\":[\"clip\",\"clip\",\"coaster\"],"
                + "\"goals\":[{\"id\":\"g1\",\"label\":\"拿到车票\",\"need\":\"ticket\"},{\"id\":\"g2\",\"label\":\"留住杯垫\",\"keep\":\"coaster\"}],"
                + "\"offers\":[{\"id\":\"o1\",\"key\":\"甲\",\"give\":\"clip\",\"get\":\"tape\"},"
                + "{\"id\":\"o2\",\"key\":\"乙\",\"give\":\"tape\",\"get\":\"ticket\"},"
                + "{\"id\":\"o3\",\"key\":\"丙\",\"give\":\"coaster\",\"get\":\"ticket\",\"fb\":\"杯垫一换走就留不住了\"},"
                + "{\"id\":\"o4\",\"key\":\"丁\",\"give\":\"clip\",\"get\":\"key\"}],"
                + "\"maxTries\":0,\"xp\":10}");
    }

    private ObjectNode config(ObjectNode barter) {
        ObjectNode root = json.createObjectNode();
        root.put("schemaVersion", 1);
        root.set("barter", barter);
        return root;
    }

    private AdvancedActionJudgement judge() {
        return new AdvancedActionJudgement(json, () -> new Date(100_000), bound -> 0, () -> 42);
    }

    private Plan submit(JsonNode config, ObjectNode state, String... order) {
        return judge().evaluate(Action.SUBMIT_BARTER, new Input(config, state, Map.of("order", List.of((Object[]) order)), 5, 7L));
    }

    private void rejects(String fragment, Consumer<ObjectNode> mutate) throws Exception {
        ObjectNode barter = section();
        mutate.accept(barter);
        IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> validator.validateAndNormalize(config(barter).toString()));
        assertTrue(error.getMessage().contains(fragment), "实际错误:" + error.getMessage());
    }

    /* ==================== 保存校验 ==================== */

    @Test
    void validConfigIsKeptAndCountsAsAdvancedGameplay() throws Exception {
        String normalized = validator.validateAndNormalize(config(section()).toString());
        assertTrue(json.readTree(normalized).path("barter").path("enabled").asBoolean());
        assertTrue(validator.hasEnabledMechanic(config(section()).toString()), "只配换物题的节点也必须算已配玩法");
        assertEquals("inline", AdvancedGameConfigValidator.resolvePresent(config(section())));
    }

    @Test
    void validatorEnforcesContractLimits() throws Exception {
        rejects("标题", b -> b.put("title", ""));
        rejects("标题", b -> b.put("title", "一".repeat(41)));
        rejects("2 至 10 件物品", b -> { while (b.withArray("items").size() > 1) b.withArray("items").remove(1); });
        rejects("2 至 10 件物品", b -> { for (int i = 0; i < 6; i++) b.withArray("items").addObject().put("id", "x" + i).put("name", "物" + i); });
        rejects("物品名称不能超过 8", b -> ((ObjectNode) b.withArray("items").get(0)).put("name", "一二三四五六七八九"));
        rejects("图标", b -> ((ObjectNode) b.withArray("items").get(0)).put("icon", "rocket"));
        rejects("物品 id 不能重复", b -> ((ObjectNode) b.withArray("items").get(1)).put("id", "clip"));
        rejects("1 至 6 件", b -> b.putArray("start"));
        rejects("1 至 6 件", b -> { for (int i = 0; i < 4; i++) b.withArray("start").add("clip"); });
        rejects("背包引用了不存在", b -> b.withArray("start").add("ghost"));
        rejects("1 至 3 个目标", b -> b.putArray("goals"));
        rejects("1 至 3 个目标", b -> { for (int i = 0; i < 2; i++) b.withArray("goals").addObject().put("id", "gx" + i).put("label", "多").put("need", "key"); });
        rejects("need 或 keep", b -> ((ObjectNode) b.withArray("goals").get(0)).put("keep", "clip"));
        rejects("need 或 keep", b -> ((ObjectNode) b.withArray("goals").get(0)).remove("need"));
        rejects("目标名称不能超过 10", b -> ((ObjectNode) b.withArray("goals").get(0)).put("label", "一二三四五六七八九十一"));
        rejects("目标引用了不存在", b -> ((ObjectNode) b.withArray("goals").get(0)).put("need", "ghost"));
        rejects("2 至 6 条换物", b -> { while (b.withArray("offers").size() > 1) b.withArray("offers").remove(1); });
        rejects("2 至 6 条换物", b -> { for (int i = 0; i < 3; i++) b.withArray("offers").addObject().put("id", "ox" + i).put("key", "戊").put("give", "clip").put("get", "key"); });
        rejects("换物标记不能超过 2", b -> ((ObjectNode) b.withArray("offers").get(0)).put("key", "甲乙丙"));
        rejects("换物引用了不存在", b -> ((ObjectNode) b.withArray("offers").get(0)).put("get", "ghost"));
        rejects("换物 id 不能重复", b -> ((ObjectNode) b.withArray("offers").get(1)).put("id", "o1"));
        rejects("提示不能超过 60", b -> ((ObjectNode) b.withArray("offers").get(0)).put("fb", "一".repeat(61)));
        rejects("0 表示不限", b -> b.put("maxTries", -1));
        rejects("奖励分", b -> b.put("xp", -1));
        // 允许:背包初始重复同一件、6 条换物、3 个目标、提示正好 60 字
        ObjectNode ok = section();
        ((ObjectNode) ok.withArray("offers").get(0)).put("fb", "一".repeat(60));
        ok.withArray("offers").addObject().put("id", "o5").put("key", "戊").put("give", "key").put("get", "clip");
        ok.withArray("offers").addObject().put("id", "o6").put("key", "己").put("give", "ticket").put("get", "key");
        ok.withArray("goals").addObject().put("id", "g3").put("label", "留个钥匙").put("keep", "key");
        assertNotNull(validator.validateAndNormalize(config(ok).toString()));
    }

    /* ==================== 判定 ==================== */

    @Test
    void correctPlanPassesFinishesAndAwardsXpOnce() throws Exception {
        ObjectNode original = json.createObjectNode();
        Plan plan = submit(config(section()), original, "o1", "o2");
        assertTrue(original.isEmpty(), "判定只产出提案,不改入参状态");
        JsonNode st = plan.state().path("barter");
        assertTrue(st.path("passed").asBoolean());
        assertTrue(st.path("finished").asBoolean());
        assertTrue(st.path("lastCorrect").asBoolean());
        assertEquals(0, st.path("failedGoals").size());
        assertEquals("", st.path("lastFeedback").asText());
        assertEquals(15, plan.score(), "换对给一次 xp");
        assertTrue(AdvancedActionJudgement.mechanicsReady(config(section()), plan.state()));
        assertEquals("PASS", judge().serverGameplayDecision("SUBMIT_BARTER", config(section()), plan.state()).path("outcome").asText());
        assertThrows(IllegalStateException.class, () -> submit(config(section()), plan.state(), "o1", "o2"),
                "换对即收摊,不能再交一次再拿 xp");
    }

    @Test
    void losingAKeepItemFailsThatGoalAndReturnsTheFirstFeedback() throws Exception {
        Plan plan = submit(config(section()), json.createObjectNode(), "o4", "o3");
        JsonNode st = plan.state().path("barter");
        assertFalse(st.path("passed").asBoolean());
        assertFalse(st.path("finished").asBoolean(), "不限次答错不收摊");
        assertFalse(st.path("lastCorrect").asBoolean());
        assertEquals("[\"o4\",\"o3\"]", st.path("lastOrder").toString());
        assertEquals("杯垫一换走就留不住了", st.path("lastFeedback").asText(), "取顺序里第一条带 fb 的换物");
        assertEquals("[\"g2\"]", st.path("failedGoals").toString());
        assertEquals(5, plan.score(), "答错不给分");
        assertFalse(AdvancedActionJudgement.mechanicsReady(config(section()), plan.state()));
    }

    @Test
    void missingNeedWithoutFeedbackLeavesFeedbackEmpty() throws Exception {
        Plan plan = submit(config(section()), json.createObjectNode(), "o4");
        JsonNode st = plan.state().path("barter");
        assertEquals("", st.path("lastFeedback").asText());
        assertEquals("[\"g1\"]", st.path("failedGoals").toString());
        assertEquals(1, st.path("attempts").asInt());
    }

    @Test
    void illegalStepIsRejectedWithoutSpendingAnAttempt() throws Exception {
        ObjectNode original = json.createObjectNode();
        original.putObject("barter").put("attempts", 1);
        ObjectNode before = original.deepCopy();
        IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> submit(config(section()), original, "o2"));
        assertTrue(error.getMessage().contains("第 1 步") && error.getMessage().contains("胶带"), error.getMessage());
        assertEquals(before, original);
        // 两次换出同一件东西:背包只有一个杯垫
        ObjectNode twice = section();
        twice.withArray("offers").addObject().put("id", "o5").put("key", "戊").put("give", "coaster").put("get", "key");
        assertThrows(IllegalArgumentException.class, () -> submit(config(twice), json.createObjectNode(), "o3", "o5"));
    }

    @Test
    void submissionShapeIsChecked() throws Exception {
        JsonNode config = config(section());
        assertThrows(IllegalArgumentException.class, () -> submit(config, json.createObjectNode()));
        assertThrows(IllegalArgumentException.class, () -> submit(config, json.createObjectNode(), "o1", "o1"));
        assertThrows(IllegalArgumentException.class, () -> submit(config, json.createObjectNode(), "ghost"));
        List<Object> seven = new ArrayList<>(List.of("o1", "o2", "o3", "o4", "o5", "o6", "o7"));
        assertThrows(IllegalArgumentException.class, () -> judge().evaluate(Action.SUBMIT_BARTER,
                new Input(config, json.createObjectNode(), Map.of("order", seven), 0, 7L)));
        assertThrows(IllegalArgumentException.class, () -> judge().evaluate(Action.SUBMIT_BARTER,
                new Input(config, json.createObjectNode(), Map.of("order", "o1"), 0, 7L)));
        ObjectNode off = section();
        off.put("enabled", false);
        assertThrows(IllegalArgumentException.class, () -> submit(config(off), json.createObjectNode(), "o1"));
    }

    @Test
    void wrongWithTriesLeftDoesNotSettleFail() throws Exception {
        ObjectNode limited = section();
        limited.put("maxTries", 2);
        JsonNode config = config(limited);
        Plan first = submit(config, json.createObjectNode(), "o4");
        assertNull(judge().serverGameplayDecision("SUBMIT_BARTER", config, first.state()), "还有次数的答错不结算 FAIL");
        assertEquals(Boolean.FALSE, AdvancedActionJudgement.judgedOutcome("SUBMIT_BARTER", first.state()));
        Plan second = submit(config, first.state(), "o3");
        JsonNode st = second.state().path("barter");
        assertTrue(st.path("finished").asBoolean());
        assertFalse(st.path("passed").asBoolean());
        assertEquals("FAIL", judge().serverGameplayDecision("SUBMIT_BARTER", config, second.state()).path("outcome").asText(),
                "次数用完才结算 FAIL");
        assertTrue(AdvancedActionJudgement.mechanicsReady(config, second.state()), "次数用完也算走完这一站");
        assertThrows(IllegalStateException.class, () -> submit(config, second.state(), "o1", "o2"));

        // 不限次:错多少次都不收摊、不结算
        ObjectNode state = json.createObjectNode();
        for (int i = 0; i < 5; i++) state = submit(config(section()), state, "o4").state();
        assertFalse(state.path("barter").path("finished").asBoolean());
        assertNull(judge().serverGameplayDecision("SUBMIT_BARTER", config(section()), state));
        Plan right = submit(config(section()), state, "o1", "o2");
        assertEquals(15, right.score());
    }

    /* ==================== 投影与运行期视图 ==================== */

    @Test
    void projectionAndRuntimeViewNeverLeakFeedback() throws Exception {
        String normalized = validator.validateAndNormalize(config(section()).toString());
        JsonNode safe = json.readTree(AdvancedGamePublicProjection.safeConfigJson(normalized));
        JsonNode barter = safe.path("barter");
        assertTrue(barter.path("enabled").asBoolean());
        assertEquals("换一张去海边的车票", barter.path("title").asText());
        assertEquals(5, barter.path("items").size());
        assertEquals("clip", barter.path("items").get(0).path("icon").asText());
        assertEquals("[\"clip\",\"clip\",\"coaster\"]", barter.path("start").toString());
        assertEquals("coaster", barter.path("goals").get(1).path("keep").asText());
        assertEquals(4, barter.path("offers").size());
        assertEquals("丙", barter.path("offers").get(2).path("key").asText());
        assertEquals(10, barter.path("xp").asInt());
        assertFalse(safe.toString().contains("杯垫一换走就留不住了"), "fb 不进公开投影");
        for (JsonNode offer : barter.path("offers")) assertFalse(offer.has("fb"));

        JsonNode fresh = BarterGameplay.runtimeView(section(), json.createObjectNode());
        assertFalse(fresh.toString().contains("杯垫一换走就留不住了"), "没答错前运行期视图里也没有 fb");
        assertEquals("", fresh.path("lastFeedback").asText());
        Plan wrong = submit(config(section()), json.createObjectNode(), "o3");
        JsonNode after = BarterGameplay.runtimeView(section(), wrong.state().path("barter"));
        assertEquals("杯垫一换走就留不住了", after.path("lastFeedback").asText(), "答错之后只回那一条 fb");
        for (JsonNode offer : after.path("offers")) assertFalse(offer.has("fb"));
        assertEquals("[\"g2\"]", after.path("failedGoals").toString());
    }

    /* ==================== 能力键 / 发布闸 / 结果规则 ==================== */

    @Test
    void capabilityKeyAndRegistriesAreWired() throws Exception {
        assertTrue(NodeJourneySnapshot.PLAYABLE_SECTIONS.contains("barter"));
        ObjectNode snapshot = json.createObjectNode();
        snapshot.putObject("nodeConfigs").putObject("11").set("barter", section());
        List<String> keys = new ArrayList<>();
        for (JsonNode row : ContentCapabilityRequirements.required(snapshot)) keys.add(row.path("key").asText());
        assertTrue(keys.contains("game.barter"), "老客户端靠 game.barter 拿到 409");

        assertEquals("barter", GameplayOutcomeRules.mainKit(config(section())));
        assertTrue(AdvancedActionJudgement.handles("SUBMIT_BARTER"));
        boolean registered = false;
        for (JsonNode row : GameplaySupportMatrix.view().path("types")) {
            if ("barter".equals(row.path("key").asText())) {
                registered = true;
                assertEquals("barter", row.path("section").asText());
                assertTrue(row.path("completionProof").asBoolean());
                assertTrue(row.path("r5CompletionProof").asBoolean());
            }
        }
        assertTrue(registered, "换物题有服务端完成证明,必须登记才过发布闸");
        assertFalse(GameplaySupportMatrix.addon("barter"));
        assertEquals("以物换物", GameplaySupportMatrix.gameLabel("barter"));
    }
}
