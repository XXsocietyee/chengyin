package com.chengyinhub.business.service;

import com.chengyinhub.business.domain.MerchantChapterOffer;
import com.chengyinhub.business.domain.RefundApplication;
import com.chengyinhub.business.domain.UmsMember;
import com.chengyinhub.business.mapper.MerchantChapterOfferMapper;
import com.chengyinhub.business.mapper.RefundApplicationMapper;
import com.chengyinhub.business.mapper.UmsMemberMapper;
import com.chengyinhub.business.service.impl.PerkLedgerServiceImpl;
import com.chengyinhub.common.constant.TermsMode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Collections;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** P1-8 / P2-3:核销回执的只读柜台信息 —— 退款待审核提醒、脱敏昵称、本店该权益剩余名额。 */
class PerkLedgerRedemptionDeskInfoTest {

    private MerchantChapterOfferMapper offerMapper;
    private RefundApplicationMapper refundMapper;
    private UmsMemberMapper memberMapper;
    private PerkLedgerServiceImpl service;
    private MerchantChapterOffer offer;

    @BeforeEach
    void setUp() {
        offerMapper = mock(MerchantChapterOfferMapper.class);
        refundMapper = mock(RefundApplicationMapper.class);
        memberMapper = mock(UmsMemberMapper.class);
        service = new PerkLedgerServiceImpl();
        ReflectionTestUtils.setField(service, "offerMapper", offerMapper);
        ReflectionTestUtils.setField(service, "refundApplicationMapper", refundMapper);
        ReflectionTestUtils.setField(service, "umsMemberMapper", memberMapper);
        offer = new MerchantChapterOffer();
        offer.setChapterId(31L);
        offer.setMerchantId(41L);
        offer.setTermsMode(TermsMode.PERK);
        offer.setQuotaTotal(10);
        offer.setQuotaUsed(6);
        when(offerMapper.selectByChapter(31L)).thenReturn(Collections.singletonList(offer));
        UmsMember player = new UmsMember();
        player.setNickname(" 小明同学 ");
        when(memberMapper.selectUmsMemberById(77L)).thenReturn(player);
    }

    @Test
    void refundUnderReviewAsksOnlyForThisRegistrationsPendingApplications() {
        when(refundMapper.selectRefundApplicationList(any())).thenReturn(Collections.singletonList(new RefundApplication()));
        assertTrue(service.refundUnderReview(900L));
        ArgumentCaptor<RefundApplication> query = ArgumentCaptor.forClass(RefundApplication.class);
        verify(refundMapper).selectRefundApplicationList(query.capture());
        assertEquals("registration", query.getValue().getSourceType());
        assertEquals(900L, query.getValue().getSourceId());
        assertEquals(0, query.getValue().getStatus());
    }

    @Test
    void noPendingApplicationOrNoRegistrationReadsFalse() {
        when(refundMapper.selectRefundApplicationList(any())).thenReturn(Collections.emptyList());
        assertFalse(service.refundUnderReview(900L));
        assertFalse(service.refundUnderReview(null));
    }

    @Test
    void deskInfoMasksTheNicknameAndReportsThisShopsRemainingQuota() {
        Map<String, Object> info = service.redemptionDeskInfo(77L, 31L, 41L);
        assertEquals("小*", info.get("playerName"));
        assertEquals(4, info.get("remainingQuota"));
    }

    @Test
    void offersOffTheQuotaChainAndOtherShopsOffersCarryNoRemainingQuota() {
        offer.setTermsMode(TermsMode.REVSHARE);
        assertFalse(service.redemptionDeskInfo(77L, 31L, 41L).containsKey("remainingQuota"));
        offer.setTermsMode(TermsMode.PERK);
        assertFalse(service.redemptionDeskInfo(77L, 31L, 99L).containsKey("remainingQuota"));
    }

    @Test
    void blankNicknameIsOmittedAndOverdrawnQuotaNeverGoesNegative() {
        when(memberMapper.selectUmsMemberById(77L)).thenReturn(new UmsMember());
        offer.setQuotaUsed(12);
        Map<String, Object> info = service.redemptionDeskInfo(77L, 31L, 41L);
        assertFalse(info.containsKey("playerName"));
        assertEquals(0, info.get("remainingQuota"));
        assertTrue(service.redemptionDeskInfo(null, null, 41L).isEmpty());
    }

    @Test
    void refundLookupNeverTouchesOffersOrMembers() {
        service.refundUnderReview(900L);
        verifyNoInteractions(offerMapper, memberMapper);
    }
}
