package com.chengyinhub.business.service.impl;

import com.chengyinhub.business.domain.CmsTopic;
import com.chengyinhub.business.domain.CmsTopicChapter;
import com.chengyinhub.business.domain.CmsTopicNode;
import com.chengyinhub.business.domain.CoopPerkTemplate;
import com.chengyinhub.business.domain.MerchantChapterApplication;
import com.chengyinhub.business.domain.MerchantChapterOffer;
import com.chengyinhub.business.domain.MmsMerchant;
import com.chengyinhub.business.domain.dto.MerchantFeQuickJoinDTO;
import com.chengyinhub.business.mapper.CmsTopicChapterMapper;
import com.chengyinhub.business.mapper.CmsTopicMapper;
import com.chengyinhub.business.mapper.MerchantChapterApplicationMapper;
import com.chengyinhub.business.mapper.MmsMerchantMapper;
import com.chengyinhub.business.service.IChapterMerchantNodeService;
import com.chengyinhub.business.service.ICoopInviteService;
import com.chengyinhub.business.service.IMerchantChapterApplicationService;
import com.chengyinhub.business.service.IMerchantFeQuickJoinService;
import com.chengyinhub.business.service.IMerchantOfferService;
import com.chengyinhub.business.service.support.OfferRedeemLimits;
import com.chengyinhub.common.constant.ProductType;
import com.chengyinhub.common.constant.TermsMode;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * §4.3 商家 5 分钟 4 字段快速加入自由探索聚合服务。
 *
 * <p>严格校验商家归属与邀请/申请权限：
 * <ul>
 *   <li>ownerMemberId 必须来自服务端登录与 {@code IMerchantAccessService} 鉴权，绝不信任客户端传参；</li>
 *   <li>传入 applicationId 时必须严格核对 {@code merchantId == ownerMemberId && chapterId == request.chapterId}；</li>
 *   <li>未受邀且未开招商的章节一律拒绝；自申请（非受邀）不会绕过主办方审批。</li>
 * </ul>
 */
@Service
public class MerchantFeQuickJoinServiceImpl implements IMerchantFeQuickJoinService {

    static final int DEFAULT_QUOTA_DAYS = 30;
    static final int DEFAULT_QUOTA_TOTAL = 30;
    static final int DAILY_CAP_MAX = 99999;
    static final int PERK_DESC_MAX = 64;
    static final BigDecimal MAX_AMOUNT = new BigDecimal("99999999.99");

    private final CmsTopicChapterMapper chapterMapper;
    private final CmsTopicMapper topicMapper;
    private final MmsMerchantMapper merchantMapper;
    private final MerchantChapterApplicationMapper applicationMapper;
    private final IMerchantChapterApplicationService applicationService;
    private final IChapterMerchantNodeService chapterMerchantNodeService;
    private final ICoopInviteService coopInviteService;
    private final IMerchantOfferService merchantOfferService;

    @Autowired
    public MerchantFeQuickJoinServiceImpl(CmsTopicChapterMapper chapterMapper,
                                          CmsTopicMapper topicMapper,
                                          MmsMerchantMapper merchantMapper,
                                          MerchantChapterApplicationMapper applicationMapper,
                                          IMerchantChapterApplicationService applicationService,
                                          IChapterMerchantNodeService chapterMerchantNodeService,
                                          ICoopInviteService coopInviteService,
                                          IMerchantOfferService merchantOfferService) {
        this.chapterMapper = chapterMapper;
        this.topicMapper = topicMapper;
        this.merchantMapper = merchantMapper;
        this.applicationMapper = applicationMapper;
        this.applicationService = applicationService;
        this.chapterMerchantNodeService = chapterMerchantNodeService;
        this.coopInviteService = coopInviteService;
        this.merchantOfferService = merchantOfferService;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public Map<String, Object> quickJoin(Long ownerMemberId, MerchantFeQuickJoinDTO request) {
        if (ownerMemberId == null || ownerMemberId <= 0) {
            throw new IllegalStateException("请先登录");
        }
        if (request == null || request.getChapterId() == null || request.getChapterId() <= 0) {
            throw new IllegalStateException("缺少章节");
        }

        MmsMerchant merchant = requireActiveMerchant(ownerMemberId);
        CmsTopicChapter chapter = chapterMapper.selectCmsTopicChapterById(request.getChapterId());
        if (chapter == null || chapter.getTopicId() == null) {
            throw new IllegalStateException("章节不存在");
        }
        CmsTopic topic = topicMapper.selectCmsTopicById(chapter.getTopicId());
        if (topic == null || Integer.valueOf(2).equals(topic.getDelFlag())
                || !Integer.valueOf(ProductType.FREE_EXPLORE).equals(topic.getProductType())) {
            throw new IllegalStateException("仅支持自由探索路线快速加入");
        }
        if (ownerMemberId.equals(topic.getMemberId())) {
            throw new IllegalStateException("不能以商家身份加入自己发布的路线");
        }

        String termsMode = chapter.getTermsMode() == null ? TermsMode.PERK : chapter.getTermsMode();
        if (!TermsMode.PERK.equals(termsMode) && !TermsMode.TRAFFIC.equals(termsMode)) {
            throw new IllegalStateException("快速加入仅适用于权益或引流合作位置");
        }

        // 1. 校验 4 个白话字段
        String normalizedOffPeakHours;
        try {
            normalizedOffPeakHours = OfferRedeemLimits.normalizeOffPeakHours(request.getOffPeakHours());
        } catch (IllegalArgumentException invalidHours) {
            throw new IllegalStateException(invalidHours.getMessage());
        }
        Integer dailyCap = request.getDailyCap();
        if (dailyCap != null && (dailyCap < 1 || dailyCap > DAILY_CAP_MAX)) {
            throw new IllegalStateException("每日接待上限须为 1 至 " + DAILY_CAP_MAX + " 的整数");
        }

        String perkDescription = trimToNull(request.getPerkDescription());
        BigDecimal originalPrice = request.getOriginalPrice();
        if (TermsMode.PERK.equals(termsMode)) {
            if (perkDescription == null) {
                throw new IllegalStateException("请填写给玩家的到店福利内容");
            }
            if (perkDescription.codePointCount(0, perkDescription.length()) > PERK_DESC_MAX) {
                throw new IllegalStateException("到店福利内容不能超过 " + PERK_DESC_MAX + " 字");
            }
            if (!validPositiveAmount(originalPrice)) {
                throw new IllegalStateException("请填写有效的门店原价（最多两位小数）");
            }
            if (chapter.getPerkMinValue() != null && originalPrice.compareTo(chapter.getPerkMinValue()) < 0) {
                throw new IllegalStateException("该位置要求福利原价不低于 "
                        + chapter.getPerkMinValue().stripTrailingZeros().toPlainString() + " 元");
            }
        }

        String resolvedPhoto = resolveStorefrontPhoto(request.getStorefrontPhoto(), merchant);

        // 2. 严格校验邀请/申请归属与章节授权
        MerchantChapterApplication application = resolveOrCreateApplication(ownerMemberId, chapter, request.getApplicationId());
        boolean approved = Integer.valueOf(MerchantChapterApplication.STATUS_APPROVED).equals(application.getStatus());

        if (approved && TermsMode.PERK.equals(termsMode) && !Boolean.TRUE.equals(request.getTermsAgreed())) {
            throw new IllegalStateException("请先勾选同意合作条款");
        }

        // 3. 保存门店节点（PERK/TRAFFIC 允许 templateId=null，不强迫建玩法模板）
        CmsTopicNode nodeDraft = new CmsTopicNode();
        nodeDraft.setName(merchant.getName().trim());
        nodeDraft.setAddress(merchant.getAddress().trim());
        nodeDraft.setLongitude(String.valueOf(merchant.getLocationLng()));
        nodeDraft.setLatitude(String.valueOf(merchant.getLocationLat()));
        nodeDraft.setImgUrl(resolvedPhoto);
        nodeDraft.setBusinessTime(merchant.getBusinessTime());
        nodeDraft.setTemplateId(null);
        CmsTopicNode savedNode = chapterMerchantNodeService.submit(ownerMemberId, chapter.getId(), nodeDraft);

        // 4. PERK 档：把 4 字段映射为常备权益模板 + OfferRedeemLimits 核销规则
        Long perkTemplateId = null;
        Integer resolvedQuota = null;
        if (TermsMode.PERK.equals(termsMode)) {
            resolvedQuota = resolveQuotaTotal(request.getQuotaTotal(), dailyCap);
            CoopPerkTemplate tpl = new CoopPerkTemplate();
            tpl.setMerchantId(ownerMemberId);
            tpl.setName(perkDescription);
            tpl.setPerkType(0);
            tpl.setRetailValue(originalPrice);
            tpl.setUnitCost(BigDecimal.ZERO);
            tpl.setQuota(resolvedQuota);
            tpl.setRedeemRule(OfferRedeemLimits.composeRedeemRule(normalizedOffPeakHours, dailyCap));
            tpl.setValidEnd(defaultValidEnd(topic));
            perkTemplateId = coopInviteService.savePerkTemplate(tpl);
        }

        // 5. 若为受邀（刚接受）或已通过申请，同事务落生效供给 offer；自申请待审不绕过主办审批。
        Long offerId = null;
        if (approved) {
            MerchantChapterOffer offer = new MerchantChapterOffer();
            offer.setChapterId(chapter.getId());
            offer.setTermsMode(termsMode);
            if (TermsMode.PERK.equals(termsMode)) {
                offer.setPerkTemplateId(perkTemplateId);
                offer.setQuotaTotal(resolvedQuota);
                offer.setIncluded(1);
                offer.setReserveRequired(0);
                offer.setDailyCapacity(dailyCap);
                offer.setStorefrontImg(resolvedPhoto);
                offer.setTermsAgreed(true);
            } else {
                offer.setStorefrontImg(resolvedPhoto);
            }
            offerId = merchantOfferService.enroll(offer, ownerMemberId);
        }

        Map<String, Object> redeemLimits = new LinkedHashMap<>();
        redeemLimits.put("dailyCapacity", dailyCap);
        redeemLimits.put("offPeakHours", normalizedOffPeakHours);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("status", approved ? "JOINED" : "PENDING_APPROVAL");
        result.put("chapterId", chapter.getId());
        result.put("topicId", topic.getId());
        result.put("termsMode", termsMode);
        result.put("applicationId", application.getId());
        result.put("nodeId", savedNode == null ? null : savedNode.getId());
        result.put("offerId", offerId);
        result.put("perkTemplateId", perkTemplateId);
        result.put("storefrontPhoto", resolvedPhoto);
        result.put("redeemLimits", redeemLimits);
        return result;
    }

    private MerchantChapterApplication resolveOrCreateApplication(Long ownerMemberId, CmsTopicChapter chapter,
                                                                  Long applicationId) {
        MerchantChapterApplication application;
        if (applicationId != null) {
            application = applicationMapper.selectMerchantChapterApplicationById(applicationId);
            if (application == null
                    || !ownerMemberId.equals(application.getMerchantId())
                    || !chapter.getId().equals(application.getChapterId())
                    || !Integer.valueOf(0).equals(application.getDelFlag())) {
                throw new IllegalStateException("邀请或申请不存在或不属于当前商家");
            }
        } else {
            application = applicationMapper.selectByChapterAndMerchant(chapter.getId(), ownerMemberId);
        }

        if (application != null && Integer.valueOf(0).equals(application.getDelFlag())) {
            if (Integer.valueOf(MerchantChapterApplication.SOURCE_INVITE).equals(application.getSource())
                    && Integer.valueOf(MerchantChapterApplication.STATUS_PENDING).equals(application.getStatus())) {
                return applicationService.respondInvite(application.getId(), ownerMemberId, true);
            }
            if (Integer.valueOf(MerchantChapterApplication.STATUS_APPROVED).equals(application.getStatus())
                    || Integer.valueOf(MerchantChapterApplication.STATUS_PENDING).equals(application.getStatus())) {
                return application;
            }
        }

        if (!Integer.valueOf(1).equals(chapter.getRecruitEnabled())) {
            throw new IllegalStateException("本章节未开放自主报名，仅受邀商家可快速加入");
        }
        return applicationService.apply(chapter.getId(), ownerMemberId, null);
    }

    private MmsMerchant requireActiveMerchant(Long ownerMemberId) {
        MmsMerchant merchant = merchantMapper.selectMmsMerchantByMemberId(ownerMemberId);
        if (merchant == null || !Integer.valueOf(0).equals(merchant.getDelFlag())
                || !Long.valueOf(1L).equals(merchant.getStatus())
                || !Long.valueOf(1L).equals(merchant.getAccountStatus())) {
            throw new IllegalStateException("仅审核通过且启用的商家可快速加入路线");
        }
        if (trimToNull(merchant.getName()) == null) {
            throw new IllegalStateException("请先在店铺资料中补全店铺名称");
        }
        if (trimToNull(merchant.getAddress()) == null
                || merchant.getLocationLat() == null || merchant.getLocationLng() == null
                || !Double.isFinite(merchant.getLocationLat()) || !Double.isFinite(merchant.getLocationLng())) {
            throw new IllegalStateException("请先在店铺资料中确认门店地图位置");
        }
        return merchant;
    }

    static String resolveStorefrontPhoto(String requested, MmsMerchant merchant) {
        String candidate = trimToNull(requested);
        if (candidate == null && merchant != null) {
            candidate = trimToNull(merchant.getCoverImage());
            if (candidate == null && merchant.getDerivatives() != null) {
                for (String part : merchant.getDerivatives().split(",")) {
                    String trimmed = trimToNull(part);
                    if (trimmed != null) {
                        candidate = trimmed;
                        break;
                    }
                }
            }
            if (candidate == null) {
                candidate = trimToNull(merchant.getLogo());
            }
        }
        if (candidate != null && (candidate.length() > 500 || candidate.indexOf(',') >= 0 || candidate.indexOf(';') >= 0
                || candidate.chars().anyMatch(c -> Character.isWhitespace(c) || c == '<' || c == '>' || c == '"' || c == '\''))) {
            throw new IllegalStateException("门头照片地址不正确，请重新上传一张");
        }
        return candidate;
    }

    static int resolveQuotaTotal(Integer explicitQuota, Integer dailyCap) {
        if (explicitQuota != null) {
            if (explicitQuota < 1 || explicitQuota > DAILY_CAP_MAX) {
                throw new IllegalStateException("总核销份数须为 1 至 " + DAILY_CAP_MAX + " 的整数");
            }
            return explicitQuota;
        }
        if (dailyCap != null && dailyCap > 0) {
            long derived = (long) dailyCap * DEFAULT_QUOTA_DAYS;
            return (int) Math.min(derived, DAILY_CAP_MAX);
        }
        return DEFAULT_QUOTA_TOTAL;
    }

    static Date defaultValidEnd(CmsTopic topic) {
        Date now = new Date();
        if (topic != null && topic.getEndDate() != null && topic.getEndDate().after(now)) {
            return topic.getEndDate();
        }
        return new Date(now.getTime() + 90L * 86400_000L);
    }

    private static boolean validPositiveAmount(BigDecimal value) {
        if (value == null || value.signum() <= 0 || value.compareTo(MAX_AMOUNT) > 0) {
            return false;
        }
        return value.stripTrailingZeros().scale() <= 2;
    }

    private static String trimToNull(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
