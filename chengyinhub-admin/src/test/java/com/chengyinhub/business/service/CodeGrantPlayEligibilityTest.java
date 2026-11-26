package com.chengyinhub.business.service;

import com.chengyinhub.business.domain.CmsRegistration;
import com.chengyinhub.business.domain.MarketingCodeGrant;
import com.chengyinhub.business.mapper.CmsActivityMapper;
import com.chengyinhub.business.mapper.CmsRegistrationMapper;
import com.chengyinhub.business.mapper.MarketingCodeGrantMapper;
import com.chengyinhub.business.service.impl.MarketingCodeGrantPlayEligibility;
import com.chengyinhub.business.service.support.CurrentPlayRegistration;
import com.chengyinhub.common.constant.PurchaseKind;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * 平台码授权 → 可玩判定：ACTIVE 本人本主题放行（瞬时视图，非已付行），撤销/过期/他人/活动域/要求已付一律不放行。
 * 走真实 CurrentPlayRegistration 与真实 MarketingCodeGrantPlayEligibility（mapper 为 mock）。
 */
class CodeGrantPlayEligibilityTest {

    private static final long MEMBER = 7L;
    private static final long OTHER = 9L;
    private static final long TOPIC = 100L;

    private final CmsRegistrationMapper registrations = mock(CmsRegistrationMapper.class);
    private final CmsActivityMapper activities = mock(CmsActivityMapper.class);
    private final MarketingCodeGrantMapper grantMapper = mock(MarketingCodeGrantMapper.class);

    @Test
    void activeGrantIsAcceptedAsUnpaidTransientPass() {
        noRegistrations();
        IMarketingCodeGrantPlayEligibility eligibility = eligibility(true, grant(MarketingCodeGrant.STATUS_ACTIVE, MEMBER, future()));

        CmsRegistration pass = CurrentPlayRegistration.require(activities, registrations, MEMBER, 1L, TOPIC, null,
                new Date(), false, null, null, eligibility);

        assertNull(pass.getId(), "不是 cms_registration 行");
        assertNull(pass.getPaymentStatus(), "不是已付");
        assertEquals(Long.valueOf(MEMBER), pass.getMemberId());
        assertEquals(Long.valueOf(TOPIC), pass.getOwnerId());
        assertEquals(Integer.valueOf(PurchaseKind.SELF_PLAY_PASS), pass.getPurchaseKind());
        verify(grantMapper).selectActiveByMemberTopic(MEMBER, TOPIC);
    }

    @Test
    void revokedGrantIsRejected() {
        noRegistrations();
        // 库里已撤销的行即便被查回，也不会放行
        IMarketingCodeGrantPlayEligibility eligibility = eligibility(true, grant(MarketingCodeGrant.STATUS_REVOKED, MEMBER, future()));

        assertTrue(eligibility.playFacts(MEMBER, 1L, TOPIC).isEmpty());
        assertThrows(IllegalStateException.class, () -> CurrentPlayRegistration.require(activities, registrations,
                MEMBER, 1L, TOPIC, null, new Date(), false, null, null, eligibility));
    }

    @Test
    void expiredGrantRejectsNewUseButLetsStartedRunFinish() {
        noRegistrations();
        IMarketingCodeGrantPlayEligibility eligibility = eligibility(true,
                grant(MarketingCodeGrant.STATUS_ACTIVE, MEMBER, new Date(System.currentTimeMillis() - 1000L)));

        assertThrows(IllegalStateException.class, () -> CurrentPlayRegistration.require(activities, registrations,
                MEMBER, 1L, TOPIC, null, new Date(), false, null, null, eligibility));
        CmsRegistration continuing = CurrentPlayRegistration.requireToContinue(activities, registrations,
                MEMBER, 1L, TOPIC, null, new Date(), null, null, eligibility);
        assertNull(continuing.getId());
    }

    @Test
    void anotherMembersGrantIsRejected() {
        noRegistrations();
        IMarketingCodeGrantPlayEligibility leaky = (memberId, ownerType, ownerId) ->
                Collections.singletonList(grant(MarketingCodeGrant.STATUS_ACTIVE, OTHER, future()));

        assertThrows(IllegalStateException.class, () -> CurrentPlayRegistration.require(activities, registrations,
                MEMBER, 1L, TOPIC, null, new Date(), false, null, null, leaky));
    }

    @Test
    void paidOnlyEntriesAndSpecificRegistrationRequestsAreNotWidened() {
        noRegistrations();
        IMarketingCodeGrantPlayEligibility eligibility = eligibility(true, grant(MarketingCodeGrant.STATUS_ACTIVE, MEMBER, future()));

        assertThrows(IllegalStateException.class, () -> CurrentPlayRegistration.require(activities, registrations,
                MEMBER, 1L, TOPIC, null, new Date(), true, null, null, eligibility));
        assertThrows(IllegalStateException.class, () -> CurrentPlayRegistration.require(activities, registrations,
                MEMBER, 1L, TOPIC, 555L, new Date(), false, null, null, eligibility));
    }

    @Test
    void switchOffAndActivityScopeNeverConsultGrants() {
        MarketingCodeGrantPlayEligibility off = new MarketingCodeGrantPlayEligibility(grantMapper, false);
        MarketingCodeGrantPlayEligibility on = new MarketingCodeGrantPlayEligibility(grantMapper, true);

        assertTrue(off.playFacts(MEMBER, 1L, TOPIC).isEmpty());
        assertTrue(on.playFacts(MEMBER, 2L, 555L).isEmpty());
        verifyNoInteractions(grantMapper);
    }

    @Test
    void withoutCodeGrantSourceLegacyBehaviourIsUnchanged() {
        noRegistrations();
        assertThrows(IllegalStateException.class, () -> CurrentPlayRegistration.require(activities, registrations,
                MEMBER, 1L, TOPIC, null, new Date(), false, null, null));
    }

    // ------------------------------------------------------------------ helpers

    private void noRegistrations() {
        when(registrations.selectCmsRegistrationList(any())).thenReturn(new ArrayList<>());
    }

    private IMarketingCodeGrantPlayEligibility eligibility(boolean enabled, MarketingCodeGrant row) {
        List<MarketingCodeGrant> rows = new ArrayList<>();
        rows.add(row);
        when(grantMapper.selectActiveByMemberTopic(MEMBER, TOPIC)).thenReturn(rows);
        return new MarketingCodeGrantPlayEligibility(grantMapper, enabled);
    }

    private MarketingCodeGrant grant(int status, long memberId, Date validTo) {
        MarketingCodeGrant g = new MarketingCodeGrant();
        g.setId(1L);
        g.setVoucherId(300L);
        g.setMemberId(memberId);
        g.setTopicId(TOPIC);
        g.setStatus(status);
        g.setSeatCount(2);
        g.setValidFrom(new Date(System.currentTimeMillis() - 60_000L));
        g.setValidTo(validTo);
        return g;
    }

    private Date future() {
        return new Date(System.currentTimeMillis() + 86_400_000L);
    }
}
