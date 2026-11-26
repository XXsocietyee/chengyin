package com.chengyinhub.business.service.impl;

import com.chengyinhub.business.mapper.BizFunnelDailyMapper;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDate;
import java.util.Collections;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** R7 到访报告的参数与「未知不当 0」合同；真实 SQL 与夹具见 RouteVisitorReportMyBatisTest。 */
class AnalyticsEventServiceRouteVisitorTest {
    private static final LocalDate D1 = LocalDate.of(2026, 11, 1);

    private static AnalyticsEventServiceImpl service(BizFunnelDailyMapper mapper) {
        AnalyticsEventServiceImpl service = new AnalyticsEventServiceImpl();
        ReflectionTestUtils.setField(service, "bizFunnelDailyMapper", mapper);
        return service;
    }

    @Test
    void invalidArgumentsAreRejectedBeforeAnyQuery() {
        BizFunnelDailyMapper mapper = mock(BizFunnelDailyMapper.class);
        AnalyticsEventServiceImpl service = service(mapper);
        assertEquals("请选择主题", assertThrows(IllegalArgumentException.class,
                () -> service.routeVisitorReport(null, D1, D1)).getMessage());
        assertEquals("开始日期不能晚于结束日期", assertThrows(IllegalArgumentException.class,
                () -> service.routeVisitorReport(1L, D1.plusDays(1), D1)).getMessage());
        assertEquals("查询窗口不能超过90天", assertThrows(IllegalArgumentException.class,
                () -> service.routeVisitorReport(1L, D1, D1.plusDays(90))).getMessage());
        verifyNoInteractions(mapper);
    }

    @Test
    void missingTopicIsABusinessError() {
        BizFunnelDailyMapper mapper = mock(BizFunnelDailyMapper.class);
        when(mapper.selectRouteVisitorTopic(1L)).thenReturn(null);
        assertEquals("主题不存在", assertThrows(IllegalArgumentException.class,
                () -> service(mapper).routeVisitorReport(1L, D1, D1)).getMessage());
    }

    @Test
    void unreadableSourceFailsInsteadOfReportingZero() {
        BizFunnelDailyMapper mapper = mock(BizFunnelDailyMapper.class);
        when(mapper.selectRouteVisitorTopic(1L)).thenReturn(Collections.singletonMap("topic_name", "梧桐路线"));
        when(mapper.countRouteVisitorSessions(1L)).thenReturn(1L);
        when(mapper.selectRouteVisitorRunStats(anyLong(), any(), any(), anyBoolean())).thenReturn(Collections.emptyList());
        when(mapper.selectRouteVisitorRefundDaily(anyLong(), any(), any())).thenReturn(Collections.emptyList());
        when(mapper.selectRouteVisitorStations(1L)).thenReturn(Collections.emptyList());
        when(mapper.selectRouteVisitorStationStats(anyLong(), any(), any(), anyBoolean())).thenReturn(null);
        assertThrows(IllegalStateException.class, () -> service(mapper).routeVisitorReport(1L, D1, D1));

        when(mapper.countRouteVisitorSessions(1L)).thenReturn(null);
        assertThrows(IllegalStateException.class, () -> service(mapper).routeVisitorReport(1L, D1, D1));
    }

    @Test
    void smallCellRuleKeepsKnownZeroAndHidesOneOrTwoPlayers() {
        assertEquals(0L, AnalyticsEventServiceImpl.smallCell(0, 0));
        assertEquals("<3", AnalyticsEventServiceImpl.smallCell(1, 1));
        assertEquals("<3", AnalyticsEventServiceImpl.smallCell(5, 2), "次数多但只有两人：仍是两人格子");
        assertEquals(4L, AnalyticsEventServiceImpl.smallCell(4, 3));
    }

    @Test
    @SuppressWarnings("unchecked")
    void stationWithoutMerchantShowsVerificationsAsUnknown() {
        BizFunnelDailyMapper mapper = mock(BizFunnelDailyMapper.class);
        when(mapper.selectRouteVisitorTopic(1L)).thenReturn(Collections.singletonMap("topic_name", "梧桐路线"));
        when(mapper.countRouteVisitorSessions(1L)).thenReturn(0L);
        when(mapper.selectRouteVisitorRunStats(anyLong(), any(), any(), anyBoolean())).thenReturn(Collections.emptyList());
        when(mapper.selectRouteVisitorRefundDaily(anyLong(), any(), any())).thenReturn(Collections.emptyList());
        when(mapper.selectRouteVisitorStations(1L)).thenReturn(List.of(
                Map.of("node_id", 11L, "station_name", "钟楼", "has_merchant", 0L),
                Map.of("node_id", 12L, "station_name", "咖啡", "has_merchant", 1L)));
        when(mapper.selectRouteVisitorStationStats(anyLong(), any(), any(), anyBoolean())).thenReturn(Collections.emptyList());
        when(mapper.selectRouteVisitorUndatedCompletions(1L)).thenReturn(Collections.emptyList());

        Map<String, Object> report = service(mapper).routeVisitorReport(1L, D1, D1);
        List<Map<String, Object>> stations = (List<Map<String, Object>>) report.get("stations");
        assertEquals(null, stations.get(0).get("verifications"));
        assertEquals(0L, stations.get(0).get("arrivals"));
        assertEquals(0L, stations.get(1).get("verifications"));
        Map<String, Object> day = ((List<Map<String, Object>>) report.get("routeDays")).get(0);
        assertEquals(null, day.get("runsStarted"), "从未建路线局 ⇒ 未知");
        assertEquals(0L, day.get("refunds"));
    }
}
