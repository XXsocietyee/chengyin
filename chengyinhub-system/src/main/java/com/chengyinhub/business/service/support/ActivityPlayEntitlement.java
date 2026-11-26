package com.chengyinhub.business.service.support;

import com.chengyinhub.business.domain.CmsRegistration;
import com.chengyinhub.business.domain.GiftPlayFact;
import com.chengyinhub.business.domain.MarketingCodeGrant;
import com.chengyinhub.business.domain.SeatRecipientFact;
import com.chengyinhub.business.mapper.CmsRegistrationMapper;
import com.chengyinhub.business.service.IMarketingCodeGrantPlayEligibility;
import com.chengyinhub.business.service.IMarketingGiftPlayEligibility;
import com.chengyinhub.business.service.IRegistrationSeatRecipientEligibility;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Date;
import java.util.List;

/**
 * 一场活动此刻能否玩：本人已付报名，或已领取且原单仍已付的内含席位，
 * 或既有礼品 / 平台码可玩事实。待领取、已取消、已释放、原单未付或已退的席位不算。
 */
@Service
public class ActivityPlayEntitlement {

    private static final long ACTIVITY = 2L;

    private final CmsRegistrationMapper registrations;
    private final IRegistrationSeatRecipientEligibility seats;
    private final IMarketingGiftPlayEligibility gifts;
    private final IMarketingCodeGrantPlayEligibility codeGrants;

    public ActivityPlayEntitlement(CmsRegistrationMapper registrations,
                                   IRegistrationSeatRecipientEligibility seats,
                                   @Autowired(required = false) IMarketingGiftPlayEligibility gifts,
                                   @Autowired(required = false) IMarketingCodeGrantPlayEligibility codeGrants) {
        this.registrations = registrations;
        this.seats = seats;
        this.gifts = gifts;
        this.codeGrants = codeGrants;
    }

    /** 本人已付报名 ∪ 已领取席位（status 1 且原单已付）∪ 礼品 / 码授权可玩事实。 */
    public boolean holds(Long memberId, Long activityId) {
        if (memberId == null || memberId <= 0L || activityId == null || activityId <= 0L) return false;
        return ownsPaidRegistration(memberId, activityId)
                || claimedSeat(memberId, activityId)
                || claimedGift(memberId, activityId)
                || activeCodeGrant(memberId, activityId);
    }

    private boolean ownsPaidRegistration(Long memberId, Long activityId) {
        if (registrations == null) return false;
        CmsRegistration probe = new CmsRegistration();
        probe.setMemberId(memberId);
        probe.setOwnerType(ACTIVITY);
        probe.setOwnerId(activityId);
        probe.setRegistrationStatus(2);
        probe.setPaymentStatus(2);
        List<CmsRegistration> rows = registrations.selectCmsRegistrationList(probe);
        if (rows == null) return false;
        for (CmsRegistration row : rows) {
            if (row != null && memberId.equals(row.getMemberId())
                    && Long.valueOf(ACTIVITY).equals(row.getOwnerType())
                    && activityId.equals(row.getOwnerId())
                    && Integer.valueOf(2).equals(row.getRegistrationStatus())
                    && Integer.valueOf(2).equals(row.getPaymentStatus())) {
                return true;
            }
        }
        return false;
    }

    /** playFacts 只投影 status=1 且原单 registration/payment 均为已付的席位。 */
    private boolean claimedSeat(Long memberId, Long activityId) {
        if (seats == null) return false;
        List<SeatRecipientFact> facts = seats.playFacts(memberId, ACTIVITY, activityId);
        if (facts == null || facts.isEmpty()) return false;
        for (SeatRecipientFact fact : facts) {
            if (fact != null && memberId.equals(fact.getInviteeMemberId())) return true;
        }
        return false;
    }

    private boolean claimedGift(Long memberId, Long activityId) {
        if (gifts == null) return false;
        List<GiftPlayFact> facts = gifts.playFacts(memberId, ACTIVITY, activityId);
        if (facts == null) return false;
        for (GiftPlayFact fact : facts) {
            if (fact != null && fact.claimedBy(memberId)) return true;
        }
        return false;
    }

    private boolean activeCodeGrant(Long memberId, Long activityId) {
        if (codeGrants == null) return false;
        List<MarketingCodeGrant> facts = codeGrants.playFacts(memberId, ACTIVITY, activityId);
        if (facts == null) return false;
        Date now = new Date();
        for (MarketingCodeGrant grant : facts) {
            if (grant != null && Integer.valueOf(MarketingCodeGrant.STATUS_ACTIVE).equals(grant.getStatus())
                    && memberId.equals(grant.getMemberId()) && grant.validAt(now)) {
                return true;
            }
        }
        return false;
    }
}
