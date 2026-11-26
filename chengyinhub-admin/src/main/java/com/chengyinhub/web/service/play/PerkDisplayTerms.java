package com.chengyinhub.web.service.play;

import com.chengyinhub.business.domain.CmsTopicNode;
import com.chengyinhub.business.domain.MerchantChapterOffer;
import com.chengyinhub.business.mapper.MerchantChapterOfferMapper;
import com.chengyinhub.business.service.support.OfferRedeemLimits;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * /api/play/nodes 的只读附加字段,全部是加字段、不改既有判定:
 * <ul>
 *   <li>FE-G5:「本店权益」的展示条款(含在票内 / 另付说明 / 需预约);读不到(含未落迁移的库)只让这几项缺席。</li>
 *   <li>FE-G7:主题级 perkOnly —— 下发的节点里没有任何一个带玩法(hasGame)时为 true。</li>
 * </ul>
 */
final class PerkDisplayTerms {
    private static final Logger log = LoggerFactory.getLogger(PerkDisplayTerms.class);

    private PerkDisplayTerms() {
    }

    static Map<String, MerchantChapterOffer> load(MerchantChapterOfferMapper mapper, List<CmsTopicNode> nodes) {
        if (mapper == null || nodes == null || nodes.isEmpty()) return Collections.emptyMap();
        List<Long> chapterIds = new ArrayList<>();
        for (CmsTopicNode n : nodes) {
            if (n != null && n.getChapterId() != null && !chapterIds.contains(n.getChapterId())) chapterIds.add(n.getChapterId());
        }
        if (chapterIds.isEmpty()) return Collections.emptyMap();
        try {
            Map<String, MerchantChapterOffer> out = new HashMap<>();
            List<MerchantChapterOffer> rows = mapper.selectLiveDisplayByChapterIds(chapterIds);
            for (MerchantChapterOffer offer : rows == null ? Collections.<MerchantChapterOffer>emptyList() : rows) {
                if (offer == null || offer.getChapterId() == null || offer.getMerchantId() == null) continue;
                out.put(offer.getChapterId() + ":" + offer.getMerchantId(), offer);
            }
            return out;
        } catch (RuntimeException e) {
            log.warn("本店权益展示条款读取失败 chapters={}", chapterIds, e);
            return Collections.emptyMap();
        }
    }

    static void put(Map<String, Object> perk, MerchantChapterOffer terms) {
        if (perk == null || terms == null) return;
        if (terms.getIncluded() != null) perk.put("included", terms.getIncluded() == 1);
        if (terms.getExtraSpendText() != null) perk.put("extraSpendText", terms.getExtraSpendText());
        if (terms.getReserveRequired() != null) perk.put("reserveRequired", terms.getReserveRequired() == 1);
        if (terms.getDailyCapacity() != null) perk.put("dailyCapacity", terms.getDailyCapacity());
        if (terms.getValidStart() != null) {
            perk.put("validStart", new java.text.SimpleDateFormat("yyyy-MM-dd").format(terms.getValidStart()));
        }
        if (terms.getSoldOutRuleText() != null) perk.put("soldOutRuleText", terms.getSoldOutRuleText());
    }

    /**
     * 这些供给里设了每日名额的,今天已核销几份(键 = 供给 id)。没有任何供给设每日名额时不查库;
     * 读失败(含未落迁移的库)按空,玩家端只是不显示「今日名额已满」,核销闸仍在服务端。
     */
    static Map<Long, Integer> dailyUsed(MerchantChapterOfferMapper mapper, Map<String, MerchantChapterOffer> terms,
                                        java.time.LocalDate today) {
        if (mapper == null || terms == null || terms.isEmpty() || today == null) return Collections.emptyMap();
        List<Long> offerIds = new ArrayList<>();
        for (MerchantChapterOffer offer : terms.values()) {
            if (offer != null && offer.getId() != null && offer.getDailyCapacity() != null) offerIds.add(offer.getId());
        }
        if (offerIds.isEmpty()) return Collections.emptyMap();
        try {
            Map<Long, Integer> out = new HashMap<>();
            List<Map<String, Object>> rows = mapper.selectDailyUsedByOfferIds(offerIds, today.toString());
            for (Map<String, Object> row : rows == null ? Collections.<Map<String, Object>>emptyList() : rows) {
                if (row != null && row.get("offerId") instanceof Number id && row.get("usedToday") instanceof Number used) {
                    out.put(id.longValue(), used.intValue());
                }
            }
            return out;
        } catch (RuntimeException e) {
            log.warn("每日已核销份数读取失败 offers={}", offerIds, e);
            return Collections.emptyMap();
        }
    }

    /**
     * 玩家端核销码处的「现在不能核销」文案,与柜台核销被拒时同一句(OfferRedeemLimits);可核销 = 不带该键。
     * 已核销过这一章的玩家端上本来就不再出码,这里只按供给当前状态给出。
     */
    static void putRedeemBlocked(Map<String, Object> perk, MerchantChapterOffer terms, Map<Long, Integer> dailyUsed,
                                 java.time.LocalDate today) {
        if (perk == null || terms == null) return;
        Integer used = dailyUsed == null || terms.getId() == null ? null : dailyUsed.get(terms.getId());
        java.time.LocalDate start = terms.getValidStart() == null ? null
                : OfferRedeemLimits.parseDate(new java.text.SimpleDateFormat("yyyy-MM-dd").format(terms.getValidStart()));
        String text = OfferRedeemLimits.rejection(terms.getDailyCapacity(), start, used == null ? 0 : used, today);
        if (text != null) perk.put("redeemBlockedText", text);
    }

    /** 门店照片(承接方写权益时上传的那一张);没有 = null,调用方保持原图。 */
    static String storefront(MerchantChapterOffer terms) {
        String img = terms == null || terms.getStorefrontImg() == null ? "" : terms.getStorefrontImg().trim();
        return img.isEmpty() ? null : img;
    }

    /** 章节卡图:该章生效供给的门店照片优先(按供给 id 取第一张),没有就保持章节原图。 */
    static Object chapterImg(Map<String, MerchantChapterOffer> terms, Long chapterId, Object fallback) {
        if (terms == null || chapterId == null) return fallback;
        MerchantChapterOffer first = null;
        for (MerchantChapterOffer offer : terms.values()) {
            if (offer == null || !chapterId.equals(offer.getChapterId()) || storefront(offer) == null) continue;
            if (first == null || (offer.getId() != null && first.getId() != null && offer.getId() < first.getId())) first = offer;
        }
        return first == null ? fallback : storefront(first);
    }

    static final String SUPPLY_WITHDRAWN = "WITHDRAWN";
    static final String SUPPLY_REPLACING = "REPLACING";

    /**
     * P1-9:节点所属店铺的供给已退出时的状态,键同 load()(chapterId:merchantId)。
     * WITHDRAWN = 已退出、暂无补位;REPLACING = 已有进行中的补位。uk_offer_merchant_chapter 保证
     * 同一(章节, 商家)只有一行,所以「有退出行」即「这家店在本章没有生效供给」。读失败只让字段缺席。
     */
    static Map<String, String> supplyStates(MerchantChapterOfferMapper mapper, List<CmsTopicNode> nodes) {
        if (mapper == null || nodes == null || nodes.isEmpty()) return Collections.emptyMap();
        List<Long> chapterIds = new ArrayList<>();
        for (CmsTopicNode n : nodes) {
            if (n != null && n.getChapterId() != null && n.getMerchantMemberId() != null
                    && !chapterIds.contains(n.getChapterId())) chapterIds.add(n.getChapterId());
        }
        if (chapterIds.isEmpty()) return Collections.emptyMap();
        try {
            Map<String, String> out = new HashMap<>();
            List<Map<String, Object>> rows = mapper.selectWithdrawnByChapterIds(chapterIds);
            for (Map<String, Object> row : rows == null ? Collections.<Map<String, Object>>emptyList() : rows) {
                if (row == null || row.get("chapterId") == null || row.get("merchantId") == null) continue;
                boolean replacing = row.get("replacing") instanceof Number n && n.intValue() == 1;
                out.put(row.get("chapterId") + ":" + row.get("merchantId"), replacing ? SUPPLY_REPLACING : SUPPLY_WITHDRAWN);
            }
            return out;
        } catch (RuntimeException e) {
            log.warn("门店供给状态读取失败 chapters={}", chapterIds, e);
            return Collections.emptyMap();
        }
    }

    /**
     * FE-G7:主题级「只有权益、没有游戏」。只有自由定向(playMode=2)才会逐节点算 hasGame,
     * 所以只在该模式、且每个下发节点都明确 hasGame=false 时为 true;其它模式恒 false;空列表 null(不下结论)。
     */
    static Boolean perkOnly(int playMode, Object nodes) {
        if (!(nodes instanceof List<?> list) || list.isEmpty()) return null;
        if (playMode != 2) return Boolean.FALSE;
        for (Object node : list) {
            if (!(node instanceof Map<?, ?> m) || !Boolean.FALSE.equals(m.get("hasGame"))) return Boolean.FALSE;
        }
        return Boolean.TRUE;
    }
}
