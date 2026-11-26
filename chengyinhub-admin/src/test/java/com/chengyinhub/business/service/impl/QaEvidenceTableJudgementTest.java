package com.chengyinhub.business.service.impl;

import com.chengyinhub.business.service.impl.AdvancedActionJudgement.Action;
import com.chengyinhub.business.service.impl.AdvancedActionJudgement.Input;
import com.chengyinhub.business.service.impl.AdvancedActionJudgement.Plan;
import com.chengyinhub.business.service.support.QaEvidenceTableTest;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

import java.util.Date;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/** 证据表判定:仍是原 SUBMIT_QA {optionId};答错额外记所选行挂的规则序号 lastRule。夹具为虚构内容。 */
class QaEvidenceTableJudgementTest {
    private static final ObjectMapper JSON = new ObjectMapper();

    private AdvancedActionJudgement judge() {
        return new AdvancedActionJudgement(JSON, () -> new Date(100_000), bound -> 0, () -> 42);
    }

    @Test
    void wrongPickRecordsLastRuleAndRightPickClearsIt() {
        ObjectNode root = QaEvidenceTableTest.config();
        Plan wrong = judge().evaluate(Action.SUBMIT_QA, new Input(root, JSON.createObjectNode(), Map.of("optionId", "r3"), 0, 7L));
        JsonNode qa = wrong.state().path("qa");
        assertFalse(qa.path("passed").asBoolean());
        assertEquals("r3", qa.path("lastOptionId").asText());
        assertEquals("周日不借", qa.path("lastFeedback").asText());
        assertEquals(2, qa.path("lastRule").asInt());

        Plan noRule = judge().evaluate(Action.SUBMIT_QA, new Input(root, wrong.state(), Map.of("optionId", "r1"), 0, 7L));
        assertEquals(1, noRule.state().path("qa").path("lastRule").asInt(), "换一行答错,标红换成那一行的规则");

        Plan right = judge().evaluate(Action.SUBMIT_QA, new Input(root, noRule.state(), Map.of("optionId", "r2"), 0, 7L));
        assertTrue(right.state().path("qa").path("passed").asBoolean());
        assertFalse(right.state().path("qa").has("lastRule"), "答对后不再标红规则");
    }

    @Test
    void wrongPickWithoutRuleClearsAStaleHighlight() {
        ObjectNode root = QaEvidenceTableTest.config();
        ((ObjectNode) QaEvidenceTableTest.qa(root).path("options").get(0)).remove("rule");
        ObjectNode state = JSON.createObjectNode();
        state.putObject("qa").put("lastRule", 2).put("attempts", 1);
        Plan wrong = judge().evaluate(Action.SUBMIT_QA, new Input(root, state, Map.of("optionId", "r1"), 0, 7L));
        assertFalse(wrong.state().path("qa").has("lastRule"));
    }

    @Test
    void plainPickStateShapeIsUnchanged() {
        ObjectNode root = QaEvidenceTableTest.config();
        QaEvidenceTableTest.qa(root).remove("table");
        QaEvidenceTableTest.qa(root).remove("rules");
        Plan wrong = judge().evaluate(Action.SUBMIT_QA, new Input(root, JSON.createObjectNode(), Map.of("optionId", "r1"), 0, 7L));
        assertFalse(wrong.state().path("qa").has("lastRule"), "没有证据表的题不写 lastRule");
    }
}
