package com.chengyinhub.business.service.impl;

import com.chengyinhub.business.domain.OfficialEvent;
import com.chengyinhub.business.mapper.EventSignupMapper;
import com.chengyinhub.business.mapper.OfficialEventMapper;
import com.chengyinhub.business.service.IOfficialEventV2Service;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.math.BigDecimal;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 审计 1122 E2:官方活动公开列表的报名人数、集体指标与本人报名态按整页一次查询,结果与逐场查询口径一致。
 */
class OfficialEventPublicListBatchTest {

    private static OfficialEvent event(long id, String metric, int threshold) {
        OfficialEvent e = new OfficialEvent();
        e.setId(id);
        e.setContractVersion(1);
        if (metric != null) {
            e.setCollectiveEnabled(1);
            e.setCollectiveMetric(metric);
            e.setCollectiveThreshold(threshold);
        }
        return e;
    }

    private static Map<String, Object> stats(long id, long signup, BigDecimal done, BigDecimal progress) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("eventId", id);
        r.put("signupCount", signup);
        r.put("doneCount", done);
        r.put("progressSum", progress);
        return r;
    }

    @Test
    @SuppressWarnings("unchecked")
    void wholePageUsesTwoQueriesAndKeepsPerEventFigures() {
        OfficialEventMapper events = mock(OfficialEventMapper.class);
        EventSignupMapper signups = mock(EventSignupMapper.class);
        IOfficialEventV2Service v2 = mock(IOfficialEventV2Service.class);
        OfficialEventServiceImpl svc = new OfficialEventServiceImpl();
        ReflectionTestUtils.setField(svc, "eventMapper", events);
        ReflectionTestUtils.setField(svc, "signupMapper", signups);
        ReflectionTestUtils.setField(svc, "officialEventV2Service", v2);

        when(events.selectPublicList("杭州")).thenReturn(Arrays.asList(
                event(1, "complete_count", 4), event(2, "light_count", 10), event(3, null, 0)));
        when(signups.selectStatsByEvents(any())).thenReturn(Arrays.asList(
                stats(1, 5, BigDecimal.valueOf(2), BigDecimal.valueOf(9)),
                stats(2, 3, BigDecimal.ZERO, BigDecimal.valueOf(7))));
        when(signups.selectSignedEventIds(any(), eq(42L))).thenReturn(Collections.singletonList(2L));
        when(v2.listPublic("杭州", 42L)).thenReturn(Collections.emptyList());

        List<Map<String, Object>> rows = svc.listPublic("杭州", 42L);

        assertEquals(3, rows.size());
        assertEquals(5, rows.get(0).get("participants"));
        assertEquals(3, rows.get(1).get("participants"));
        assertEquals(0, rows.get(2).get("participants"), "没有报名的活动按 0 人");
        Map<String, Object> c1 = (Map<String, Object>) rows.get(0).get("collective");
        assertEquals(2, c1.get("current"));
        assertEquals(50, c1.get("pct"));
        Map<String, Object> c2 = (Map<String, Object>) rows.get(1).get("collective");
        assertEquals(7, c2.get("current"));
        assertEquals(false, ((Map<String, Object>) rows.get(2).get("collective")).get("enabled"));
        assertEquals(false, rows.get(0).get("signed"));
        assertEquals(true, rows.get(1).get("signed"));

        verify(signups, times(1)).selectStatsByEvents(any());
        verify(signups, times(1)).selectSignedEventIds(any(), any());
        verify(signups, never()).countByEvent(anyLong());
        verify(signups, never()).countDoneByEvent(anyLong());
        verify(signups, never()).sumProgressByEvent(anyLong());
        verify(signups, never()).selectByEventAndMember(anyLong(), anyLong());
    }

    @Test
    void guestsDoNotTriggerTheSignedQuery() {
        OfficialEventMapper events = mock(OfficialEventMapper.class);
        EventSignupMapper signups = mock(EventSignupMapper.class);
        IOfficialEventV2Service v2 = mock(IOfficialEventV2Service.class);
        OfficialEventServiceImpl svc = new OfficialEventServiceImpl();
        ReflectionTestUtils.setField(svc, "eventMapper", events);
        ReflectionTestUtils.setField(svc, "signupMapper", signups);
        ReflectionTestUtils.setField(svc, "officialEventV2Service", v2);
        when(events.selectPublicList(null)).thenReturn(Collections.singletonList(event(1, null, 0)));

        List<Map<String, Object>> rows = svc.listPublic(null, null);

        assertEquals(1, rows.size());
        assertEquals(false, rows.get(0).containsKey("signed"));
        verify(signups, never()).selectSignedEventIds(any(), any());
    }
}
