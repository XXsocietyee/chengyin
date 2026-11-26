package com.chengyinhub.quartz.util;

/**
 * 审计 D2「功能关闭的任务跳过」：任务方法在功能开关关闭、本轮什么都不做时调用
 * {@link #skipped(String)}，调度层就不为这一轮写 sys_job_log（手动执行一次除外）。
 * 只影响记录，不影响任务本身的行为：调用方照常 return。
 *
 * 作用域是当前调度线程的这一次执行，执行结束后由 {@link AbstractQuartzJob} 清理。
 */
public final class JobRunOutcome
{
    private static final ThreadLocal<String> SKIP_REASON = new ThreadLocal<>();

    private JobRunOutcome()
    {
    }

    /** 声明本轮因功能关闭而跳过；reason 只进应用日志，不落库。 */
    public static void skipped(String reason)
    {
        SKIP_REASON.set(reason == null || reason.isBlank() ? "feature-off" : reason);
    }

    static String skipReason()
    {
        return SKIP_REASON.get();
    }

    static void clear()
    {
        SKIP_REASON.remove();
    }
}
