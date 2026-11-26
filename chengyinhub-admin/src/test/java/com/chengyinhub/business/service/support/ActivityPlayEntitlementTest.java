package com.chengyinhub.business.service.support;

import com.chengyinhub.business.domain.CmsRegistration;
import com.chengyinhub.business.domain.GiftPlayFact;
import com.chengyinhub.business.domain.MarketingCodeGrant;
import com.chengyinhub.business.domain.SeatRecipientFact;
import com.chengyinhub.business.mapper.CmsRegistrationMapper;
import com.chengyinhub.business.service.IMarketingCodeGrantPlayEligibility;
import com.chengyinhub.business.service.IMarketingGiftPlayEligibility;
import com.chengyinhub.business.service.IRegistrationSeatRecipientEligibility;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Date;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** 活动可玩资格：已付报名、已领取席位、礼品与码授权取并集；未付和已取消席位不算。 */
class ActivityPlayEntitlementTest {

    private CmsRegistrationMapper registrations;
    private IRegistrationSeatRecipientEligibility seats;
    private IMarketingGiftPlayEligibility gifts;
    private IMarketingCodeGrantPlayEligibility codeGrants;
    private ActivityPlayEntitlement entitlement;

    @BeforeEach
    void setup() {
        registrations = mock(CmsRegistrationMapper.class);
        seats = mock(IRegistrationSeatRecipientEligibility.class);
        gifts = mock(IMarketingGiftPlayEligibility.class);
        codeGrants = mock(IMarketingCodeGrantPlayEligibility.class);
        when(registrations.selectCmsRegistrationList(org.mockito.ArgumentMatchers.any())).thenReturn(List.of());
        when(seats.playFacts(8L, 2L, 70L)).thenReturn(List.of());
        when(gifts.playFacts(8L, 2L, 70L)).thenReturn(List.of());
        when(codeGrants.playFacts(8L, 2L, 70L)).thenReturn(List.of());
        entitlement = new ActivityPlayEntitlement(registrations, seats, gifts, codeGrants);
    }

    @Test
    void ownPaidRegistrationHolds() {
        when(registrations.selectCmsRegistrationList(org.mockito.ArgumentMatchers.any())).thenReturn(List.of(paid(8L)));
        assertTrue(entitlement.holds(8L, 70L));
    }

    @Test
    void unpaidOrCancelledRegistrationDoesNotHold() {
        CmsRegistration unpaid = paid(8L);
        unpaid.setPaymentStatus(0);
        CmsRegistration cancelled = paid(8L);
        cancelled.setRegistrationStatus(3);
        when(registrations.selectCmsRegistrationList(org.mockito.ArgumentMatchers.any()))
                .thenReturn(List.of(unpaid, cancelled));
        assertFalse(entitlement.holds(8L, 70L));
    }

    @Test
    void claimedSeatOnPaidOrderHoldsWithoutOwnRegistration() {
        SeatRecipientFact fact = new SeatRecipientFact();
        fact.setInvitationId(31L);
        fact.setInviteeMemberId(8L);
        fact.setSeatNo(2);
        when(seats.playFacts(8L, 2L, 70L)).thenReturn(List.of(fact));
        assertTrue(entitlement.holds(8L, 70L));
    }

    @Test
    void absentSeatFactDoesNotHoldUnpaidOrCancelledSeats() {
        when(seats.playFacts(8L, 2L, 70L)).thenReturn(List.of());
        assertFalse(entitlement.holds(8L, 70L));
    }

    @Test
    void claimedGiftOrActiveCodeGrantHolds() {
        GiftPlayFact gift = new GiftPlayFact();
        gift.setStatus(GiftPlayFact.STATUS_CLAIMED);
        gift.setClaimedMemberId(8L);
        when(gifts.playFacts(8L, 2L, 70L)).thenReturn(List.of(gift));
        assertTrue(entitlement.holds(8L, 70L));

        when(gifts.playFacts(8L, 2L, 70L)).thenReturn(List.of());
        MarketingCodeGrant grant = new MarketingCodeGrant();
        grant.setStatus(MarketingCodeGrant.STATUS_ACTIVE);
        grant.setMemberId(8L);
        grant.setValidTo(new Date(System.currentTimeMillis() + 60_000L));
        when(codeGrants.playFacts(8L, 2L, 70L)).thenReturn(List.of(grant));
        assertTrue(entitlement.holds(8L, 70L));
    }

    @Test
    void pendingGiftAndRevokedOrExpiredCodeDoNotHold() {
        GiftPlayFact pending = new GiftPlayFact();
        pending.setStatus(GiftPlayFact.STATUS_PENDING);
        pending.setClaimedMemberId(8L);
        when(gifts.playFacts(8L, 2L, 70L)).thenReturn(List.of(pending));
        MarketingCodeGrant revoked = new MarketingCodeGrant();
        revoked.setStatus(MarketingCodeGrant.STATUS_REVOKED);
        revoked.setMemberId(8L);
        MarketingCodeGrant expired = new MarketingCodeGrant();
        expired.setStatus(MarketingCodeGrant.STATUS_ACTIVE);
        expired.setMemberId(8L);
        expired.setValidTo(new Date(System.currentTimeMillis() - 60_000L));
        when(codeGrants.playFacts(8L, 2L, 70L)).thenReturn(List.of(revoked, expired));
        assertFalse(entitlement.holds(8L, 70L));
    }

    @Test
    void missingIdentityDoesNotHold() {
        assertFalse(entitlement.holds(null, 70L));
        assertFalse(entitlement.holds(0L, 70L));
        assertFalse(entitlement.holds(8L, null));
    }

    private static CmsRegistration paid(Long memberId) {
        CmsRegistration row = new CmsRegistration();
        row.setMemberId(memberId);
        row.setOwnerType(2L);
        row.setOwnerId(70L);
        row.setRegistrationStatus(2);
        row.setPaymentStatus(2);
        return row;
    }
}
