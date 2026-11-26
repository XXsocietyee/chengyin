package com.chengyinhub.business.service;

import com.chengyinhub.business.domain.dto.AnalyticsBatchDTO;

import java.time.LocalDate;
import java.util.Map;

/**
 * P3 行为事件服务。
 */
public interface IAnalyticsEventService {
    /** Number of durable request events including matching replays; conflicts roll back the batch. */
    int recordBatch(Long memberId, AnalyticsBatchDTO request);

    Long visibleCommunityPostAuthor(Long memberId, Long postId);

    int aggregateDaily(String statDate);

    /**
     * R6 路线购买与游玩漏斗（只读，按日 × 主题），含首尾日期。
     * 事实读取失败抛 {@link IllegalStateException}，调用方报错而不是展示 0。
     */
    Map<String, Object> routeFunnel(LocalDate startDate, LocalDate endDate);

    /**
     * repeat_signup_v1（owner CO-06）：首笔有效购买落在 cohort 窗口内的用户，30 天内另有独立有效购买的占比。
     * 事实读取失败抛 {@link IllegalStateException}，不得回落成 0%。
     */
    Map<String, Object> repeatSignup(LocalDate cohortStart, LocalDate cohortEnd);

    /**
     * R7 路线与站点到访报告（平台后台只读，交给赞助方）：按主题、按站点、按天聚合。
     * 只返回聚合值；少于 3 名去重玩家的格子显示 {@code "<3"}；无事实源的值为 null（界面显示破折号），从不补 0。
     */
    Map<String, Object> routeVisitorReport(Long topicId, LocalDate startDate, LocalDate endDate);

    /** 同一份报告的 CSV（UTF-8 BOM），内容与 {@link #routeVisitorReport} 完全同源。 */
    String routeVisitorReportCsv(Long topicId, LocalDate startDate, LocalDate endDate);
}
