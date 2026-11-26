package com.chengyinhub.business.service;

import com.chengyinhub.business.domain.CmsRegistration;
import com.chengyinhub.business.domain.MerchantChapterOffer;
import com.chengyinhub.business.domain.Redemption;
import com.chengyinhub.business.mapper.CmsRegistrationMapper;
import com.chengyinhub.business.mapper.CmsTopicChapterMapper;
import com.chengyinhub.business.mapper.MerchantChapterOfferMapper;
import com.chengyinhub.business.mapper.RedemptionMapper;
import com.chengyinhub.business.mapper.RegistrationEntitlementMapper;
import com.chengyinhub.business.service.impl.PerkLedgerServiceImpl;
import com.chengyinhub.business.service.support.OfferRedeemLimits;
import com.chengyinhub.common.constant.TermsMode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.jdbc.BadSqlGrammarException;
import org.springframework.test.util.ReflectionTestUtils;

import java.sql.SQLSyntaxErrorException;
import java.time.LocalDate;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 每日名额(daily_capacity)与开始日期(valid_start)在核销时生效(业主 2026-11-22):
 * 满额 / 未开始 ⇒ 业务拒绝且什么都不写;未满 ⇒ 核销并记今天一份;重放不拒也不多记;NULL = 不限。
 *
 * <p>并发:真正的防线是 selectRedeemLimitsForUpdate 对供给行的 X 锁(当前读),mock 表现不出行锁。
 * 这里守的是它的前提 —— 判定读的是「锁读」那条语句、且发生在任何写入之前;语句本身带 for update
 * 由 MerchantOfferRedeemLimitsMapperSqlTest 守。
 */
class PerkLedgerDailyLimitTest {
    private static final Long REG = 900L;
    private static final Long TOPIC = 10L;
    private static final Long CH = 101L;
    private static final Long MERCHANT = 500L;
    private static final Long OPERATOR = 501L;
    private static final Long OFFER = 7L;
    private static final String TODAY = OfferRedeemLimits.today().toString();

    private MerchantChapterOfferMapper offers;
    private RegistrationEntitlementMapper entitlements;
    private RedemptionMapper redemptions;
    private PerkLedgerServiceImpl service;

    @BeforeEach
    void setUp() {
        offers = mock(MerchantChapterOfferMapper.class);
        entitlements = mock(RegistrationEntitlementMapper.class);
        redemptions = mock(RedemptionMapper.class);
        CmsRegistrationMapper registrations = mock(CmsRegistrationMapper.class);
        service = new PerkLedgerServiceImpl();
        ReflectionTestUtils.setField(service, "chapterMapper", mock(CmsTopicChapterMapper.class));
        ReflectionTestUtils.setField(service, "offerMapper", offers);
        ReflectionTestUtils.setField(service, "entitlementMapper", entitlements);
        ReflectionTestUtils.setField(service, "redemptionMapper", redemptions);
        ReflectionTestUtils.setField(service, "cmsRegistrationMapper", registrations);

        MerchantChapterOffer offer = new MerchantChapterOffer();
        offer.setId(OFFER);
        offer.setTopicId(TOPIC);
        offer.setChapterId(CH);
        offer.setMerchantId(MERCHANT);
        offer.setTermsMode(TermsMode.PERK);
        offer.setQuotaTotal(100);
        offer.setQuotaUsed(0);
        when(entitlements.markRedeemed(anyLong(), eq(CH))).thenReturn(1);
        when(offers.selectByChapter(CH)).thenReturn(Collections.singletonList(offer));
        when(offers.consumeQuota(OFFER)).thenReturn(1);
        CmsRegistration paid = new CmsRegistration();
        paid.setId(REG);
        paid.setPaymentStatus(2);
        when(registrations.selectCmsRegistrationById(REG)).thenReturn(paid);
    }

    private static Map<String, Object> limits(Integer dailyCapacity, String validStart, int usedToday) {
        Map<String, Object> row = new HashMap<>();
        if (dailyCapacity != null) row.put("dailyCapacity", dailyCapacity);
        if (validStart != null) row.put("validStart", validStart);
        row.put("usedToday", usedToday);
        return row;
    }

    private void givenLimits(Integer dailyCapacity, String validStart, int usedToday) {
        when(offers.selectRedeemLimitsForUpdate(OFFER, TODAY)).thenReturn(limits(dailyCapacity, validStart, usedToday));
    }

    private void assertNothingWritten() {
        verify(offers, never()).addDailyUsed(anyLong(), anyString());
        verify(offers, never()).consumeQuota(anyLong());
        verify(redemptions, never()).insertRedemption(any());
    }

    @Test
    void underLimit_redeemsAndCountsOneForToday() {
        givenLimits(3, null, 2);
        service.redeemChapter(REG, CH, MERCHANT, OPERATOR);
        verify(offers).addDailyUsed(OFFER, TODAY);
        verify(redemptions).insertRedemption(any());
    }

    @Test
    void limitReached_rejectedWithOwnerWording_andNothingIsWritten() {
        givenLimits(3, null, 3);
        com.chengyinhub.common.exception.RedeemLimitRejectedException e = assertThrows(com.chengyinhub.common.exception.RedeemLimitRejectedException.class,
                () -> service.redeemChapter(REG, CH, MERCHANT, OPERATOR));
        assertEquals("今日名额已满，请改天再来", e.getMessage());
        assertNothingWritten();
    }

    @Test
    void nullCapacityAndNullStart_meanNoLimit() {
        givenLimits(null, null, 9999);
        service.redeemChapter(REG, CH, MERCHANT, OPERATOR);
        verify(offers).addDailyUsed(OFFER, TODAY);
        verify(redemptions).insertRedemption(any());
    }

    @Test
    void beforeStart_rejectedWithStartDate_andNothingIsWritten() {
        LocalDate start = OfferRedeemLimits.today().plusDays(3);
        givenLimits(null, start.toString(), 0);
        com.chengyinhub.common.exception.RedeemLimitRejectedException e = assertThrows(com.chengyinhub.common.exception.RedeemLimitRejectedException.class,
                () -> service.redeemChapter(REG, CH, MERCHANT, OPERATOR));
        assertEquals("权益还没开始，" + start.getMonthValue() + "月" + start.getDayOfMonth() + "日起可用", e.getMessage());
        assertNothingWritten();
    }

    @Test
    void startingToday_isRedeemable() {
        givenLimits(5, TODAY, 0);
        service.redeemChapter(REG, CH, MERCHANT, OPERATOR);
        verify(redemptions).insertRedemption(any());
    }

    @Test
    void replayOfSameRedemption_isNeitherRejectedNorCountedAgain() {
        givenLimits(1, OfferRedeemLimits.today().plusDays(30).toString(), 1);   // 满额且未开始:首次核销必拒
        Redemption done = new Redemption();
        done.setId(66L);
        when(redemptions.selectActiveByIdempotencyKey("redeem:" + REG + ":" + CH + ":" + MERCHANT)).thenReturn(done);
        assertEquals(66L, service.redeemChapter(REG, CH, MERCHANT, OPERATOR));
        verify(offers, never()).selectRedeemLimitsForUpdate(anyLong(), anyString());
        assertNothingWritten();
    }

    @Test
    void concurrencyGuard_decisionUsesTheLockingReadBeforeAnyWrite() {
        givenLimits(3, null, 0);
        service.redeemChapter(REG, CH, MERCHANT, OPERATOR);
        InOrder order = inOrder(offers, redemptions);
        order.verify(offers).selectRedeemLimitsForUpdate(OFFER, TODAY);
        order.verify(offers).addDailyUsed(OFFER, TODAY);
        order.verify(offers).consumeQuota(OFFER);
        order.verify(redemptions).insertRedemption(any());
    }

    @Test
    void concurrencyGuard_lastSlotGoesToOneOfTwoRedemptions() {
        // 行锁让两笔核销排队:后到的那笔读到的是先到者已提交的计数。用同一个计数器模拟这一行。
        AtomicInteger used = new AtomicInteger(0);
        when(offers.selectRedeemLimitsForUpdate(OFFER, TODAY)).thenAnswer(call -> limits(1, null, used.get()));
        when(offers.addDailyUsed(OFFER, TODAY)).thenAnswer(call -> { used.incrementAndGet(); return 1; });
        assertNotNull(service);
        service.redeemChapter(REG, CH, MERCHANT, OPERATOR);
        com.chengyinhub.common.exception.RedeemLimitRejectedException e = assertThrows(com.chengyinhub.common.exception.RedeemLimitRejectedException.class,
                () -> service.redeemChapter(REG + 1, CH, MERCHANT, OPERATOR));
        assertEquals(OfferRedeemLimits.DAILY_FULL, e.getMessage());
        assertEquals(1, used.get());
        verify(redemptions, times(1)).insertRedemption(any());
    }

    @Test
    void databaseWithoutTheColumns_redeemsAsBefore() {
        when(offers.selectRedeemLimitsForUpdate(OFFER, TODAY)).thenThrow(
                new BadSqlGrammarException("select", "sql", new SQLSyntaxErrorException("Unknown column 'daily_used'")));
        service.redeemChapter(REG, CH, MERCHANT, OPERATOR);
        verify(offers, never()).addDailyUsed(anyLong(), anyString());
        verify(redemptions).insertRedemption(any());
    }

    @Test
    void databaseWithoutTheColumns_rawMyBatisExceptionIsRecognisedToo() {
        // 真库集成测试不经 Spring 转译,MyBatis 原样抛 PersistenceException(CI 实测)
        when(offers.selectRedeemLimitsForUpdate(OFFER, TODAY)).thenThrow(
                new org.apache.ibatis.exceptions.PersistenceException("Error querying database",
                        new SQLSyntaxErrorException("Unknown column 'daily_capacity' in 'field list'")));
        service.redeemChapter(REG, CH, MERCHANT, OPERATOR);
        verify(offers, never()).addDailyUsed(anyLong(), anyString());
        verify(redemptions).insertRedemption(any());
    }

    @Test
    void lockFailureIsNotTreatedAsNoLimit() {
        when(offers.selectRedeemLimitsForUpdate(OFFER, TODAY)).thenThrow(new RuntimeException("Lock wait timeout exceeded"));
        assertThrows(RuntimeException.class, () -> service.redeemChapter(REG, CH, MERCHANT, OPERATOR));
        assertNothingWritten();
    }

    @Test
    void reversingTodaysRedemption_givesTheSlotBack_olderOnesDoNot() {
        Redemption today = new Redemption();
        today.setOfferId(OFFER);
        today.setCreateTime(new Date());
        ReflectionTestUtils.invokeMethod(service, "releaseDailySlot", today);
        verify(offers).releaseDailyUsed(OFFER, TODAY);

        Redemption old = new Redemption();
        old.setOfferId(OFFER + 1);
        old.setCreateTime(new Date(System.currentTimeMillis() - 3L * 24 * 3600_000L));
        ReflectionTestUtils.invokeMethod(service, "releaseDailySlot", old);
        verify(offers, never()).releaseDailyUsed(eq(OFFER + 1), anyString());
    }
}
