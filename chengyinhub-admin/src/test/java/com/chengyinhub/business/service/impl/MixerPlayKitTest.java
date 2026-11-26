package com.chengyinhub.business.service.impl;

import com.chengyinhub.business.service.impl.AdvancedActionJudgement.Action;
import com.chengyinhub.business.service.impl.AdvancedActionJudgement.Input;
import com.chengyinhub.business.service.impl.AdvancedActionJudgement.Plan;
import com.chengyinhub.business.service.support.AdvancedGameConfigValidator;
import com.chengyinhub.business.service.support.ContentCapabilityRequirements;
import com.chengyinhub.business.service.support.GameplaySupportMatrix;
import com.chengyinhub.business.service.support.NodeJourneySnapshot;
import com.chengyinhub.business.util.AdvancedGamePublicProjection;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

import java.util.Date;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/** 调音台(advanced.mixer):找出被静音的那一轨,打开它,按「就是这一轨」。示例内容与地址均为虚构占位。 */
class MixerPlayKitTest {
    private final ObjectMapper json = new ObjectMapper();
    private final AdvancedGameConfigValidator validator = new AdvancedGameConfigValidator();

    private String config(int maxTries) {
        return "{\"schemaVersion\":1,\"mixer\":{\"enabled\":true,\"title\":\"谁把声音删掉了\","
                + "\"tracks\":[{\"id\":\"drum\",\"label\":\"鼓\",\"muted\":false},"
                + "{\"id\":\"gtr\",\"label\":\"吉他\",\"muted\":false},"
                + "{\"id\":\"voc\",\"label\":\"人声\",\"muted\":true}],"
                + "\"answer\":\"voc\",\"wrongReply\":\"那一轨一直在响,看看哪条轨关着\","
                + "\"audioBefore\":\"https://example.invalid/mixer/before.mp3\","
                + "\"audioAfter\":\"https://example.invalid/mixer/after.mp3\","
                + "\"captionBefore\":\"只有鼓和吉他\",\"captionAfter\":\"人声回来了\","
                + "\"maxTries\":" + maxTries + ",\"xp\":20}}";
    }

    private JsonNode section(int maxTries) throws Exception {
        return json.readTree(config(maxTries));
    }

    private AdvancedActionJudgement judge() {
        return new AdvancedActionJudgement(json, () -> new Date(100_000), bound -> 0, () -> 42);
    }

    private Plan submit(JsonNode config, ObjectNode state, String trackId, List<String> unmuted, int score) {
        return judge().evaluate(Action.SUBMIT_MIXER,
                new Input(config, state, Map.of("trackId", trackId, "unmuted", unmuted), score, 7L));
    }

    @Test void acceptsWellFormedMixer() {
        assertTrue(validator.validateAndNormalize(config(2)).contains("谁把声音删掉了"));
        assertTrue(validator.hasEnabledMechanic(config(0)));
    }

    @Test void validatorEnforcesLimits() {
        String noMuted = config(0).replace("\"muted\":true", "\"muted\":false");
        assertTrue(assertThrows(IllegalArgumentException.class, () -> validator.validateAndNormalize(noMuted))
                .getMessage().contains("至少要有一条开局静音"));
        String foreignAnswer = config(0).replace("\"answer\":\"voc\"", "\"answer\":\"bass\"");
        assertThrows(IllegalArgumentException.class, () -> validator.validateAndNormalize(foreignAnswer));
        String longLabel = config(0).replace("\"label\":\"人声\"", "\"label\":\"一二三四五六七\"");
        assertThrows(IllegalArgumentException.class, () -> validator.validateAndNormalize(longLabel));
        String oneTrack = "{\"schemaVersion\":1,\"mixer\":{\"enabled\":true,\"title\":\"t\",\"tracks\":[{\"id\":\"a\",\"label\":\"甲\",\"muted\":true}],\"answer\":\"a\"}}";
        assertThrows(IllegalArgumentException.class, () -> validator.validateAndNormalize(oneTrack));
        String longTitle = config(0).replace("谁把声音删掉了", "一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一");
        assertThrows(IllegalArgumentException.class, () -> validator.validateAndNormalize(longTitle));
        String longReply = config(0).replace("那一轨一直在响,看看哪条轨关着", "错".repeat(61));
        assertThrows(IllegalArgumentException.class, () -> validator.validateAndNormalize(longReply));
        String longCaption = config(0).replace("人声回来了", "回".repeat(41));
        assertThrows(IllegalArgumentException.class, () -> validator.validateAndNormalize(longCaption));
        String badAudio = config(0).replace("https://example.invalid/mixer/before.mp3", "http://example.invalid/a.mp3");
        assertThrows(IllegalArgumentException.class, () -> validator.validateAndNormalize(badAudio));
        assertDoesNotThrow(() -> validator.validateAndNormalize(config(0).replace("https://example.invalid/mixer/after.mp3", "media-asset:12")));
        assertThrows(IllegalArgumentException.class, () -> validator.validateAndNormalize(config(-1)));
        String negativeXp = config(0).replace("\"xp\":20", "\"xp\":-1");
        assertThrows(IllegalArgumentException.class, () -> validator.validateAndNormalize(negativeXp));
    }

    @Test void projectionHidesAnswerAndWrongReply() throws Exception {
        String publicJson = AdvancedGamePublicProjection.safeConfigJson(config(2));
        assertFalse(publicJson.contains("\"answer\""));
        assertFalse(publicJson.contains("wrongReply"));
        assertFalse(publicJson.contains("一直在响"));
        JsonNode mixer = json.readTree(publicJson).path("mixer");
        assertEquals(3, mixer.path("tracks").size());
        assertTrue(mixer.path("tracks").get(2).path("muted").asBoolean());
        assertEquals("https://example.invalid/mixer/after.mp3", mixer.path("audioAfter").asText());
        assertEquals("人声回来了", mixer.path("captionAfter").asText());
        assertEquals(2, mixer.path("maxTries").asInt());
        assertFalse(AdvancedGamePublicProjection.safeConfigJson("{\"schemaVersion\":1,\"mixer\":{\"enabled\":false,\"title\":\"别下发\"}}").contains("别下发"));
    }

    @Test void correctNeedsTheAnswerTrackUnmutedAndPaysXpOnce() throws Exception {
        JsonNode config = section(0);
        Plan pickedButStillMuted = submit(config, json.createObjectNode(), "voc", List.of(), 5);
        assertFalse(pickedButStillMuted.state().path("mixer").path("lastCorrect").asBoolean());
        Plan right = submit(config, json.createObjectNode(), "voc", List.of("voc"), 5);
        JsonNode node = right.state().path("mixer");
        assertTrue(node.path("finished").asBoolean());
        assertTrue(node.path("passed").asBoolean());
        assertEquals(25, right.score());
        assertThrows(IllegalStateException.class, () -> submit(config, (ObjectNode) right.state(), "voc", List.of("voc"), 25));
        assertEquals("PASS", judge().serverGameplayDecision("SUBMIT_MIXER", config, right.state()).path("outcome").asText());
        assertTrue(AdvancedActionJudgement.mechanicsReady(config, right.state()));
    }

    @Test void wrongKeepsFeedbackAndDoesNotSettleWhileTriesRemain() throws Exception {
        JsonNode config = section(2);
        Plan wrong = submit(config, json.createObjectNode(), "gtr", List.of("voc"), 5);
        JsonNode node = wrong.state().path("mixer");
        assertEquals("gtr", node.path("lastTrackId").asText());
        assertEquals("那一轨一直在响,看看哪条轨关着", node.path("lastFeedback").asText());
        assertFalse(node.path("finished").asBoolean());
        assertEquals(5, wrong.score() == null ? 5 : wrong.score());
        assertNull(judge().serverGameplayDecision("SUBMIT_MIXER", config, wrong.state()), "还有次数的答错不结算 FAIL");
        assertFalse(AdvancedActionJudgement.mechanicsReady(config, wrong.state()));
        Plan spent = submit(config, wrong.state(), "drum", List.of(), 5);
        assertTrue(spent.state().path("mixer").path("finished").asBoolean());
        assertFalse(spent.state().path("mixer").path("passed").asBoolean());
        assertEquals("FAIL", judge().serverGameplayDecision("SUBMIT_MIXER", config, spent.state()).path("outcome").asText());
        Plan unlimited = submit(section(0), json.createObjectNode(), "drum", List.of(), 5);
        assertNull(judge().serverGameplayDecision("SUBMIT_MIXER", section(0), unlimited.state()), "不限次答错不结算 FAIL");
    }

    @Test void rejectsUnknownTracks() throws Exception {
        JsonNode config = section(0);
        assertThrows(IllegalArgumentException.class, () -> submit(config, json.createObjectNode(), "bass", List.of(), 0));
        assertThrows(IllegalArgumentException.class, () -> submit(config, json.createObjectNode(), "voc", List.of("bass"), 0));
    }

    @Test void capabilityAndRegistries() throws Exception {
        assertTrue(NodeJourneySnapshot.PLAYABLE_SECTIONS.contains("mixer"));
        ObjectNode snapshot = json.createObjectNode();
        snapshot.putObject("nodeConfigs").set("11", section(0));
        boolean found = false;
        for (JsonNode row : ContentCapabilityRequirements.required(snapshot)) found |= "game.mixer".equals(row.path("key").asText());
        assertTrue(found, "冻结内容里启用了调音台就要求 game.mixer");
        assertEquals("调音台", GameplaySupportMatrix.gameLabel("mixer"));
        assertEquals(AdvancedGameConfigValidator.PRESENT_INLINE, AdvancedGameConfigValidator.resolvePresent(section(0)));
    }
}
