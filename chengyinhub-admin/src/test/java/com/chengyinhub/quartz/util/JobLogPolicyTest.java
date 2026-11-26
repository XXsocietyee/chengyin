package com.chengyinhub.quartz.util;

import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.quartz.JobDataMap;
import org.quartz.JobExecutionContext;
import org.springframework.beans.factory.config.ConfigurableListableBeanFactory;
import org.springframework.test.util.ReflectionTestUtils;

import com.chengyinhub.common.constant.Constants;
import com.chengyinhub.common.constant.ScheduleConstants;
import com.chengyinhub.common.utils.spring.SpringUtils;
import com.chengyinhub.quartz.domain.SysJob;
import com.chengyinhub.quartz.domain.SysJobLog;
import com.chengyinhub.quartz.service.ISysJobLogService;
import com.chengyinhub.quartz.service.MySqlSchedulerCoordinator;
import com.chengyinhub.quartz.service.impl.SysJobServiceImpl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 审计 D2：sys_job_log 只记失败、手动执行与状态变化；任务本身每轮照常执行。 */
class JobLogPolicyTest
{
    private ISysJobLogService jobLogService;
    private ConfigurableListableBeanFactory originalBeanFactory;
    private int runs;

    @BeforeEach
    void setUp()
    {
        JobLogPolicy.resetForTest();
        originalBeanFactory = (ConfigurableListableBeanFactory) ReflectionTestUtils.getField(SpringUtils.class, "beanFactory");
        ConfigurableListableBeanFactory beanFactory = mock(ConfigurableListableBeanFactory.class);
        jobLogService = mock(ISysJobLogService.class);
        MySqlSchedulerCoordinator coordinator = mock(MySqlSchedulerCoordinator.class);
        SysJobServiceImpl jobs = mock(SysJobServiceImpl.class);
        when(beanFactory.getBean(ISysJobLogService.class)).thenReturn(jobLogService);
        when(beanFactory.getBean(MySqlSchedulerCoordinator.class)).thenReturn(coordinator);
        when(beanFactory.getBean(SysJobServiceImpl.class)).thenReturn(jobs);
        when(jobs.isCurrentInvocation(any(), anyBoolean())).thenReturn(true);
        when(coordinator.execute(anyString(), nullable(java.util.Date.class), any(Runnable.class))).thenAnswer(call -> {
            call.getArgument(2, Runnable.class).run(); return true;
        });
        ReflectionTestUtils.setField(SpringUtils.class, "beanFactory", beanFactory);
    }

    @AfterEach
    void tearDown()
    {
        JobLogPolicy.resetForTest();
        ReflectionTestUtils.setField(SpringUtils.class, "beanFactory", originalBeanFactory);
    }

    @Test
    void repeatedSuccessesAreLoggedOnceButTheTaskRunsEveryTime() throws Exception
    {
        for (int i = 0; i < 5; i++) job(null, false).execute(context(false));

        assertEquals(5, runs, "task behaviour unchanged: every scheduled run executes");
        assertEquals(List.of(Constants.SUCCESS), statuses(1));
    }

    @Test
    void everyFailureIsLoggedAndRecoveryIsLoggedOnce() throws Exception
    {
        job(null, false).execute(context(false));
        for (int i = 0; i < 2; i++)
        {
            try { job(new IllegalStateException("boom"), false).execute(context(false)); }
            catch (org.quartz.JobExecutionException expected) { /* failure still reaches Quartz */ }
        }
        job(null, false).execute(context(false));
        job(null, false).execute(context(false));

        assertEquals(List.of(Constants.SUCCESS, Constants.FAIL, Constants.FAIL, Constants.SUCCESS), statuses(4));
    }

    @Test
    void manualRunIsAlwaysLogged() throws Exception
    {
        job(null, false).execute(context(false));
        job(null, false).execute(context(true));
        job(null, true).execute(context(true));

        assertEquals(List.of(Constants.SUCCESS, Constants.SUCCESS, Constants.SUCCESS), statuses(3));
    }

    @Test
    void featureOffSkipIsNotLoggedOnSchedule() throws Exception
    {
        for (int i = 0; i < 3; i++) job(null, true).execute(context(false));

        assertEquals(3, runs);
        assertEquals(List.of(), statuses(0));
        assertTrue(JobRunOutcome.skipReason() == null, "skip marker does not leak to the next run on this thread");
    }

    @Test
    void forgetMakesTheNextRunAfterResumeVisible()
    {
        assertTrue(JobLogPolicy.shouldRecord(7L, Constants.SUCCESS, false, false));
        assertFalse(JobLogPolicy.shouldRecord(7L, Constants.SUCCESS, false, false));
        JobLogPolicy.forget(7L);
        assertTrue(JobLogPolicy.shouldRecord(7L, Constants.SUCCESS, false, false));
        assertTrue(JobLogPolicy.shouldRecord(null, Constants.SUCCESS, false, false), "unknown job id is always logged");
    }

    private List<String> statuses(int expected)
    {
        ArgumentCaptor<SysJobLog> captor = ArgumentCaptor.forClass(SysJobLog.class);
        verify(jobLogService, times(expected)).addJobLog(captor.capture());
        return captor.getAllValues().stream().map(SysJobLog::getStatus).toList();
    }

    private JobExecutionContext context(boolean manual)
    {
        SysJob job = new SysJob();
        job.setJobId(42L);
        job.setJobName("d2-job");
        job.setJobGroup("DEFAULT");
        job.setInvokeTarget("d2Task.run");
        JobDataMap dataMap = new JobDataMap();
        dataMap.put(ScheduleConstants.TASK_PROPERTIES, job);
        if (manual) dataMap.put("chengyin.manualJobInvocation", true);
        JobExecutionContext context = mock(JobExecutionContext.class);
        when(context.getMergedJobDataMap()).thenReturn(dataMap);
        return context;
    }

    private AbstractQuartzJob job(Exception failure, boolean skip)
    {
        return new AbstractQuartzJob()
        {
            @Override
            protected void doExecute(JobExecutionContext context, SysJob sysJob) throws Exception
            {
                runs++;
                if (skip) JobRunOutcome.skipped("feature-off");
                if (failure != null) throw failure;
            }
        };
    }
}
