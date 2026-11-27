package com.chengyinhub.business.service.support;

import com.chengyinhub.business.domain.CmsTopic;
import com.chengyinhub.business.domain.CmsTopicChapter;
import com.chengyinhub.business.domain.CmsTopicNode;
import com.chengyinhub.common.constant.PlayMode;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 第一站免费试玩策略（§3.2 Item 3）：
 * <ul>
 *   <li>仅允许已上架可见、支持自玩（selfPlay=1）且非自由探索（productType != FREE_COLLECT）的主题进入第 1 站免费试玩。</li>
 *   <li>第 1 站口径与 {@link RoutePlayOrder} 完全一致：章节 sort_id → 节点 sort_id → 节点 id。</li>
 *   <li>第 2 站及之后的所有剧情、题面、选项、提示、音频与高级玩法配置在服务端统一剥离，防抓包剧透。</li>
 * </ul>
 */
public final class FirstStationTrialPolicy {

    /** 试玩态下第 2 站及之后必须剥离的内容与玩法字段（防抓包）。 */
    public static final List<String> TRIAL_STRIPPED_NODE_FIELDS = Collections.unmodifiableList(Arrays.asList(
            "question", "questionImg", "questionAudio", "options", "optionMedia",
            "storyText", "storyImg", "description", "hookText", "cardHookLong", "fragmentText",
            "ruleInstructions", "photoRequireDesc", "requiredMaterials", "gameTitle",
            "hint1", "hint2", "usedHints", "hintLocked", "hintCost", "hintCount",
            "puzzleScoring", "puzzleHintLevel", "puzzleScoreCap",
            "answerReveal", "feedbackText",
            "audioUrl", "audioDuration",
            "sensorType", "sensorConfig", "advancedConfigJson",
            "medalName", "medalStyle", "medalImg", "couponId", "coupon"
    ));

    private FirstStationTrialPolicy() {
    }

    /** 主题是否允许进入第 1 站免费试玩：必须支持自玩且为线性定向故事主题（自由探索含商家核销权益，不走免票试玩）。 */
    public static boolean isTrialEligibleTopic(CmsTopic topic) {
        if (topic == null) return false;
        if (!Integer.valueOf(1).equals(topic.getSelfPlay())) return false;
        Integer productType = topic.getProductType();
        return productType == null || productType.intValue() != PlayMode.FREE_COLLECT;
    }

    /** 解析主题第 1 站节点 ID（过滤已下架节点，按 RoutePlayOrder 排序）。 */
    public static Long firstStationId(List<CmsTopicNode> nodes, List<CmsTopicChapter> chapters) {
        CmsTopicNode first = firstStation(nodes, chapters);
        return first == null ? null : first.getId();
    }

    /** 解析主题第 1 站节点实体。 */
    public static CmsTopicNode firstStation(List<CmsTopicNode> nodes, List<CmsTopicChapter> chapters) {
        if (nodes == null || nodes.isEmpty()) return null;
        List<CmsTopicNode> active = new ArrayList<>();
        for (CmsTopicNode n : nodes) {
            if (n == null || n.getId() == null) continue;
            if (n.getStatus() != null && !Long.valueOf(1L).equals(n.getStatus())) continue;
            active.add(n);
        }
        if (active.isEmpty()) return null;
        List<CmsTopicNode> ordered = RoutePlayOrder.sort(active, chapters);
        return ordered.isEmpty() ? null : ordered.get(0);
    }

    /** 判定给定 nodeId 是否为主题的第 1 站。 */
    public static boolean isFirstStation(Long nodeId, List<CmsTopicNode> nodes, List<CmsTopicChapter> chapters) {
        if (nodeId == null || nodeId <= 0L) return false;
        Long firstId = firstStationId(nodes, chapters);
        return firstId != null && firstId.equals(nodeId);
    }

    /** 剥离试玩态第 2 站及之后的所有剧情、题目、提示与玩法字段，仅保留站名与路线锁定占位。 */
    public static void stripLockedTrialNode(Map<String, Object> nodeView) {
        if (nodeView == null) return;
        nodeView.keySet().removeAll(TRIAL_STRIPPED_NODE_FIELDS);
        nodeView.put("imgUrl", null);
        nodeView.put(StationImageVisibility.HIDDEN_FIELD, true);
        nodeView.put("address", null);
        nodeView.put("addressHidden", true);
        nodeView.put("locked", true);
        nodeView.put("trialLocked", true);
        nodeView.put("hasGame", false);
        nodeView.put("needAnswer", false);
        nodeView.put("needScan", false);
        nodeView.put("needGps", false);
        nodeView.put("validationMethod", null);
    }

    /**
     * 试玩态章节防剧透：
     * <ul>
     *   <li>第 1 站所在章：仅保留至第 1 站（含）为止的 blocks，剔除第 2 站及之后的节点块与后续剧情。</li>
     *   <li>后续章节：剥离正文、blocks、音频与奖励文案，仅保留章节名与排序，并打上 {@code trialLocked=true}。</li>
     * </ul>
     */
    @SuppressWarnings("unchecked")
    public static List<Map<String, Object>> gateTrialChapters(List<Map<String, Object>> chapters,
            Long trialStationId, Long trialChapterId) {
        if (chapters == null) return Collections.emptyList();
        List<Map<String, Object>> out = new ArrayList<>();
        for (int i = 0; i < chapters.size(); i++) {
            Map<String, Object> chapter = chapters.get(i);
            if (chapter == null) continue;
            Long cid = parseLong(chapter.get("chapterId"));
            boolean isTrialChapter = (trialChapterId != null && trialChapterId.equals(cid))
                    || (trialChapterId == null && i == 0);
            if (!isTrialChapter) {
                Map<String, Object> locked = new LinkedHashMap<>();
                locked.put("chapterId", chapter.get("chapterId"));
                locked.put("name", chapter.get("name"));
                locked.put("sortId", chapter.get("sortId"));
                locked.put("description", null);
                locked.put("blocks", Collections.emptyList());
                locked.put("audioUrl", null);
                locked.put("rewardText", null);
                locked.put("chapterLocked", true);
                locked.put("trialLocked", true);
                out.add(locked);
                continue;
            }
            Map<String, Object> open = new LinkedHashMap<>(chapter);
            open.put("chapterLocked", false);
            open.put("trialLocked", false);
            Object rawBlocks = open.get("blocks");
            if (rawBlocks instanceof List<?> blockList && trialStationId != null) {
                List<Object> kept = new ArrayList<>();
                for (Object item : blockList) {
                    if (item instanceof Map<?, ?> blockMap) {
                        Long blockNodeId = parseLong(blockMap.get("nodeId"));
                        if (blockNodeId != null && !trialStationId.equals(blockNodeId)) {
                            // 遇到第 2 站及之后的节点块，截断后续剧情以防剧透
                            break;
                        }
                    }
                    kept.add(item);
                }
                open.put("blocks", kept);
            }
            out.add(open);
        }
        return out;
    }

    private static Long parseLong(Object raw) {
        if (raw == null) return null;
        if (raw instanceof Number n) return n.longValue();
        try {
            String s = String.valueOf(raw).trim();
            return s.isEmpty() ? null : Long.valueOf(s);
        } catch (NumberFormatException ignored) {
            return null;
        }
    }
}
