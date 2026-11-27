package com.chengyinhub.business.service.support;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.List;

/**
 * §4.3 自由探索弹性 1-4 店与 N 选 K（N-choose-K）权益池策略与容量算法。
 *
 * <p>零 DDL：规则存储在既有 {@code cms_topic.complete_rule_json}（如 {@code {"poolChooseK":2}}）
 * 并在开售时冻结进 {@link com.chengyinhub.business.domain.snapshot.TopicSaleCanonicalV1} 的
 * {@code completionPolicy.poolChooseK}。
 *
 * <p>容量口径：
 * <ul>
 *   <li>非池化主题（{@code poolChooseK == null}）：沿用原有木桶公式 {@code min(cap_i)}；</li>
 *   <li>N 选 K 权益池：有效有余量（或非配额档有生效商家）的门店数须 ≥ K，否则返 0；
 *       满足时配额档可售容量按 {@code floor(sum(max(0, cap_i)) / K)} 计算，单店售罄不拖停整套票。</li>
 * </ul>
 */
public final class FreeExplorePoolPolicy {

    public static final int MIN_FLEXIBLE_STORES = 1;
    public static final int MAX_FLEXIBLE_STORES = 4;

    private static final ObjectMapper JSON = new ObjectMapper();

    private FreeExplorePoolPolicy() {
    }

    /** 弹性门店数是否落在 1-4 店区间内。 */
    public static boolean isValidFlexibleStoreCount(int storeCount) {
        return storeCount >= MIN_FLEXIBLE_STORES && storeCount <= MAX_FLEXIBLE_STORES;
    }

    /**
     * 从 {@code cms_topic.complete_rule_json} 读取 N 选 K 的 K 值（键名支持 {@code poolChooseK} / {@code chooseK}）。
     * 未配置返回 null；配置了但格式损坏或 ≤ 0 抛出 IllegalArgumentException（fail-closed）。
     */
    public static Integer resolveChooseK(String completeRuleJson) {
        if (completeRuleJson == null || completeRuleJson.trim().isEmpty()) {
            return null;
        }
        try {
            return resolveChooseK(JSON.readTree(completeRuleJson));
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalArgumentException("主题完成规则 JSON 损坏", e);
        }
    }

    /** 从已解析的 JSON 节点读取 {@code poolChooseK} / {@code chooseK}。未配置返回 null。 */
    public static Integer resolveChooseK(JsonNode node) {
        if (node == null || !node.isObject()) {
            return null;
        }
        JsonNode raw = node.has("poolChooseK") ? node.get("poolChooseK")
                : (node.has("chooseK") ? node.get("chooseK") : null);
        if (raw == null || raw.isNull()) {
            return null;
        }
        if (!raw.isIntegralNumber() || !raw.canConvertToInt()) {
            throw new IllegalArgumentException("poolChooseK 必须为正整数");
        }
        int k = raw.asInt();
        if (k < MIN_FLEXIBLE_STORES) {
            throw new IllegalArgumentException("poolChooseK 必须至少为 1");
        }
        return k;
    }

    /**
     * N 选 K 权益池可售容量：{@code sum(max(0, cap_i)) / K}（前提：可用门店数 ≥ K）。
     *
     * @param quotaChapterCaps     配额档各门店剩余可售容量列表
     * @param nonQuotaLiveChapters 非配额档（TRAFFIC/REVSHARE）且有生效商家的章节数
     * @param chooseK              玩家须任选的门店数 K
     * @return 可售套票份数；不足 K 家可用时返回 0；全为非配额档且 ≥ K 家可用时返回 Integer.MAX_VALUE
     */
    public static int poolSellableCapacity(List<Integer> quotaChapterCaps, int nonQuotaLiveChapters, int chooseK) {
        if (chooseK <= 0) {
            return 0;
        }
        int activeQuota = 0;
        long sumCap = 0L;
        if (quotaChapterCaps != null) {
            for (Integer cap : quotaChapterCaps) {
                if (cap != null && cap > 0) {
                    activeQuota++;
                    sumCap += cap;
                }
            }
        }
        int activeTotal = activeQuota + Math.max(0, nonQuotaLiveChapters);
        if (activeTotal < chooseK) {
            return 0;
        }
        if (quotaChapterCaps == null || quotaChapterCaps.isEmpty()) {
            return Integer.MAX_VALUE;
        }
        long sellable = sumCap / chooseK;
        return (int) Math.min(Integer.MAX_VALUE, Math.max(0L, sellable));
    }
}
