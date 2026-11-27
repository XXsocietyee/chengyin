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
import com.chengyinhub.business.service.IPointsAwardService;
import com.chengyinhub.common.constant.PlayMode;
import com.chengyinhub.common.constant.PurchaseKind;
import com.chengyinhub.common.core.domain.AjaxResult;
import com.chengyinhub.common.exception.RedeemLimitRejectedException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Collections;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** §4.2: 柜台台卡自助核销安全归属、幂等重放、脱敏回包与当日序号测试。 */
class PlaySelfRedeemApplicationTest {

    private static final long MEMBER_ID = 1001L;
    private static final long OTHER_MEMBER_ID = 2002L;
    private static final long MERCHANT_ID = 3003L;
    private static final long TOPIC_ID = 401L;
    private static final long ACTIVITY_ID = 501L;
    private static final long CHAPTER_ID = 601L;
    private static final long NODE_ID = 701L;
    private static final long REG_ID = 801L;
    private static final String STAND_CODE = "STAND-CAFE-701";

    private PlaySelfRedeemApplication app;
    private ICmsTopicNodeService nodeService;
    private PlayNodeContext playNodeContext;
    private PlayCompletionFacts completionFacts;
    private ICmsActivityService activityService;
    private ICmsRegistrationService registrationService;
    private IPerkLedgerService perkLedgerService;
    private IPointsAwardService pointsAwardService;
    private IGrowthService growthService;
    private IExploreCollectibleService collectibleService;

    private CmsTopicNode node;
    private CmsRegistration reg;
    private CmsActivity activity;

    @BeforeEach
    void setUp() {
        app = new PlaySelfRedeemApplication();
        nodeService = mock(ICmsTopicNodeService.class);
        playNodeContext = mock(PlayNodeContext.class);
        completionFacts = mock(PlayCompletionFacts.class);
        activityService = mock(ICmsActivityService.class);
        registrationService = mock(ICmsRegistrationService.class);
        perkLedgerService = mock(IPerkLedgerService.class);
        pointsAwardService = mock(IPointsAwardService.class);
        growthService = mock(IGrowthService.class);
        collectibleService = mock(IExploreCollectibleService.class);

        ReflectionTestUtils.setField(app, "cmsTopicNodeService", nodeService);
        ReflectionTestUtils.setField(app, "playNodeContext", playNodeContext);
        ReflectionTestUtils.setField(app, "playCompletionFacts", completionFacts);
        ReflectionTestUtils.setField(app, "cmsActivityService", activityService);
        ReflectionTestUtils.setField(app, "cmsRegistrationService", registrationService);
        ReflectionTestUtils.setField(app, "perkLedgerService", perkLedgerService);
        ReflectionTestUtils.setField(app, "pointsAwardService", pointsAwardService);
        ReflectionTestUtils.setField(app, "growthService", growthService);
        ReflectionTestUtils.setField(app, "exploreCollectibleService", collectibleService);

        node = new CmsTopicNode();
        node.setId(NODE_ID);
        node.setTopicId(TOPIC_ID);
        node.setChapterId(CHAPTER_ID);
        node.setMerchantMemberId(MERCHANT_ID);
        node.setName("白日梦咖啡");
        node.setCheckinCode(STAND_CODE);
        when(nodeService.selectCmsTopicNodeList(any())).thenReturn(Collections.singletonList(node));

        reg = new CmsRegistration();
        reg.setId(REG_ID);
        reg.setMemberId(MEMBER_ID);
        reg.setOwnerType(2L);
        reg.setOwnerId(ACTIVITY_ID);
        reg.setRegistrationStatus(2);
        reg.setPaymentStatus(2);
        reg.setPurchaseKind(PurchaseKind.EXPLORE_PASS);

        activity = new CmsActivity();
        activity.setId(ACTIVITY_ID);
        activity.setTopicId(TOPIC_ID);
        activity.setEndDate(new Date(System.currentTimeMillis() + 86_400_000L));
        when(activityService.selectCmsActivityById(ACTIVITY_ID)).thenReturn(activity);

        PlayNodeContext.PlayCtx ctx = newCtx(ACTIVITY_ID, TOPIC_ID, reg);
        when(playNodeContext.resolveCtx(eq(MEMBER_ID), eq(String.valueOf(ACTIVITY_ID)), any(), eq(node), any()))
                .thenReturn(ctx);
        when(playNodeContext.isDelistedNode(node)).thenReturn(false);
        when(playNodeContext.resolveMode(ACTIVITY_ID, TOPIC_ID)).thenReturn(PlayMode.FREE_COLLECT);
        when(completionFacts.exploreRegistration(MEMBER_ID, ACTIVITY_ID)).thenReturn(reg);

        when(perkLedgerService.livePerkName(CHAPTER_ID, MERCHANT_ID)).thenReturn("招牌手冲美式 1 杯");
        Map<String, Object> deskInfo = new LinkedHashMap<>();
        deskInfo.put("playerName", "林*");
        when(perkLedgerService.redemptionDeskInfo(MEMBER_ID, CHAPTER_ID, MERCHANT_ID)).thenReturn(deskInfo);
        when(perkLedgerService.dailyRedemptionSerial(CHAPTER_ID, MERCHANT_ID)).thenReturn(8);
    }

    private static PlayNodeContext.PlayCtx newCtx(long actId, long topicId, CmsRegistration registration) {
        PlayNodeContext.PlayCtx ctx = new PlayNodeContext.PlayCtx();
        ctx.actId = actId;
        ctx.topicId = topicId;
        ctx.registration = registration;
        return ctx;
    }

    @Test
    @SuppressWarnings("unchecked")
    void happyPathSelfRedeemsAndReturnsMaskedNicknamePerkAndDailySerialOnly() {
        when(registrationService.redeemExploreChapterAndRecord(
                reg, CHAPTER_ID, TOPIC_ID, MERCHANT_ID, MEMBER_ID,
                PlaySelfRedeemApplication.ACTOR_ROLE_SELF_REDEEM, null))
                .thenReturn(new ExploreChapterRedemptionResult(999L, 0, false));

        AjaxResult result = app.selfRedeem(MEMBER_ID, String.valueOf(ACTIVITY_ID), null, STAND_CODE, NODE_ID, REG_ID);
        assertEquals(200, result.get(AjaxResult.CODE_TAG));
        Map<String, Object> data = (Map<String, Object>) result.get(AjaxResult.DATA_TAG);
        assertEquals(999L, data.get("redemptionId"));
        assertEquals(false, data.get("replayed"));
        assertEquals("白日梦咖啡", data.get("shopName"));
        assertEquals("招牌手冲美式 1 杯", data.get("perkTitle"));
        assertEquals("林*", data.get("playerName"));
        assertEquals(8, data.get("dailySerialNo"));
        assertNotNull(data.get("redeemedAt"));
        assertFalse(data.containsKey("phone"));
        assertFalse(data.containsKey("phonenumber"));
        assertFalse(data.containsKey("mobile"));

        verify(pointsAwardService).award(MEMBER_ID, 11L, REG_ID, "到店核销");
        verify(growthService).deliverStoreVerification(REG_ID);
        verify(collectibleService).record(MEMBER_ID, TOPIC_ID, CHAPTER_ID, MERCHANT_ID);
        verify(registrationService).recordImpliedShopArrival(reg, CHAPTER_ID, MERCHANT_ID);
    }

    @Test
    @SuppressWarnings("unchecked")
    void replayReturnsReplayedReceiptWithoutReawarding() {
        when(registrationService.redeemExploreChapterAndRecord(
                reg, CHAPTER_ID, TOPIC_ID, MERCHANT_ID, MEMBER_ID,
                PlaySelfRedeemApplication.ACTOR_ROLE_SELF_REDEEM, null))
                .thenReturn(new ExploreChapterRedemptionResult(999L, 0, true));

        AjaxResult result = app.selfRedeem(MEMBER_ID, String.valueOf(ACTIVITY_ID), null, STAND_CODE, NODE_ID, REG_ID);
        assertEquals(200, result.get(AjaxResult.CODE_TAG));
        Map<String, Object> data = (Map<String, Object>) result.get(AjaxResult.DATA_TAG);
        assertEquals(true, data.get("replayed"));
        assertEquals(8, data.get("dailySerialNo"));

        verify(pointsAwardService, never()).award(any(), any(), any(), any());
        verify(collectibleService, never()).record(any(), any(), any(), any());
    }

    @Test
    void rejectsForeignRegistrationUnpaidWrongStoreAndDailyLimit() {
        // Unauthenticated
        AjaxResult noAuth = app.selfRedeem(0L, String.valueOf(ACTIVITY_ID), null, STAND_CODE, NODE_ID, REG_ID);
        assertEquals(500, noAuth.get(AjaxResult.CODE_TAG));

        // Wrong store stand QR
        AjaxResult wrongStore = app.selfRedeem(MEMBER_ID, String.valueOf(ACTIVITY_ID), null, STAND_CODE, NODE_ID + 1, REG_ID);
        assertEquals(500, wrongStore.get(AjaxResult.CODE_TAG));
        assertTrue(String.valueOf(wrongStore.get(AjaxResult.MSG_TAG)).contains("不是当前门店"));

        // Foreign registration IDOR
        CmsRegistration foreign = new CmsRegistration();
        foreign.setId(9999L);
        foreign.setMemberId(OTHER_MEMBER_ID);
        foreign.setOwnerType(2L);
        foreign.setOwnerId(ACTIVITY_ID);
        foreign.setRegistrationStatus(2);
        foreign.setPaymentStatus(2);
        foreign.setPurchaseKind(PurchaseKind.EXPLORE_PASS);
        PlayNodeContext.PlayCtx foreignCtx = newCtx(ACTIVITY_ID, TOPIC_ID, foreign);
        when(playNodeContext.resolveCtx(eq(MEMBER_ID), eq(String.valueOf(ACTIVITY_ID)), any(), eq(node), eq(9999L)))
                .thenReturn(foreignCtx);
        when(registrationService.selectCmsRegistrationById(9999L)).thenReturn(foreign);

        AjaxResult idor = app.selfRedeem(MEMBER_ID, String.valueOf(ACTIVITY_ID), null, STAND_CODE, NODE_ID, 9999L);
        assertEquals(500, idor.get(AjaxResult.CODE_TAG));
        verify(registrationService, never()).redeemExploreChapterAndRecord(any(), any(), any(), any(), any(), any(), any());

        // Unpaid registration
        reg.setPaymentStatus(0);
        AjaxResult unpaid = app.selfRedeem(MEMBER_ID, String.valueOf(ACTIVITY_ID), null, STAND_CODE, NODE_ID, REG_ID);
        assertEquals(500, unpaid.get(AjaxResult.CODE_TAG));
        reg.setPaymentStatus(2);

        // Daily limit exceeded
        when(registrationService.redeemExploreChapterAndRecord(
                reg, CHAPTER_ID, TOPIC_ID, MERCHANT_ID, MEMBER_ID,
                PlaySelfRedeemApplication.ACTOR_ROLE_SELF_REDEEM, null))
                .thenThrow(new RedeemLimitRejectedException("今日名额已满"));
        AjaxResult limited = app.selfRedeem(MEMBER_ID, String.valueOf(ACTIVITY_ID), null, STAND_CODE, NODE_ID, REG_ID);
        assertEquals(500, limited.get(AjaxResult.CODE_TAG));
        assertEquals("今日名额已满", limited.get(AjaxResult.MSG_TAG));
    }
}
