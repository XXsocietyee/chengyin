package com.chengyinhub.quartz.service;

import java.util.Date;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import com.chengyinhub.quartz.mapper.SysJobLogMapper;
import com.chengyinhub.quartz.service.impl.SysJobLogRetention;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/** 审计 D2：调度日志按保留天数分批删除，只在 leader 上跑，失败不外抛。 */
class SysJobLogRetentionTest
{
    private final SysJobLogMapper mapper = mock(SysJobLogMapper.class);
    private final MySqlSchedulerCoordinator coordinator = mock(MySqlSchedulerCoordinator.class);

    private SysJobLogRetention retention(int days, int batch, int maxBatches)
    {
        SysJobLogRetention r = new SysJobLogRetention();
        ReflectionTestUtils.setField(r, "jobLogMapper", mapper);
        ReflectionTestUtils.setField(r, "coordinator", coordinator);
        ReflectionTestUtils.setField(r, "retentionDays", days);
        ReflectionTestUtils.setField(r, "batchSize", batch);
        ReflectionTestUtils.setField(r, "maxBatches", maxBatches);
        return r;
    }

    @Test
    void deletesThirtyDayOldRowsInBatchesUntilClean()
    {
        when(mapper.deleteJobLogsBefore(any(), eq(1000))).thenReturn(1000, 1000, 7);
        long now = 1_800_000_000_000L;

        assertEquals(2007, retention(30, 1000, 500).prune(now));
        ArgumentCaptor<Date> cutoff = ArgumentCaptor.forClass(Date.class);
        verify(mapper, times(3)).deleteJobLogsBefore(cutoff.capture(), eq(1000));
        assertEquals(now - 30L * 24 * 60 * 60 * 1000, cutoff.getValue().getTime());
    }

    @Test
    void stopsAtMaxBatchesAndCanBeSwitchedOff()
    {
        when(mapper.deleteJobLogsBefore(any(), eq(10))).thenReturn(10);
        assertEquals(20, retention(30, 10, 2).prune(0L));
        verify(mapper, times(2)).deleteJobLogsBefore(any(), anyInt());

        clearInvocations(mapper);
        assertEquals(0, retention(0, 10, 2).prune(0L));
        verifyNoInteractions(mapper);
    }

    @Test
    void scheduledRunIsLeaderOnlyAndNeverThrows()
    {
        when(coordinator.isLeader()).thenReturn(false);
        retention(30, 10, 2).scheduledPrune();
        verifyNoInteractions(mapper);

        when(coordinator.isLeader()).thenReturn(true);
        when(mapper.deleteJobLogsBefore(any(), anyInt())).thenThrow(new IllegalStateException("db down"));
        retention(30, 10, 2).scheduledPrune();
        verify(mapper).deleteJobLogsBefore(any(), eq(10));
    }
}
