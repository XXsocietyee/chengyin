package com.chengyinhub.quartz.util;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import com.chengyinhub.common.constant.Constants;

/**
 * 审计 D2：空闲系统每天约 1.1 万次调度、每次一行 sys_job_log，占库六成以上。
 *
 * 只在以下情况写 sys_job_log：
 * <ul>
 *   <li>失败（每次都写，失败不降噪）；</li>
 *   <li>手动「执行一次」（运维/验收需要看到这一次的回执）；</li>
 *   <li>状态变化：本进程内该任务第一次运行，或与上一次结果不同（失败→成功恢复也会写）；</li>
 *   <li>任务自己声明「功能关闭，本轮跳过」({@link JobRunOutcome#skipped}) 时一律不写（手动执行除外）。</li>
 * </ul>
 * 连续的成功只在应用日志里留一行，不再落库。任务的执行行为不变，只改记录方式。
 * 任务恢复、修改、删除时 {@link #forget} 清掉记忆，使恢复后的第一轮一定落库。
 */
public final class JobLogPolicy
{
    /** jobId → 上一次结果（Constants.SUCCESS / Constants.FAIL）。 */
    private static final Map<Long, String> LAST_STATUS = new ConcurrentHashMap<>();

    private JobLogPolicy()
    {
    }

    /**
     * 判断本轮是否写 sys_job_log，并记住本轮结果。
     *
     * @param jobId 任务 id；为空时总是写
     * @param status Constants.SUCCESS 或 Constants.FAIL
     * @param manual 是否手动执行一次
     * @param skipped 任务是否声明功能关闭而跳过
     */
    public static boolean shouldRecord(Long jobId, String status, boolean manual, boolean skipped)
    {
        if (manual)
        {
            if (jobId != null && !skipped) LAST_STATUS.put(jobId, status);
            return true;
        }
        if (Constants.FAIL.equals(status))
        {
            if (jobId != null) LAST_STATUS.put(jobId, status);
            return true;
        }
        if (skipped) return false;
        if (jobId == null) return true;
        String previous = LAST_STATUS.put(jobId, status);
        return !status.equals(previous);
    }

    /** 任务恢复/修改/删除后调用：下一轮视为状态变化，必定落库。 */
    public static void forget(Long jobId)
    {
        if (jobId != null) LAST_STATUS.remove(jobId);
    }

    /** 调度器初始化或重新取得 leader 时调用：之后每个任务的第一轮都视为状态变化，必定落库。 */
    public static void forgetAll()
    {
        LAST_STATUS.clear();
    }

    /** 仅测试用。 */
    static void resetForTest()
    {
        forgetAll();
    }
}
