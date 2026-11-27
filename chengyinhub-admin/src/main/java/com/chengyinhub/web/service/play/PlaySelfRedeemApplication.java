package com.chengyinhub.web.service.play;

import com.chengyinhub.business.domain.CmsActivity;
import com.chengyinhub.business.domain.CmsRegistration;
import com.chengyinhub.business.domain.CmsTopicNode;
import com.chengyinhub.business.domain.vo.ExploreChapterRedemptionResult;
import com.chengyinhub.business.service.ICmsActivityService;
import com.chengyinhub.business.service.ICmsRegistrationService;
import com.chengyinhub.business.service.ICmsTopicNodeService;
import com.chengyinhub.business.service.IExploreCollectibleService;
import com.chengyinhub.business.service.IGrowthService;
import com.chengyinhub.business.service.IPerkLedgerService;
import com.chengyinhub.business.service.IPlayCheckinCodeService;
import com.chengyinhub.business.service.IPointsAwardService;
import com.chengyinhub.business.service.support.ExploreTicketUsePolicy;
import com.chengyinhub.common.constant.PlayMode;
import com.chengyinhub.common.constant.PurchaseKind;
import com.chengyinhub.common.core.domain.AjaxResult;
import com.chengyinhub.common.exception.RedeemLimitRejectedException;
import com.chengyinhub.common.utils.OwnershipUtils;
import com.chengyinhub.common.utils.StringUtils;
import com.chengyinhub.common.utils.UserSafeMessage;
import com.chengyinhub.web.service.play.PlayNodeContext.PlayCtx;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * §4.2 柜台台卡自助核销(玩家扫门店台卡二维码 → 原子核销本人探索票本章权益 → 返回脱敏昵称+权益名+当日核销序号)。
 *
 * <p>严格保留所有安全与归属闸:
 * <ul>
 *   <li>只认当前登录会员本人名下、已支付生效(registrationStatus=2 &amp; paymentStatus=2)的探索票(EXPLORE_PASS);</li>
 *   <li>台卡码必须唯一命中当前主题在架商家节点(支持一次性动态台卡码与店内静态 checkinCode);</li>
 *   <li>核销事务复用 {@link ICmsRegistrationService#redeemExploreChapterAndRecord} (同一 CAS/名额/每日上限/幂等台账);</li>
 *   <li>响应只带脱敏昵称(playerName)与权益名(perkTitle)、当日序号(dailySerialNo),绝不透传手机号或未脱敏 PII。</li>
 * </ul>
 */
@Service
public class PlaySelfRedeemApplication {
    private static final Logger logger = LoggerFactory.getLogger(PlaySelfRedeemApplication.class);
    static final String ACTOR_ROLE_SELF_REDEEM = "PLAYER_SELF_REDEEM";

    @Autowired
    private ICmsTopicNodeService cmsTopicNodeService;
    @Autowired(required = false)
    private IPlayCheckinCodeService playCheckinCodeService;
    @Autowired
    private PlayNodeContext playNodeContext;
    @Autowired
    private PlayCompletionFacts playCompletionFacts;
    @Autowired
    private ICmsActivityService cmsActivityService;
    @Autowired
    private ICmsRegistrationService cmsRegistrationService;
    @Autowired
    private IPerkLedgerService perkLedgerService;
    @Autowired(required = false)
    private IPointsAwardService pointsAwardService;
    @Autowired(required = false)
    private IGrowthService growthService;
    @Autowired(required = false)
    private IExploreCollectibleService exploreCollectibleService;

    public AjaxResult selfRedeem(Long actorMemberId, String activityId, String topicId,
                                 String code, Long expectedNodeId, Long registrationId) {
        if (actorMemberId == null || actorMemberId <= 0) {
            return AjaxResult.error("请先登录");
        }
        if (StringUtils.isBlank(code) || (StringUtils.isBlank(activityId) && StringUtils.isBlank(topicId))) {
            return AjaxResult.error("参数有误");
        }
        String trimmedCode = code.trim();
        CmsTopicNode node = null;
        boolean liveCode = false;
        if (playCheckinCodeService != null) {
            IPlayCheckinCodeService.ConsumeResult live = playCheckinCodeService.inspect(trimmedCode);
            if (live != null && (live.kind == IPlayCheckinCodeService.ConsumeResult.Kind.USED
                    || live.kind == IPlayCheckinCodeService.ConsumeResult.Kind.EXPIRED)) {
                return AjaxResult.error(live.message);
            }
            if (live != null && live.kind == IPlayCheckinCodeService.ConsumeResult.Kind.OK) {
                liveCode = true;
                node = cmsTopicNodeService.selectCmsTopicNodeById(live.nodeId);
                if (node == null) return AjaxResult.error("台卡对应门店不存在");
            }
        }
        if (node == null) {
            CmsTopicNode probe = new CmsTopicNode();
            probe.setCheckinCode(trimmedCode);
            List<CmsTopicNode> matched = cmsTopicNodeService.selectCmsTopicNodeList(probe);
            if (matched == null || matched.isEmpty()) {
                return AjaxResult.error("无效的门店台卡二维码");
            }
            if (matched.size() > 1) {
                logger.warn("台卡二维码命中多个节点,拒绝自助核销 nodeCount={}", matched.size());
                return AjaxResult.error("该台卡码对应多个门店，请联系店员处理");
            }
            node = matched.get(0);
        }
        if (expectedNodeId != null && !expectedNodeId.equals(node.getId())) {
            return AjaxResult.error("这不是当前门店的台卡二维码");
        }
        if (playNodeContext.isDelistedNode(node)) {
            return AjaxResult.error("该门店已下架，暂不可自助核销");
        }
        if (node.getMerchantMemberId() == null || node.getMerchantMemberId() <= 0
                || node.getChapterId() == null || node.getChapterId() <= 0) {
            return AjaxResult.error("该站点不支持台卡自助核销");
        }

        PlayCtx ctx = playNodeContext.resolveCtx(actorMemberId, activityId, topicId, node, registrationId);
        if (ctx.error != null) return ctx.error;
        if (playNodeContext.resolveMode(ctx.actId, ctx.topicId) != PlayMode.FREE_COLLECT) {
            return AjaxResult.error("当前路线不支持台卡自助核销");
        }

        CmsRegistration reg = resolveOwnedExploreRegistration(actorMemberId, ctx, registrationId);
        if (reg == null) {
            return AjaxResult.error("未找到您本人可核销的有效探索票");
        }
        if (OwnershipUtils.notOwner(reg.getMemberId(), actorMemberId)) {
            return AjaxResult.error("无权操作该报名单");
        }
        if (!Integer.valueOf(2).equals(reg.getRegistrationStatus())
                || !Integer.valueOf(2).equals(reg.getPaymentStatus())) {
            return AjaxResult.error("订单未完成支付或已退款，无法核销");
        }
        if (!Integer.valueOf(PurchaseKind.EXPLORE_PASS).equals(reg.getPurchaseKind())) {
            return AjaxResult.error("该订单不支持门店台卡自助核销");
        }
        CmsActivity activity = reg.getOwnerId() == null ? null : cmsActivityService.selectCmsActivityById(reg.getOwnerId());
        if (activity == null) {
            return AjaxResult.error("活动不存在");
        }
        if (activity.getTopicId() == null || !activity.getTopicId().equals(ctx.topicId)) {
            return AjaxResult.error("该探索票不属于当前路线");
        }
        String expiryRejection = ExploreTicketUsePolicy.rejection(reg.getPurchaseKind(), activity.getEndDate(), new Date());
        if (expiryRejection != null) {
            return AjaxResult.error(expiryRejection);
        }

        if (liveCode) {
            IPlayCheckinCodeService.ConsumeResult consumed = playCheckinCodeService.consume(trimmedCode);
            if (consumed == null || consumed.kind != IPlayCheckinCodeService.ConsumeResult.Kind.OK) {
                return AjaxResult.error(consumed == null ? "台卡二维码已失效，请重新扫码" : consumed.message);
            }
        }

        ExploreChapterRedemptionResult redemption;
        try {
            redemption = cmsRegistrationService.redeemExploreChapterAndRecord(
                    reg, node.getChapterId(), ctx.topicId, node.getMerchantMemberId(),
                    actorMemberId, ACTOR_ROLE_SELF_REDEEM, null);
        } catch (RedeemLimitRejectedException e) {
            return AjaxResult.error(e.getMessage());
        } catch (IllegalStateException e) {
            return AjaxResult.error(e.getMessage());
        } catch (RuntimeException e) {
            logger.error("台卡自助核销失败 registrationId={} chapterId={} merchantId={} memberId={}",
                    reg.getId(), node.getChapterId(), node.getMerchantMemberId(), actorMemberId, e);
            return AjaxResult.error(UserSafeMessage.of(e.getMessage()));
        }

        if (!redemption.isReplayed()) {
            deliverPostRedemptionEffects(reg, ctx.topicId, node);
        }

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("redemptionId", redemption.getRedemptionId());
        data.put("replayed", redemption.isReplayed());
        data.put("nodeId", node.getId());
        data.put("chapterId", node.getChapterId());
        data.put("shopName", StringUtils.isNotBlank(node.getName()) ? node.getName() : "合作门店");
        String perkTitle = safePerkName(node.getChapterId(), node.getMerchantMemberId());
        data.put("perkTitle", StringUtils.isNotBlank(perkTitle) ? perkTitle : data.get("shopName"));
        String maskedName = safeMaskedNickname(actorMemberId, node.getChapterId(), node.getMerchantMemberId());
        if (StringUtils.isNotBlank(maskedName)) {
            data.put("playerName", maskedName);
        }
        data.put("dailySerialNo", resolveDailySerialNo(node.getChapterId(), node.getMerchantMemberId(), redemption.getRedemptionId()));
        data.put("redeemedAt", System.currentTimeMillis());
        if (redemption.getCompletionEarnedXp() > 0) {
            data.put("completionEarnedXp", redemption.getCompletionEarnedXp());
        }
        return AjaxResult.success(redemption.isReplayed() ? "已核销，请向店员出示凭证" : "核销成功", data);
    }

    private CmsRegistration resolveOwnedExploreRegistration(Long actorMemberId, PlayCtx ctx, Long registrationId) {
        if (ctx.registration != null
                && actorMemberId.equals(ctx.registration.getMemberId())
                && Integer.valueOf(PurchaseKind.EXPLORE_PASS).equals(ctx.registration.getPurchaseKind())) {
            return ctx.registration;
        }
        if (registrationId != null && registrationId > 0) {
            CmsRegistration byId = cmsRegistrationService.selectCmsRegistrationById(registrationId);
            if (byId != null && actorMemberId.equals(byId.getMemberId())
                    && Long.valueOf(2L).equals(byId.getOwnerType())
                    && ctx.actId != null && ctx.actId.equals(byId.getOwnerId())) {
                return byId;
            }
            return null;
        }
        return playCompletionFacts.exploreRegistration(actorMemberId, ctx.actId);
    }

    private void deliverPostRedemptionEffects(CmsRegistration reg, Long topicId, CmsTopicNode node) {
        if (pointsAwardService != null) {
            try {
                pointsAwardService.award(reg.getMemberId(), 11L, reg.getId(), "到店核销");
            } catch (Exception e) {
                logger.error("台卡自助核销积分发放失败 registrationId={} member={}", reg.getId(), reg.getMemberId(), e);
            }
        }
        if (growthService != null) {
            try {
                growthService.deliverStoreVerification(reg.getId());
            } catch (Exception e) {
                logger.error("台卡自助核销成长奖励发放失败 registrationId={} member={}", reg.getId(), reg.getMemberId(), e);
            }
        }
        if (exploreCollectibleService != null) {
            try {
                exploreCollectibleService.record(reg.getMemberId(), topicId, node.getChapterId(), node.getMerchantMemberId());
            } catch (Exception e) {
                logger.error("台卡自助核销收藏凭证写入失败 registrationId={} chapterId={}", reg.getId(), node.getChapterId(), e);
            }
        }
        cmsRegistrationService.recordImpliedShopArrival(reg, node.getChapterId(), node.getMerchantMemberId());
    }

    private String safePerkName(Long chapterId, Long merchantId) {
        if (perkLedgerService == null) return null;
        try {
            return perkLedgerService.livePerkName(chapterId, merchantId);
        } catch (RuntimeException e) {
            logger.warn("台卡核销权益名读取失败 chapterId={} merchantId={}", chapterId, merchantId, e);
            return null;
        }
    }

    private String safeMaskedNickname(Long playerMemberId, Long chapterId, Long merchantId) {
        if (perkLedgerService == null) return null;
        try {
            Map<String, Object> info = perkLedgerService.redemptionDeskInfo(playerMemberId, chapterId, merchantId);
            Object name = info == null ? null : info.get("playerName");
            return name == null ? null : String.valueOf(name);
        } catch (RuntimeException e) {
            logger.warn("台卡核销脱敏昵称读取失败 memberId={} chapterId={}", playerMemberId, chapterId, e);
            return null;
        }
    }

    private int resolveDailySerialNo(Long chapterId, Long merchantId, Long redemptionId) {
        if (perkLedgerService != null) {
            try {
                Integer daily = perkLedgerService.dailyRedemptionSerial(chapterId, merchantId);
                if (daily != null && daily > 0) return daily;
            } catch (RuntimeException e) {
                logger.warn("台卡核销当日序号读取失败 chapterId={} merchantId={}", chapterId, merchantId, e);
            }
        }
        if (redemptionId != null && redemptionId > 0) {
            int fallback = (int) (redemptionId % 1000L);
            return fallback > 0 ? fallback : 1;
        }
        return 1;
    }
}
