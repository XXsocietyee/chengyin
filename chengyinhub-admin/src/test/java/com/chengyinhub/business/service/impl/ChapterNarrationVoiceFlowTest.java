package com.chengyinhub.business.service.impl;

import com.chengyinhub.business.domain.CmsTopicChapter;
import com.chengyinhub.business.domain.dto.ChapterBlockDTO;
import com.chengyinhub.business.domain.dto.ChapterDTO;
import com.chengyinhub.business.domain.dto.NodeDTO;
import com.chengyinhub.business.exception.ChapterFlowValidationException;
import com.chengyinhub.business.service.support.AppMediaSchema;
import com.chengyinhub.business.util.ChapterBlockReadSupport;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** 2026-11-25 章节旁白(2026-11-26 扩展 line):text / cap / line 块上的可选 voice 字段写入、落库形状、签名口径与玩家读侧透传。 */
class ChapterNarrationVoiceFlowTest
{
    private static final ObjectMapper JSON = new ObjectMapper();

    private static ChapterBlockDTO block(String type, String content, String voice)
    {
        ChapterBlockDTO block = new ChapterBlockDTO();
        block.setType(type);
        block.setContent(content);
        block.setVoice(voice);
        return block;
    }

    private static ChapterBlockDTO lineBlock(String speaker, String content, String voice)
    {
        ChapterBlockDTO block = block("line", content, voice);
        block.setSpeaker(speaker);
        return block;
    }

    private static ChapterDTO chapter(ChapterBlockDTO... body)
    {
        ChapterDTO chapter = new ChapterDTO();
        chapter.setSchemaVersion(1);
        chapter.setRequired(1);
        chapter.setNodes(Collections.singletonList(new NodeDTO()));
        ChapterBlockDTO node = new ChapterBlockDTO();
        node.setType("node");
        node.setNodeIndex(0);
        List<ChapterBlockDTO> blocks = new ArrayList<>(Arrays.asList(body));
        blocks.add(node);
        chapter.setBlocks(blocks);
        return chapter;
    }

    private static JsonNode compile(ChapterDTO chapter) throws Exception
    {
        return JSON.readTree(ChapterFlowCompiler.compileChapterFlow(Collections.singletonList(chapter))
                .getChapters().get(0).materializeBlocks(Collections.singletonList(99L)));
    }

    @Test
    void 正文段与开场卡的旁白配音原样落库_空值不落键() throws Exception
    {
        ChapterBlockDTO open = block("cap", "开场", " media-asset:12 ");
        open.setCap("open");
        JsonNode rows = compile(chapter(open, block("text", "正文一", "https://cdn.example.cn/n/1.m4a"),
                block("text", "正文二", ""), block("text", "正文三", null)));
        assertEquals("media-asset:12", rows.get(0).get("voice").asText());
        assertEquals("https://cdn.example.cn/n/1.m4a", rows.get(1).get("voice").asText());
        assertFalse(rows.get(2).has("voice"));
        assertFalse(rows.get(3).has("voice"));
    }

    @Test
    void 台词块的旁白配音原样落库_空值不落键() throws Exception
    {
        JsonNode rows = compile(chapter(
                lineBlock("player", "你好，长安。", " media-asset:88 "),
                lineBlock("c_xa01a1", "城墙就在前面。", "https://cdn.example.cn/xa01/line1.m4a"),
                lineBlock("c_xa01a1", "无旁白台词", ""),
                lineBlock("c_xa01a1", "空旁白台词", null)));
        assertEquals("media-asset:88", rows.get(0).get("voice").asText());
        assertEquals("https://cdn.example.cn/xa01/line1.m4a", rows.get(1).get("voice").asText());
        assertFalse(rows.get(2).has("voice"));
        assertFalse(rows.get(3).has("voice"));
    }

    @Test
    void 负控_非正文块_非法地址()
    {
        ChapterBlockDTO image = block("image", null, "media-asset:1");
        image.setUrl("media-asset:2");
        assertThrows(ChapterFlowValidationException.class, () -> compile(chapter(image)));
        assertThrows(ChapterFlowValidationException.class, () -> compile(chapter(block("text", "x", "http://a.example.cn/1.m4a"))));
        assertThrows(ChapterFlowValidationException.class, () -> compile(chapter(block("text", "x", "media-asset:abc"))));
        assertThrows(ChapterFlowValidationException.class, () -> compile(chapter(lineBlock("player", "x", "http://a.example.cn/1.m4a"))));
    }

    @Test
    void 玩家读侧原样透传voice_含line块() throws Exception
    {
        CmsTopicChapter row = new CmsTopicChapter();
        row.setId(5L);
        row.setBlocksJson("[{\"type\":\"text\",\"key\":\"t1\",\"content\":\"第一段\",\"voice\":\"media-asset:9\"},"
                + "{\"type\":\"line\",\"key\":\"l1\",\"speaker\":\"player\",\"content\":\"台词一\",\"voice\":\"media-asset:10\"},"
                + "{\"type\":\"node\",\"nodeId\":99}]");
        List<Object> projected = ChapterBlockReadSupport.projectForPlayer(
                ChapterBlockReadSupport.resolve(row, Collections.emptyList()), Collections.<Long>emptySet());
        assertEquals("media-asset:9", ((Map<?, ?>) projected.get(0)).get("voice"));
        assertEquals("media-asset:10", ((Map<?, ?>) projected.get(1)).get("voice"));
    }

    @Test
    void 媒体Schema识别text_cap_line的voice用于签名与审核()
    {
        assertTrue(AppMediaSchema.isBlockVoice("voice", "text"));
        assertTrue(AppMediaSchema.isBlockVoice("voice", "cap"));
        assertTrue(AppMediaSchema.isBlockVoice("voice", "line"));
        assertFalse(AppMediaSchema.isBlockVoice("voice", "image"));
        assertFalse(AppMediaSchema.isBlockVoice("voice", "audio"));
        assertFalse(AppMediaSchema.isBlockVoice("voice", "voice"));
        assertFalse(AppMediaSchema.isBlockVoice("content", "line"));
        assertFalse(AppMediaSchema.isBlockVoice("voice", null));
    }
}
