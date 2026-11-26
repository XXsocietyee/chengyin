package com.chengyinhub.business.service.support;

import com.chengyinhub.business.util.AdvancedGamePublicProjection;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 选项问答证据表(qa.table / qa.rules / options[].rule):量程校验、公开面不漏答案、
 * 能力需求 qa.table@1(答错记 lastRule 见 impl 包的 QaEvidenceTableJudgementTest)。夹具全部为虚构内容。
 */
public class QaEvidenceTableTest {
    private static final ObjectMapper JSON = new ObjectMapper();

    /** 虚构:三张借书记录,规则两条;r2 是对的,r1 违反①,r3 违反②。 */
    public static ObjectNode config() {
        ObjectNode root = JSON.createObjectNode().put("schemaVersion", 1);
        ObjectNode qa = root.putObject("qa");
        qa.put("enabled", true).put("mode", "PICK").put("title", "哪一张借书单是真的").put("maxTries", 0).put("xp", 0);
        ObjectNode table = qa.putObject("table");
        table.putArray("columns").add("借书人").add("日期").add("书名");
        ArrayNode rows = table.putArray("rows");
        rows.addObject().put("id", "r1").putArray("cells").add("甲").add("周一").add("星图");
        rows.addObject().put("id", "r2").putArray("cells").add("乙").add("周三").add("潮汐");
        rows.addObject().put("id", "r3").putArray("cells").add("丙").add("周日").add("风铃");
        ArrayNode rules = qa.putArray("rules");
        rules.addObject().put("k", "①").put("t", "周一闭馆");
        rules.addObject().put("k", "②").put("t", "周日只还不借");
        ArrayNode options = qa.putArray("options");
        options.addObject().put("id", "r1").put("label", "甲").put("fb", "那天闭馆").put("rule", 1);
        options.addObject().put("id", "r2").put("label", "乙").put("fb", "对上了").put("correct", true);
        options.addObject().put("id", "r3").put("label", "丙").put("fb", "周日不借").put("rule", 2);
        return root;
    }

    public static ObjectNode qa(ObjectNode root) {
        return (ObjectNode) root.get("qa");
    }

    private void accepts(ObjectNode root) throws Exception {
        new AdvancedGameConfigValidator().validateAndNormalize(JSON.writeValueAsString(root));
    }

    private void rejects(String message, Consumer<ObjectNode> mutate) {
        ObjectNode root = config();
        mutate.accept(root);
        IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> new AdvancedGameConfigValidator().validateAndNormalize(JSON.writeValueAsString(root)));
        assertEquals(message, error.getMessage());
    }

    private static String repeat(String s, int n) {
        return s.repeat(n);
    }

    @Test
    void validConfigIsAcceptedAndKeepsItsFields() throws Exception {
        JsonNode saved = JSON.readTree(new AdvancedGameConfigValidator().validateAndNormalize(JSON.writeValueAsString(config())));
        assertEquals(3, saved.path("qa").path("table").path("rows").size());
        assertEquals(2, saved.path("qa").path("rules").size());
        assertEquals(1, saved.path("qa").path("options").get(0).path("rule").asInt());
    }

    @Test
    void tableAllowsUpToTwelveRowsAndOptions() throws Exception {
        ObjectNode root = config();
        ArrayNode rows = (ArrayNode) qa(root).path("table").path("rows");
        ArrayNode options = (ArrayNode) qa(root).path("options");
        for (int i = 4; i <= 12; i++) {
            rows.addObject().put("id", "r" + i).putArray("cells").add("某" + i).add("周二").add("书" + i);
            options.addObject().put("id", "r" + i).put("label", "某" + i);
        }
        accepts(root);
        rows.addObject().put("id", "r13").putArray("cells").add("某").add("周二").add("书");
        options.addObject().put("id", "r13").put("label", "某");
        IllegalArgumentException error = assertThrows(IllegalArgumentException.class, () -> accepts(root));
        assertEquals("证据表须为 2 至 12 行", error.getMessage());
    }

    @Test
    void columnLimits() {
        rejects("证据表须为 2 至 5 列", root -> {
            ObjectNode table = (ObjectNode) qa(root).get("table");
            table.putArray("columns").add("只一列");
            for (JsonNode row : table.path("rows")) ((ObjectNode) row).putArray("cells").add("x");
        });
        rejects("证据表须为 2 至 5 列", root -> {
            ObjectNode table = (ObjectNode) qa(root).get("table");
            table.putArray("columns").add("a").add("b").add("c").add("d").add("e").add("f");
        });
        rejects("证据表列名不能超过 12 字", root ->
                ((ArrayNode) qa(root).path("table").path("columns")).set(0, JSON.getNodeFactory().textNode(repeat("名", 13))));
        rejects("证据表列名不能为空", root ->
                ((ArrayNode) qa(root).path("table").path("columns")).set(0, JSON.getNodeFactory().textNode("  ")));
    }

    @Test
    void rowAndCellLimits() {
        rejects("证据表须为 2 至 12 行", root -> {
            ((ArrayNode) qa(root).path("table").path("rows")).remove(2);
            ((ArrayNode) qa(root).path("table").path("rows")).remove(1);
        });
        rejects("证据表每行的格数必须与列数相同", root ->
                ((ArrayNode) qa(root).path("table").path("rows").get(0).path("cells")).remove(0));
        rejects("证据表格子不能超过 24 字", root ->
                ((ArrayNode) qa(root).path("table").path("rows").get(0).path("cells")).set(0, JSON.getNodeFactory().textNode(repeat("字", 25))));
        rejects("证据表行 id 不能重复", root -> {
            ((ObjectNode) qa(root).path("table").path("rows").get(2)).put("id", "r1");
        });
    }

    @Test
    void ruleLimits() {
        rejects("规则最多 6 条", root -> {
            ArrayNode rules = (ArrayNode) qa(root).get("rules");
            for (int i = 0; i < 5; i++) rules.addObject().put("k", "⑨").put("t", "虚构规则");
        });
        rejects("规则编号不能超过 3 字", root -> ((ObjectNode) qa(root).path("rules").get(0)).put("k", "一二三四"));
        rejects("规则内容不能超过 30 字", root -> ((ObjectNode) qa(root).path("rules").get(0)).put("t", repeat("规", 31)));
        rejects("规则内容不能为空", root -> ((ObjectNode) qa(root).path("rules").get(0)).put("t", ""));
        rejects("选项 r3 对应的规则序号不存在", root -> ((ObjectNode) qa(root).path("options").get(2)).put("rule", 3));
        rejects("选项 r1 对应的规则序号不存在", root -> ((ObjectNode) qa(root).path("options").get(0)).put("rule", 0));
        rejects("规则只能和证据表一起使用", root -> qa(root).remove("table"));
    }

    @Test
    void optionsMustMirrorRowsAndStaySingleChoice() {
        rejects("证据表选项 id 必须与表行 id 一致且顺序相同", root -> {
            ArrayNode options = (ArrayNode) qa(root).get("options");
            JsonNode first = options.remove(0);
            options.add(first);
        });
        rejects("带证据表的问答必须每行一个选项", root -> ((ArrayNode) qa(root).get("options")).remove(2));
        rejects("带证据表的问答只能单选", root -> qa(root).put("multi", true));
        rejects("证据表只能用于选项问答", root -> qa(root).put("mode", "TYPE").put("answerText", "乙"));
        rejects("证据表格式不正确", root -> qa(root).put("table", "表"));
    }

    @Test
    void configWithoutTableKeepsTheOldFourOptionCap() throws Exception {
        ObjectNode root = config();
        qa(root).remove("table");
        qa(root).remove("rules");
        ((ArrayNode) qa(root).get("options")).addObject().put("id", "r4").put("label", "丁");
        accepts(root);   // 四个选项照旧可以
        ((ArrayNode) qa(root).get("options")).addObject().put("id", "r5").put("label", "戊");
        IllegalArgumentException error = assertThrows(IllegalArgumentException.class, () -> accepts(root));
        assertEquals("选项问答须为 2 至 4 个选项", error.getMessage());
        // 老配置的公开面没有 table / rules
        ObjectNode old = config();
        qa(old).remove("table");
        qa(old).remove("rules");
        JsonNode safe = JSON.readTree(AdvancedGamePublicProjection.safeConfigJson(JSON.writeValueAsString(old)));
        assertFalse(safe.path("qa").has("table"));
        assertFalse(safe.path("qa").has("rules"));
    }

    @Test
    void projectionPublishesTableAndRulesButNoAnswers() throws Exception {
        JsonNode safe = JSON.readTree(AdvancedGamePublicProjection.safeConfigJson(JSON.writeValueAsString(config())));
        JsonNode qa = safe.path("qa");
        assertEquals(List.of("借书人", "日期", "书名"), texts(qa.path("table").path("columns")));
        assertEquals("r2", qa.path("table").path("rows").get(1).path("id").asText());
        assertEquals(List.of("乙", "周三", "潮汐"), texts(qa.path("table").path("rows").get(1).path("cells")));
        assertEquals("①", qa.path("rules").get(0).path("k").asText());
        assertEquals("周日只还不借", qa.path("rules").get(1).path("t").asText());
        for (JsonNode option : qa.path("options")) {
            assertFalse(option.has("rule"), "规则序号判完才给");
            assertFalse(option.has("correct"), "正确答案不下发");
            assertFalse(option.has("fb"), "反馈判完才给");
        }
        String raw = safe.toString();
        assertFalse(raw.contains("那天闭馆"), "选项反馈一个字都不下发");
        assertFalse(raw.contains("\"correct\""));
    }

    @Test
    void capabilityRequiredOnlyWhenTableIsPresent() {
        ObjectNode snapshot = JSON.createObjectNode().put("routeMode", "LINEAR");
        snapshot.putObject("nodeConfigs").set("11", config());
        assertTrue(keys(ContentCapabilityRequirements.required(snapshot)).contains("qa.table"));
        ObjectNode verdict = ContentCapabilityRequirements.compatibility(snapshot,
                ContentCapabilityRequirements.Declaration.parse("wechat", "8.0.1", "game.qa@1"));
        assertFalse(verdict.path("supported").asBoolean(), "不认识证据表的客户端开局前就不支持");
        assertTrue(keys(verdict.path("missingCapabilities")).contains("qa.table"));

        ObjectNode plain = config();
        qa(plain).remove("table");
        qa(plain).remove("rules");
        ObjectNode oldSnapshot = JSON.createObjectNode().put("routeMode", "LINEAR");
        oldSnapshot.putObject("nodeConfigs").set("11", plain);
        assertFalse(keys(ContentCapabilityRequirements.required(oldSnapshot)).contains("qa.table"));
    }

    private static List<String> texts(JsonNode array) {
        List<String> out = new ArrayList<>();
        for (JsonNode node : array) out.add(node.asText());
        return out;
    }

    private static List<String> keys(JsonNode rows) {
        List<String> keys = new ArrayList<>();
        for (JsonNode row : rows) keys.add(row.path("key").asText());
        return keys;
    }
}
