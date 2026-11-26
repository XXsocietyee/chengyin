package com.chengyinhub.business.service.impl;

import com.chengyinhub.business.domain.dto.RegistrationCohortFact;
import com.chengyinhub.business.mapper.BizFunnelDailyMapper;
import com.chengyinhub.business.mapper.PostGameOutcomeMapper;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** repeat_signup_v1（CO-06）fixture：口径边界逐条钉住；主口径 PAID_VALID，并列 ALL_SIGNUPS。 */
class AnalyticsRepeatSignupTest {
    private static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");
    private static final Instant FROM = at(2026, 9, 1, 0, 0, 0);
    private static final Instant TO_EXCLUSIVE = at(2026, 10, 1, 0, 0, 0);
    private static final Instant CUTOFF = at(2026, 11, 22, 12, 0, 0);

    @Test
    void sameUserTwoOrdersIsRepeat() {
        Map<String, Object> result = compute(
                fact(1, 11, null, at(2026, 9, 5, 10, 0, 0), "30", 2, null),
                fact(1, 12, null, at(2026, 9, 10, 10, 0, 0), "30", 2, null));
        assertFigure(result, "primary", 1, 1, 0);
        assertFigure(result, "allSignups", 1, 1, 0);
        assertEquals(new BigDecimal("1.0000"), figure(result, "primary").get("rate"));
    }

    @Test
    void oneOrderWithThreeSeatsCountsOnce() {
        Instant paidAt = at(2026, 9, 6, 10, 0, 0);
        Map<String, Object> result = compute(
                fact(2, 21, "P-2", paidAt, "30", 2, null),
                fact(2, 22, "P-2", paidAt, "30", 2, null),
                fact(2, 23, "P-2", paidAt.plusSeconds(1), "30", 2, null));
        assertFigure(result, "primary", 0, 1, 0);
        assertFigure(result, "allSignups", 0, 1, 0);
        assertEquals(new BigDecimal("0.0000"), figure(result, "primary").get("rate"));
    }

    @Test
    void fullyRefundedSecondOrderIsNotAValidRepeat() {
        Map<String, Object> refundedStatus = compute(
                fact(3, 31, null, at(2026, 9, 7, 10, 0, 0), "30", 2, null),
                fact(3, 32, null, at(2026, 9, 12, 10, 0, 0), "30", 4, null));
        assertFigure(refundedStatus, "primary", 0, 1, 0);
        assertFigure(refundedStatus, "allSignups", 1, 1, 0);

        // 退款已确认到账且 ≥ 实付，但 payment_status 还没翻到 4：同样是全退。
        Map<String, Object> settledRefund = compute(
                fact(8, 81, null, at(2026, 9, 7, 10, 0, 0), "30", 2, null),
                fact(8, 82, null, at(2026, 9, 12, 10, 0, 0), "30", 2, "30"));
        assertFigure(settledRefund, "primary", 0, 1, 0);
    }

    @Test
    void fullyRefundedFirstOrderMovesTheCohortToTheFirstValidOrder() {
        // 全退的 08-25 不算首笔有效；首笔有效是 09-02，且 30 天内无其它有效单。
        Map<String, Object> result = compute(
                fact(12, 121, null, at(2026, 8, 25, 10, 0, 0), "30", 4, null),
                fact(12, 122, null, at(2026, 9, 2, 10, 0, 0), "30", 2, null));
        assertFigure(result, "primary", 0, 1, 0);
        // 并列口径首单在 08-25（窗口外）⇒ 不进 cohort。
        assertFigure(result, "allSignups", 0, 0, 0);
        assertNull(figure(result, "allSignups").get("rate"), "分母为 0 是未知，不是 0%");
    }

    @Test
    void partiallyRefundedSecondOrderStillCounts() {
        Map<String, Object> result = compute(
                fact(4, 41, null, at(2026, 9, 8, 10, 0, 0), "30", 2, null),
                fact(4, 42, null, at(2026, 9, 15, 10, 0, 0), "30", 2, "10"));
        assertFigure(result, "primary", 1, 1, 0);
    }

    @Test
    void freeOrderIsExcludedFromPrimaryButCountedInAllSignups() {
        Map<String, Object> freeSecond = compute(
                fact(5, 51, null, at(2026, 9, 9, 10, 0, 0), "30", 2, null),
                fact(5, 52, null, at(2026, 9, 11, 10, 0, 0), "0", 2, null));
        assertFigure(freeSecond, "primary", 0, 1, 0);
        assertFigure(freeSecond, "allSignups", 1, 1, 0);

        Map<String, Object> freeFirst = compute(
                fact(11, 111, null, at(2026, 9, 3, 10, 0, 0), "0", 2, null),
                fact(11, 112, null, at(2026, 9, 20, 10, 0, 0), "30", 2, null));
        assertFigure(freeFirst, "primary", 0, 1, 0);
        assertFigure(freeFirst, "allSignups", 1, 1, 0);
    }

    @Test
    void exactlyThirtyDaysIsInsideAndOneSecondLaterIsOutside() {
        Instant first = at(2026, 9, 10, 10, 0, 0);
        Instant thirtyDays = at(2026, 10, 10, 10, 0, 0);
        assertFigure(compute(
                fact(6, 61, null, first, "30", 2, null),
                fact(6, 62, null, thirtyDays, "30", 2, null)), "primary", 1, 1, 0);
        assertFigure(compute(
                fact(7, 71, null, first, "30", 2, null),
                fact(7, 72, null, thirtyDays.plusSeconds(1), "30", 2, null)), "primary", 0, 1, 0);
    }

    @Test
    void immatureWindowIsReportedButExcludedFromDenominator() {
        // 截止 11-22 12:00；10-25 首单 + 30 天 = 11-24，尚未走完。
        Instant from = at(2026, 9, 1, 0, 0, 0);
        Instant toExclusive = at(2026, 11, 1, 0, 0, 0);
        Map<String, Object> result = AnalyticsEventServiceImpl.computeRepeatSignup(List.of(
                fact(1, 11, null, at(2026, 9, 5, 10, 0, 0), "30", 2, null),
                fact(1, 12, null, at(2026, 9, 10, 10, 0, 0), "30", 2, null),
                fact(9, 91, null, at(2026, 10, 25, 10, 0, 0), "30", 2, null),
                fact(9, 92, null, at(2026, 10, 26, 10, 0, 0), "30", 2, null)), from, toExclusive, CUTOFF);
        assertFigure(result, "primary", 1, 1, 1);
        assertFigure(result, "allSignups", 1, 1, 1);

        Map<String, Object> allImmature = AnalyticsEventServiceImpl.computeRepeatSignup(List.of(
                fact(9, 91, null, at(2026, 10, 25, 10, 0, 0), "30", 2, null)), from, toExclusive, CUTOFF);
        assertFigure(allImmature, "primary", 0, 0, 1);
        assertNull(figure(allImmature, "primary").get("rate"), "只有未成熟 cohort 时比率未知，不是 0%");
    }

    @Test
    void outputCarriesVersionCutoffAndWindow() {
        Map<String, Object> result = compute();
        assertEquals("repeat_signup_v1", result.get("definitionVersion"));
        assertEquals(30, result.get("windowDays"));
        assertEquals(Date.from(CUTOFF), result.get("dataCutoffAt"));
        assertEquals("PAID_VALID", figure(result, "primary").get("basis"));
        assertEquals("ALL_SIGNUPS", figure(result, "allSignups").get("basis"));
    }

    @Test
    void failedFactReadIsUnknownNotZero() {
        AnalyticsEventServiceImpl service = new AnalyticsEventServiceImpl();
        PostGameOutcomeMapper mapper = mock(PostGameOutcomeMapper.class);
        BizFunnelDailyMapper funnelMapper = mock(BizFunnelDailyMapper.class);
        ReflectionTestUtils.setField(service, "postGameOutcomeMapper", mapper);
        ReflectionTestUtils.setField(service, "bizFunnelDailyMapper", funnelMapper);
        ReflectionTestUtils.setField(service, "clock", Clock.fixed(CUTOFF, ZONE));
        LocalDate start = LocalDate.of(2026, 9, 1);
        LocalDate end = LocalDate.of(2026, 9, 30);

        when(mapper.selectCohortMemberIds(any(), any())).thenReturn(null);
        assertThrows(IllegalStateException.class, () -> service.repeatSignup(start, end));

        when(mapper.selectCohortMemberIds(any(), any())).thenReturn(List.of(1L));
        when(mapper.selectPaidRegistrationHistory(any(), any())).thenReturn(null);
        assertThrows(IllegalStateException.class, () -> service.repeatSignup(start, end));

        when(funnelMapper.selectRouteFunnel(any(), any())).thenReturn(null);
        assertThrows(IllegalStateException.class, () -> service.routeFunnel(start, end));
    }

    @Test
    void repeatSignupReadsHistoryThirtyOneDaysPastTheCohortEnd() {
        AnalyticsEventServiceImpl service = new AnalyticsEventServiceImpl();
        PostGameOutcomeMapper mapper = mock(PostGameOutcomeMapper.class);
        ReflectionTestUtils.setField(service, "postGameOutcomeMapper", mapper);
        ReflectionTestUtils.setField(service, "clock", Clock.fixed(CUTOFF, ZONE));
        when(mapper.selectCohortMemberIds(Date.from(FROM), Date.from(TO_EXCLUSIVE))).thenReturn(List.of(1L));
        when(mapper.selectPaidRegistrationHistory(List.of(1L), Date.from(at(2026, 11, 1, 0, 0, 0))))
                .thenReturn(List.of(
                        fact(1, 11, null, at(2026, 9, 30, 23, 0, 0), "30", 2, null),
                        fact(1, 12, null, at(2026, 10, 30, 23, 0, 0), "30", 2, null)));
        Map<String, Object> result = service.repeatSignup(LocalDate.of(2026, 9, 1), LocalDate.of(2026, 9, 30));
        assertEquals("2026-09-01", result.get("cohortStart"));
        assertEquals("2026-09-30", result.get("cohortEnd"));
        assertFigure(result, "primary", 1, 1, 0);
    }

    @Test
    void routeFunnelPivotsStepsPerDayAndTopic() {
        List<Map<String, Object>> facts = new ArrayList<>();
        facts.add(Map.of("stat_date", java.sql.Date.valueOf("2026-11-20"), "topic_id", 42L, "topic_name", "老城夜游",
                "step_code", "detail_view", "member_count", 2L, "fact_count", 3L));
        facts.add(Map.of("stat_date", java.sql.Date.valueOf("2026-11-20"), "topic_id", 42L, "topic_name", "老城夜游",
                "step_code", "paid", "member_count", 1L, "fact_count", 1L));
        facts.add(Map.of("STAT_DATE", java.sql.Date.valueOf("2026-11-19"), "TOPIC_ID", 42L,
                "STEP_CODE", "completed", "MEMBER_COUNT", 1L, "FACT_COUNT", 1L));
        List<Map<String, Object>> rows = AnalyticsEventServiceImpl.pivotRouteFunnel(facts);
        assertEquals(2, rows.size());
        Map<String, Object> first = rows.get(0);
        assertEquals("2026-11-20", first.get("statDate"));
        assertEquals(42L, first.get("topicId"));
        assertEquals(2L, first.get("detailViewMembers"));
        assertEquals(3L, first.get("detailViewFacts"));
        assertEquals(1L, first.get("paidFacts"));
        assertEquals(0L, first.get("checkoutOpenMembers"), "查询成功但无该步事实 ⇒ 真 0");
        assertEquals(1L, rows.get(1).get("completedMembers"));
    }

    private static Map<String, Object> compute(RegistrationCohortFact... facts) {
        return AnalyticsEventServiceImpl.computeRepeatSignup(List.of(facts), FROM, TO_EXCLUSIVE, CUTOFF);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> figure(Map<String, Object> result, String name) {
        return (Map<String, Object>) result.get(name);
    }

    private static void assertFigure(Map<String, Object> result, String name,
                                     long numerator, long denominator, long immature) {
        Map<String, Object> figure = figure(result, name);
        assertEquals(numerator, figure.get("numerator"), name + " numerator");
        assertEquals(denominator, figure.get("denominator"), name + " denominator");
        assertEquals(immature, figure.get("immatureCount"), name + " immatureCount");
    }

    private static Instant at(int y, int m, int d, int h, int min, int s) {
        return LocalDateTime.of(y, m, d, h, min, s).atZone(ZONE).toInstant();
    }

    private static RegistrationCohortFact fact(long memberId, long registrationId, String parentOrderNo,
                                               Instant paidAt, String payable, int paymentStatus,
                                               String settledRefund) {
        RegistrationCohortFact fact = new RegistrationCohortFact();
        fact.setMemberId(memberId);
        fact.setRegistrationId(registrationId);
        fact.setParentOrderNo(parentOrderNo);
        fact.setPaymentTime(Date.from(paidAt));
        fact.setPayableAmount(new BigDecimal(payable));
        fact.setPaymentStatus(paymentStatus);
        fact.setRegistrationStatus(paymentStatus == 4 ? 3 : 2);
        fact.setSettledRefundAmount(settledRefund == null ? BigDecimal.ZERO : new BigDecimal(settledRefund));
        fact.setHasSettledRefund(settledRefund != null);
        fact.setPendingRefundCount(0);
        return fact;
    }
}
