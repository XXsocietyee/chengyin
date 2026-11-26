package com.chengyinhub.business.service;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** 持久幂等与字段白名单的 SQL 合同，防止实现退回通用复制 mapper。 */
class TopicEditionReopenMapperContractTest {

    @Test
    void requestUsesDedicatedUniqueKeyAndTopicInsertHasNoCommercialCarryOver() throws Exception {
        String migration = WiringSource.read("chengyinhub-admin/sql/migration_topic_edition_reopen_request_20260811.sql")
                .replaceAll("\\s+", " ");
        String xml = WiringSource.read("chengyinhub-system/src/main/resources/mapper/business/TopicEditionReopenMapper.xml")
                .replaceAll("\\s+", "");
        int requestStart = xml.indexOf("<insertid=\"insertReopenRequest\"");
        int requestEnd = xml.indexOf("</insert>", requestStart);
        int topicStart = xml.indexOf("<insertid=\"insertReopenedTopic\"");
        int topicEnd = xml.indexOf("</insert>", topicStart);
        String request = xml.substring(requestStart, requestEnd);
        String topic = xml.substring(topicStart, topicEnd);

        assertTrue(migration.contains("UNIQUE KEY uk_reopen (source_topic_id, idempotency_key)"),
                "同一来源+幂等键必须由数据库唯一键占位，不能靠进程内判断");
        assertTrue(request.contains("insertignoreintotopic_edition_reopen_request"),
                "撞唯一键必须读回既有请求，不能抛错后重新复制");
        assertTrue(topic.contains("source_topic_id") && !topic.contains(",topic_id,"),
                "来源追溯只能写 source_topic_id，绝不能把来源塞进历史 topic_id");
        assertTrue(topic.contains("journey_rules_json"),
                "[R5] 数值规则必须随新一期复制,insertReopenedTopic 列清单漏了就是静默丢规则");
        assertFalse(topic.contains("game_module_config_json"),
                "活动级游戏模组配置刻意不跨期复制,别顺手加");
        int chaptersStart = xml.indexOf("<selectid=\"selectSourceChapters\"");
        String chapterSelect = xml.substring(chaptersStart, xml.indexOf("</select>", chaptersStart));
        int chapterInsertStart = xml.indexOf("<insertid=\"insertReopenedChapter\"");
        String chapterInsert = xml.substring(chapterInsertStart, xml.indexOf("</insert>", chapterInsertStart));
        assertTrue(chapterSelect.contains("c.allowed_category_ids") && chapterInsert.contains("allowed_category_ids"),
                "F16-4:章节可承接品类清单必须随新一期读出并写入");
        assertTrue(chapterSelect.contains("m.role_needfromcms_topic_chapter_template_meta")
                        && chapterSelect.contains("m.del_flag=0"),
                "F16-4:位置说明从章节模板元数据(未删除行)带出");
        assertFalse(xml.contains("insertintocms_topic_chapter_template_meta"),
                "F16-4:位置说明只经 CmsTopicTemplateMetaMapper.upsertChapterRoleNeed 原写口落库,本 mapper 不另开写口");
        for (String forbidden : new String[]{"start_date", "end_date", "sale_end_at", "self_play_price",
                "self_play_quota", "fee_platform_rate", "complete_reward_coupon_id"}) {
            assertFalse(topic.contains(forbidden), "商业/时间快照字段不在 REOPEN 白名单: " + forbidden);
        }
    }
}
