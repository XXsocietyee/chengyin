package com.chengyinhub.web.service.play;

import com.chengyinhub.business.domain.CmsRegistration;
import com.chengyinhub.business.domain.CmsTopic;
import com.chengyinhub.business.domain.CmsTopicNode;
import com.chengyinhub.business.domain.MmsMerchant;
import com.chengyinhub.business.domain.SmsCoupon;
import com.chengyinhub.business.mapper.GameRuntimeSessionMapper;
import com.chengyinhub.business.service.ICmsTopicChapterService;
import com.chengyinhub.business.service.ICmsTopicService;
import com.chengyinhub.business.service.IMmsMerchantService;
import com.chengyinhub.business.service.IPerkLedgerService;
import com.chengyinhub.business.service.IPlayerNodeProgressService;
import com.chengyinhub.business.service.IPuzzlePlayService;
import com.chengyinhub.business.service.ISmsCouponService;
import com.chengyinhub.common.constant.PlayMode;
import com.chengyinhub.common.constant.PurchaseKind;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** §4.2: /api/play/nodes 自动解析本人有效 regId 与终点完赛驿站 finishCoupon/finishStation 投影测试。 */
class PlayNodeRegIdAndFinishStationTest {

    private static final long MEMBER_ID = 101L;
    private static final long OTHER_MEMBER_ID = 202L;
    private static final long TOPIC_ID = 301L;
    private static final long ACTIVITY_ID = 401L;
    private static final long REG_ID = 9001L;

    private PlayNodeQueryApplication app;
    private PlayCompletionFacts completionFacts;
    private IPerkLedgerService perkLedgerService;
    private ICmsTopicService topicService;
    private ISmsCouponService couponService;
    private IMmsMerchantService merchantService;
    private ICmsTopicChapterService chapterService;
    private IPlayerNodeProgressService progressService;
    private IPuzzlePlayService puzzlePlayService;
    private GameRuntimeSessionMapper gameRuntimeSessionMapper;

    @BeforeEach
    void setUp() {
        app = new PlayNodeQueryApplication();
        completionFacts = mock(PlayCompletionFacts.class);
        perkLedgerService = mock(IPerkLedgerService.class);
        topicService = mock(ICmsTopicService.class);
        couponService = mock(ISmsCouponService.class);
        merchantService = mock(IMmsMerchantService.class);
        chapterService = mock(ICmsTopicChapterService.class);
        progressService = mock(IPlayerNodeProgressService.class);
        puzzlePlayService = mock(IPuzzlePlayService.class);
        gameRuntimeSessionMapper = mock(GameRuntimeSessionMapper.class);

        ReflectionTestUtils.setField(app, "playCompletionFacts", completionFacts);
        ReflectionTestUtils.setField(app, "perkLedgerService", perkLedgerService);
        ReflectionTestUtils.setField(app, "cmsTopicService", topicService);
        ReflectionTestUtils.setField(app, "smsCouponService", couponService);
        ReflectionTestUtils.setField(app, "mmsMerchantService", merchantService);
        ReflectionTestUtils.setField(app, "cmsTopicChapterService", chapterService);
        ReflectionTestUtils.setField(app, "playerNodeProgressService", progressService);
        ReflectionTestUtils.setField(app, "puzzlePlayService", puzzlePlayService);
        ReflectionTestUtils.setField(app, "gameRuntimeSessionMapper", gameRuntimeSessionMapper);

        when(chapterService.selectCmsTopicChapterList(any())).thenReturn(Collections.emptyList());
        when(puzzlePlayService.selectHintLevels(anyLong(), anyLong(), anyLong())).thenReturn(new HashMap<>());
        when(perkLedgerService.listEntitlements(anyLong())).thenReturn(Collections.emptyList());
        when(gameRuntimeSessionMapper.selectStateJsonsByTopic(anyLong(), anyLong(), anyLong())).thenReturn(Collections.emptyList());
        when(gameRuntimeSessionMapper.selectPlayerSessionsByTopic(anyLong(), anyLong(), anyLong())).thenReturn(Collections.emptyList());
    }

    private PlayNodeQueryApplication.NodeProjection projection(boolean selfPlay, boolean registered,
                                                               boolean leadSpectator, int playMode, CmsTopic topic) {
        return new PlayNodeQueryApplication.NodeProjection(
                MEMBER_ID, selfPlay, TOPIC_ID, selfPlay ? 0L : ACTIVITY_ID, null,
                registered, leadSpectator, null,
                new ArrayList<CmsTopicNode>(), new ArrayList<>(), new HashMap<>(),
                new HashMap<>(), new HashSet<>(), 0, new HashSet<>(),
                new ArrayList<>(), null, playMode, topic, false, null);
    }

    private static CmsRegistration paidReg(long id, long ownerMemberId, int purchaseKind) {
        CmsRegistration r = new CmsRegistration();
        r.setId(id);
        r.setMemberId(ownerMemberId);
        r.setRegistrationStatus(2);
        r.setPaymentStatus(2);
        r.setPurchaseKind(purchaseKind);
        return r;
    }

    @Test
    void freeExploreAutoResolvesOwnedExploreRegistrationId() {
        CmsTopic topic = new CmsTopic();
        topic.setId(TOPIC_ID);
        when(topicService.selectCmsTopicById(TOPIC_ID)).thenReturn(topic);
        when(completionFacts.exploreRegistration(MEMBER_ID, ACTIVITY_ID))
                .thenReturn(paidReg(REG_ID, MEMBER_ID, PurchaseKind.EXPLORE_PASS));

        PlayNodeQueryApplication.NodeProjection read = projection(false, true, false, PlayMode.FREE_COLLECT, topic);
        assertNull(app.prepareNodes(read));
        Map<String, Object> data = app.finishNodes(read);
        assertEquals(REG_ID, data.get("regId"));
    }

    @Test
    void linearActivityAndSelfPlayAutoResolveOwnedRegistrationId() {
        CmsTopic topic = new CmsTopic();
        topic.setId(TOPIC_ID);
        when(topicService.selectCmsTopicById(TOPIC_ID)).thenReturn(topic);
        when(completionFacts.activityRegistration(MEMBER_ID, ACTIVITY_ID, null))
                .thenReturn(paidReg(REG_ID, MEMBER_ID, PurchaseKind.GUIDED_TICKET));

        PlayNodeQueryApplication.NodeProjection actRead = projection(false, true, false, PlayMode.LINEAR_ORIENTEERING, topic);
        assertNull(app.prepareNodes(actRead));
        assertEquals(REG_ID, app.finishNodes(actRead).get("regId"));

        when(completionFacts.validSelfPlayPass(MEMBER_ID, TOPIC_ID))
                .thenReturn(paidReg(REG_ID + 1, MEMBER_ID, PurchaseKind.SELF_PLAY_PASS));
        PlayNodeQueryApplication.NodeProjection selfRead = projection(true, true, false, PlayMode.LINEAR_ORIENTEERING, topic);
        assertNull(app.prepareNodes(selfRead));
        assertEquals(REG_ID + 1, app.finishNodes(selfRead).get("regId"));
    }

    @Test
    void regIdNeverLeaksForOtherMemberUnpaidOrLeadSpectator() {
        CmsTopic topic = new CmsTopic();
        topic.setId(TOPIC_ID);
        when(topicService.selectCmsTopicById(TOPIC_ID)).thenReturn(topic);

        // Other member's ticket (e.g. gift/seat)
        assertNull(PlayNodeQueryApplication.ownedRedeemableRegId(paidReg(REG_ID, OTHER_MEMBER_ID, PurchaseKind.EXPLORE_PASS), MEMBER_ID));

        // Unpaid or refunded ticket
        CmsRegistration unpaid = paidReg(REG_ID, MEMBER_ID, PurchaseKind.EXPLORE_PASS);
        unpaid.setPaymentStatus(0);
        assertNull(PlayNodeQueryApplication.ownedRedeemableRegId(unpaid, MEMBER_ID));

        CmsRegistration cancelled = paidReg(REG_ID, MEMBER_ID, PurchaseKind.EXPLORE_PASS);
        cancelled.setRegistrationStatus(3);
        assertNull(PlayNodeQueryApplication.ownedRedeemableRegId(cancelled, MEMBER_ID));

        // Lead spectator (registered=false) never resolves a player's regId
        when(completionFacts.activityRegistration(MEMBER_ID, ACTIVITY_ID, null))
                .thenReturn(paidReg(REG_ID, MEMBER_ID, PurchaseKind.GUIDED_TICKET));
        PlayNodeQueryApplication.NodeProjection spectatorRead = projection(false, false, true, PlayMode.LINEAR_ORIENTEERING, topic);
        assertNull(app.prepareNodes(spectatorRead));
        assertFalse(app.finishNodes(spectatorRead).containsKey("regId"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void finishCouponProjectsPublicFinishStationAndHidesPrivateMerchant() {
        CmsTopic topic = new CmsTopic();
        topic.setId(TOPIC_ID);
        topic.setCompleteRewardCouponId(777L);
        when(topicService.selectCmsTopicById(TOPIC_ID)).thenReturn(topic);

        SmsCoupon coupon = new SmsCoupon();
        coupon.setId(777L);
        coupon.setName("完赛美式一杯");
        coupon.setAmount(new BigDecimal("18"));
        coupon.setStatus(1);
        coupon.setDelFlag(0);
        coupon.setMerchantId(55L);
        when(couponService.selectSmsCouponById(777L)).thenReturn(coupon);

        MmsMerchant publicShop = new MmsMerchant();
        publicShop.setId(55L);
        publicShop.setName("终点驿站咖啡");
        publicShop.setAddress("安福路 108 号");
        publicShop.setLocationLat(31.2151d);
        publicShop.setLocationLng(121.4412d);
        publicShop.setStatus(1L);
        publicShop.setAccountStatus(1L);
        publicShop.setDelFlag(0);
        when(merchantService.selectMmsMerchantById(55L)).thenReturn(publicShop);

        PlayNodeQueryApplication.NodeProjection read = projection(true, true, false, PlayMode.LINEAR_ORIENTEERING, topic);
        assertNull(app.prepareNodes(read));
        Map<String, Object> data = app.finishNodes(read);
        Map<String, Object> reward = (Map<String, Object>) data.get("reward");
        assertTrue(reward.containsKey("finishCoupon"));
        Map<String, Object> station = (Map<String, Object>) reward.get("finishStation");
        assertEquals("终点驿站咖啡", station.get("shopName"));
        assertEquals("安福路 108 号", station.get("shopAddress"));

        // Disabled merchant must not be projected
        publicShop.setAccountStatus(0L);
        Map<String, Object> hiddenData = app.finishNodes(read);
        Map<String, Object> hiddenReward = (Map<String, Object>) hiddenData.get("reward");
        assertTrue(hiddenReward.containsKey("finishCoupon"));
        assertFalse(hiddenReward.containsKey("finishStation"));
    }
}
