package com.chengyinhub.web.controller.business;

import com.chengyinhub.business.service.IAnalyticsEventService;
import com.chengyinhub.common.core.domain.AjaxResult;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.util.ReflectionTestUtils;

import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.Collections;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class AnalyticsControllerRouteVisitorTest {

    private static AnalyticsController controller(IAnalyticsEventService service) {
        AnalyticsController controller = new AnalyticsController();
        ReflectionTestUtils.setField(controller, "analyticsEventService", service);
        return controller;
    }

    @Test
    void routeVisitorRequiresBothDatesInStrictFormatBeforeServiceAccess() {
        IAnalyticsEventService service = mock(IAnalyticsEventService.class);
        AnalyticsController controller = controller(service);
        assertEquals("开始和结束日期不能为空", controller.routeVisitor(1L, null, "2026-11-02").get(AjaxResult.MSG_TAG));
        assertEquals("开始和结束日期不能为空", controller.routeVisitor(1L, "2026-11-01", " ").get(AjaxResult.MSG_TAG));
        for (String bad : new String[]{"2026-02-29", "2026-1-01", "+10000-01-01", "0000-01-01", "2026/11/01"}) {
            assertEquals("日期格式必须为 yyyy-MM-dd", controller.routeVisitor(1L, bad, "2026-11-02").get(AjaxResult.MSG_TAG));
        }
        verifyNoInteractions(service);
    }

    @Test
    void routeVisitorPassesParsedRangeAndReturnsServiceErrorsAsBusinessErrors() {
        IAnalyticsEventService service = mock(IAnalyticsEventService.class);
        Map<String, Object> report = Collections.singletonMap("topicId", 7L);
        LocalDate start = LocalDate.of(2026, 11, 1);
        LocalDate end = LocalDate.of(2026, 11, 3);
        when(service.routeVisitorReport(7L, start, end)).thenReturn(report);
        when(service.routeVisitorReport(8L, start, end)).thenThrow(new IllegalStateException("站点事实来源不可读，拒绝把未知报成 0"));
        AnalyticsController controller = controller(service);

        AjaxResult ok = controller.routeVisitor(7L, "2026-11-01", "2026-11-03");
        assertEquals(200, ok.get(AjaxResult.CODE_TAG));
        assertSame(report, ok.get(AjaxResult.DATA_TAG));

        AjaxResult unknown = controller.routeVisitor(8L, "2026-11-01", "2026-11-03");
        assertEquals(500, unknown.get(AjaxResult.CODE_TAG));
        assertEquals("站点事实来源不可读，拒绝把未知报成 0", unknown.get(AjaxResult.MSG_TAG));
    }

    @Test
    void exportWritesCsvOrJsonError() throws Exception {
        IAnalyticsEventService service = mock(IAnalyticsEventService.class);
        LocalDate start = LocalDate.of(2026, 11, 1);
        LocalDate end = LocalDate.of(2026, 11, 3);
        when(service.routeVisitorReportCsv(7L, start, end)).thenReturn("﻿主题,梧桐路线\r\n");
        when(service.routeVisitorReportCsv(9L, start, end)).thenThrow(new IllegalArgumentException("主题不存在"));
        AnalyticsController controller = controller(service);

        MockHttpServletResponse csv = new MockHttpServletResponse();
        controller.routeVisitorExport(csv, 7L, "2026-11-01", "2026-11-03");
        assertTrue(csv.getContentType().startsWith("text/csv"), csv.getContentType());
        assertEquals("﻿主题,梧桐路线\r\n", new String(csv.getContentAsByteArray(), StandardCharsets.UTF_8));

        MockHttpServletResponse failed = new MockHttpServletResponse();
        controller.routeVisitorExport(failed, 9L, "2026-11-01", "2026-11-03");
        assertTrue(failed.getContentType().startsWith("application/json"), "下载助手按 JSON 识别错误");
        assertTrue(failed.getContentAsString(StandardCharsets.UTF_8).contains("主题不存在"));

        MockHttpServletResponse invalid = new MockHttpServletResponse();
        controller.routeVisitorExport(invalid, 7L, null, "2026-11-03");
        assertTrue(invalid.getContentAsString(StandardCharsets.UTF_8).contains("开始和结束日期不能为空"));
    }
}
