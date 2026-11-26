package com.chengyinhub.quartz.service.impl;

import java.util.Date;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import com.chengyinhub.quartz.mapper.SysJobLogMapper;
import com.chengyinhub.quartz.service.MySqlSchedulerCoordinator;

/**
 * 审计 D2：sys_job_log 只保留最近 N 天（默认 30，与数据留存任务共用 chengyin.retention.ops-log-days）。
 *
 * 调度日志表归调度模块所有，所以由这里删除，不经业务留存任务。每天低峰跑一次，只在调度 leader 上执行；
 * 分批删除、每批独立提交，不锁表。保留天数 &lt;= 0 关闭。只删日志，不碰任何任务定义与业务数据。
 */
@Component
public class SysJobLogRetention
{
    private static final Logger log = LoggerFactory.getLogger(SysJobLogRetention.class);
    private static final long DAY_MILLIS = 24L * 60 * 60 * 1000;

    @Autowired
    private SysJobLogMapper jobLogMapper;

    @Autowired
    private MySqlSchedulerCoordinator coordinator;

    @Value("${chengyin.retention.ops-log-days:30}")
    private int retentionDays = 30;

    @Value("${chengyin.retention.batch-size:1000}")
    private int batchSize = 1000;

    @Value("${chengyin.retention.max-batches:500}")
    private int maxBatches = 500;

    @Scheduled(cron = "${chengyin.quartz.job-log.prune-cron:0 40 3 * * ?}")
    public void scheduledPrune()
    {
        if (!coordinator.isLeader()) return;
        try
        {
            prune(System.currentTimeMillis());
        }
        catch (RuntimeException e)
        {
            log.error("event=quartz.job_log.prune.failure errorType={}", e.getClass().getSimpleName(), e);
        }
    }

    /** 删 now - retentionDays 之前的调度日志，返回删除行数。 */
    public int prune(long now)
    {
        if (retentionDays <= 0 || batchSize <= 0 || maxBatches <= 0) return 0;
        Date cutoff = new Date(now - (long) retentionDays * DAY_MILLIS);
        int total = 0;
        for (int i = 0; i < maxBatches; i++)
        {
            int affected = jobLogMapper.deleteJobLogsBefore(cutoff, batchSize);
            total += affected;
            if (affected < batchSize) break;
        }
        log.info("event=quartz.job_log.prune deleted={} retentionDays={}", total, retentionDays);
        return total;
    }
}
