package com.chengyinhub.web.controller.business;

import com.chengyinhub.business.domain.BizFunnelDaily;
import com.chengyinhub.business.mapper.BizFunnelDailyMapper;
import com.chengyinhub.common.core.controller.BaseController;
import com.chengyinhub.business.service.IAnalyticsEventService;
import com.chengyinhub.business.service.IPostGameOutcomeReportService;
import com.chengyinhub.common.core.domain.AjaxResult;
import com.chengyinhub.common.utils.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import com.chengyinhub.common.annotation.Log;
import com.chengyinhub.common.enums.BusinessType;
import com.chengyinhub.common.utils.ServletUtils;
import com.alibaba.fastjson2.JSON;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

/**
 * P3 运营分析后台入口。
 */
@RestController
@RequestMapping("/business/analytics")
public class AnalyticsController extends BaseController {

    /** owner 2026-10-23 D3(P0-48):漏斗查询窗口上限(含首尾,天)与缺省窗口。 */
    static final int FUNNEL_MAX_WINDOW_DAYS = 90;
    static final int FUNNEL_DEFAULT_WINDOW_DAYS = 30;

    /** 完局复报缺省观察窗（天）；与报表服务支持的 7/30/90 保持一致。 */
    static final int REPORT_DEFAULT_WINDOW_DAYS = 30;

    @Autowired
    private BizFunnelDailyMapper bizFunnelDailyMapper;

    @Autowired
    private IPostGameOutcomeReportService postGameOutcomeReportService;

    @Autowired
    private IAnalyticsEventService analyticsEventService;

    /** 「今天」按运营所在时区取;单测替换为固定时钟。 */
    private Clock clock = Clock.system(ZoneId.of("Asia/Shanghai"));

    @PreAuthorize("@ss.hasPermi('business:analytics:list')")
    @GetMapping("/funnel")
    public AjaxResult funnel(String startDate, String endDate) {
        final LocalDate start;
        final LocalDate end;
        try {
            start = StringUtils.isNotBlank(startDate) ? LocalDate.parse(startDate) : null;
            end = StringUtils.isNotBlank(endDate) ? LocalDate.parse(endDate) : null;
        } catch (DateTimeParseException e) {
            return error("日期格式必须为 yyyy-MM-dd");
        }
        // LocalDate 还接受零年和扩展年份，这里保留正四位年份的日期合同。
        if ((start != null && (startDate.length() != 10 || start.getYear() < 1))
                || (end != null && (endDate.length() != 10 || end.getYear() < 1))) {
            return error("日期格式必须为 yyyy-MM-dd");
        }
        if (start != null && end != null && start.isAfter(end)) {
            return error("开始日期不能晚于结束日期");
        }
        // D3:窗口必须有界。都不传 = 最近 30 天(含今天);只传一端 = 从该端起算 30 天。
        LocalDate effectiveStart;
        LocalDate effectiveEnd;
        if (start == null && end == null) {
            effectiveEnd = LocalDate.now(clock);
            effectiveStart = effectiveEnd.minusDays(FUNNEL_DEFAULT_WINDOW_DAYS - 1);
        } else if (start == null) {
            effectiveEnd = end;
            effectiveStart = end.minusDays(FUNNEL_DEFAULT_WINDOW_DAYS - 1);
        } else if (end == null) {
            effectiveStart = start;
            effectiveEnd = start.plusDays(FUNNEL_DEFAULT_WINDOW_DAYS - 1);
        } else {
            effectiveStart = start;
            effectiveEnd = end;
        }
        if (ChronoUnit.DAYS.between(effectiveStart, effectiveEnd) + 1 > FUNNEL_MAX_WINDOW_DAYS) {
            return error("查询窗口不能超过" + FUNNEL_MAX_WINDOW_DAYS + "天");
        }
        if (effectiveStart.getYear() < 1 || effectiveEnd.getYear() > 9999) {
            return error("日期超出可查询范围");
        }
        BizFunnelDaily query = new BizFunnelDaily();
        query.getParams().put("beginStatDate", effectiveStart.toString());
        query.getParams().put("endStatDate", effectiveEnd.toString());
        List<BizFunnelDaily> rows = bizFunnelDailyMapper.selectBizFunnelDailyList(query);
        Map<String, Object> data = new HashMap<>();
        data.put("startDate", effectiveStart.toString());
        data.put("endDate", effectiveEnd.toString());
        data.put("rows", rows);
        return success(data);
    }

    @PreAuthorize("@ss.hasPermi('business:analytics:list')")
    @GetMapping("/community-qualified-pilot")
    public AjaxResult communityQualifiedPilot(String startDate, String endDate) {
        if (StringUtils.isBlank(startDate) || StringUtils.isBlank(endDate)) {
            return error("开始和结束日期不能为空");
        }
        final LocalDate start;
        final LocalDate end;
        try {
            start = LocalDate.parse(startDate);
            end = LocalDate.parse(endDate);
        } catch (DateTimeParseException e) {
            return error("日期格式必须为 yyyy-MM-dd");
        }
        if (startDate.length() != 10 || endDate.length() != 10
                || start.getYear() < 1 || end.getYear() < 1) {
            return error("日期格式必须为 yyyy-MM-dd");
        }
        long inclusiveDays = ChronoUnit.DAYS.between(start, end) + 1;
        if (inclusiveDays < 1 || inclusiveDays > 62) {
            return error("查询窗口必须在1至62天内");
        }
        Map<String, Object> data = new HashMap<>();
        data.put("startDate", startDate);
        data.put("endDate", endDate);
        data.put("deduplication", "DISTINCT_USER_POST_ACROSS_WINDOW");
        data.put("authorCoverageSemantics", "CURRENT_NON_ERASED_POST_AUTHOR");
        data.put("metric",
                bizFunnelDailyMapper.selectCommunityQualifiedPilotMetric(startDate, endDate));
        return success(data);
    }

    /**
     * 完局维护与有效复报：只读，按当前源表即时计算。
     *
     * <p>只读语义：本端点不落库、不写修订，权限沿用读取权限 {@code business:analytics:list}，
     * 不因为「能查看报表」而获得任何写权限。响应里带 {@code computedAt}、各来源水位和口径版本，
     * 并明确 {@code historicalReplayable=false} —— 它<b>不是</b>可回放的历史快照。
     *
     * <p>失败语义：参数非法与数据源不可读都返回业务错误，<b>不返回 0</b>。
     */
    @PreAuthorize("@ss.hasPermi('business:analytics:list')")
    @GetMapping("/post-game-outcome")
    public AjaxResult postGameOutcome(String cohortDate, Integer windowDays) {
        if (StringUtils.isBlank(cohortDate)) {
            return error("cohortDate 不能为空");
        }
        final LocalDate cohort;
        try {
            cohort = LocalDate.parse(cohortDate);
        } catch (DateTimeParseException e) {
            return error("日期格式必须为 yyyy-MM-dd");
        }
        if (cohortDate.length() != 10 || cohort.getYear() < 1) {
            return error("日期格式必须为 yyyy-MM-dd");
        }
        int window = windowDays == null ? REPORT_DEFAULT_WINDOW_DAYS : windowDays;
        try {
            return success(postGameOutcomeReportService.generate(cohort, window));
        } catch (IllegalArgumentException invalid) {
            return error(invalid.getMessage());
        } catch (IllegalStateException unavailable) {
            // 数据源读不到 ⇒ 明确报错；不得把未知数据当成 0 展示。
            return error(unavailable.getMessage());
        }
    }

    /**
     * R6 路线购买与游玩漏斗（服务端事实，只读）。窗口规则与 {@link #funnel} 相同：缺省最近 30 天，最多 90 天。
     * 读取失败返回业务错误，不返回 0。
     */
    @PreAuthorize("@ss.hasPermi('business:analytics:list')")
    @GetMapping("/route-funnel")
    public AjaxResult routeFunnel(String startDate, String endDate) {
        Object window = boundedWindow(startDate, endDate);
        if (window instanceof String message) {
            return error(message);
        }
        LocalDate[] range = (LocalDate[]) window;
        try {
            return success(analyticsEventService.routeFunnel(range[0], range[1]));
        } catch (IllegalStateException unavailable) {
            return error(unavailable.getMessage());
        }
    }

    /**
     * repeat_signup_v1（owner CO-06）：cohort 窗口内首笔有效购买用户的 30 天复购率（只读）。
     * 窗口规则同 {@link #funnel}。读取失败返回业务错误，不返回 0%。
     */
    @PreAuthorize("@ss.hasPermi('business:analytics:list')")
    @GetMapping("/repeat-signup")
    public AjaxResult repeatSignup(String cohortStart, String cohortEnd) {
        Object window = boundedWindow(cohortStart, cohortEnd);
        if (window instanceof String message) {
            return error(message);
        }
        LocalDate[] range = (LocalDate[]) window;
        try {
            return success(analyticsEventService.repeatSignup(range[0], range[1]));
        } catch (IllegalStateException unavailable) {
            return error(unavailable.getMessage());
        }
    }

    /** 与 funnel 同一窗口合同；返回 {start, end} 或错误文案。末日 +1 天不得越过 9999 年。 */
    private Object boundedWindow(String startDate, String endDate) {
        final LocalDate start;
        final LocalDate end;
        try {
            start = StringUtils.isNotBlank(startDate) ? LocalDate.parse(startDate) : null;
            end = StringUtils.isNotBlank(endDate) ? LocalDate.parse(endDate) : null;
        } catch (DateTimeParseException e) {
            return "日期格式必须为 yyyy-MM-dd";
        }
        if ((start != null && (startDate.length() != 10 || start.getYear() < 1))
                || (end != null && (endDate.length() != 10 || end.getYear() < 1))) {
            return "日期格式必须为 yyyy-MM-dd";
        }
        if (start != null && end != null && start.isAfter(end)) {
            return "开始日期不能晚于结束日期";
        }
        LocalDate effectiveEnd = end != null ? end
                : start != null ? start.plusDays(FUNNEL_DEFAULT_WINDOW_DAYS - 1) : LocalDate.now(clock);
        LocalDate effectiveStart = start != null ? start : effectiveEnd.minusDays(FUNNEL_DEFAULT_WINDOW_DAYS - 1);
        if (ChronoUnit.DAYS.between(effectiveStart, effectiveEnd) + 1 > FUNNEL_MAX_WINDOW_DAYS) {
            return "查询窗口不能超过" + FUNNEL_MAX_WINDOW_DAYS + "天";
        }
        if (effectiveStart.getYear() < 1 || effectiveEnd.getYear() >= 9999) {
            return "日期超出可查询范围";
        }
        return new LocalDate[] {effectiveStart, effectiveEnd};
    }

    /**
     * R7 路线与站点到访报告：平台后台只读，按主题 × 站点 × 天聚合，交给赞助方。
     *
     * <p>只出聚合值；少于 3 名去重玩家的格子为 {@code "<3"}；无事实源的值为 null（页面显示破折号），不补 0。
     * 参数非法与来源不可读都返回业务错误。
     */
    @PreAuthorize("@ss.hasPermi('business:analytics:list')")
    @GetMapping("/route-visitor")
    public AjaxResult routeVisitor(Long topicId, String startDate, String endDate) {
        LocalDate[] range = new LocalDate[2];
        String invalid = routeVisitorRange(startDate, endDate, range);
        if (invalid != null) {
            return error(invalid);
        }
        try {
            return success(analyticsEventService.routeVisitorReport(topicId, range[0], range[1]));
        } catch (IllegalArgumentException | IllegalStateException failure) {
            return error(failure.getMessage());
        }
    }

    /**
     * 同一份报告导出 CSV。本控制器只开 GET 只读端点（见 AnalyticsControllerPostGameOutcomeTest），
     * 所以导出走 GET + blob；失败时回 JSON 错误，前端与 {@code this.download} 同样按 content-type 区分。
     */
    @PreAuthorize("@ss.hasPermi('business:analytics:list')")
    @Log(title = "路线到访报告", businessType = BusinessType.EXPORT)
    @GetMapping("/route-visitor/export")
    public void routeVisitorExport(HttpServletResponse response, Long topicId, String startDate, String endDate)
            throws IOException {
        LocalDate[] range = new LocalDate[2];
        String invalid = routeVisitorRange(startDate, endDate, range);
        final String csv;
        try {
            if (invalid != null) {
                throw new IllegalArgumentException(invalid);
            }
            csv = analyticsEventService.routeVisitorReportCsv(topicId, range[0], range[1]);
        } catch (IllegalArgumentException | IllegalStateException failure) {
            ServletUtils.renderString(response, JSON.toJSONString(AjaxResult.error(failure.getMessage())));
            return;
        }
        response.setContentType("text/csv;charset=UTF-8");
        response.setCharacterEncoding("UTF-8");
        response.setHeader("Content-Disposition", "attachment; filename=route_visitor_" + topicId + "_"
                + range[0] + "_" + range[1] + ".csv");
        response.getOutputStream().write(csv.getBytes(StandardCharsets.UTF_8));
    }

    /** 到访报告必须给出完整起止日（不默认窗口），格式与漏斗同一合同。 */
    private static String routeVisitorRange(String startDate, String endDate, LocalDate[] range) {
        if (StringUtils.isBlank(startDate) || StringUtils.isBlank(endDate)) {
            return "开始和结束日期不能为空";
        }
        try {
            range[0] = LocalDate.parse(startDate);
            range[1] = LocalDate.parse(endDate);
        } catch (DateTimeParseException e) {
            return "日期格式必须为 yyyy-MM-dd";
        }
        if (startDate.length() != 10 || endDate.length() != 10
                || range[0].getYear() < 1 || range[1].getYear() < 1) {
            return "日期格式必须为 yyyy-MM-dd";
        }
        return null;
    }
}
