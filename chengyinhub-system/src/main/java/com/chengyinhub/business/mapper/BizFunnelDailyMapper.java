package com.chengyinhub.business.mapper;

import com.chengyinhub.business.domain.BizFunnelDaily;
import org.apache.ibatis.annotations.Param;

import java.util.List;
import java.util.Map;
import java.util.Date;

/**
 * P3 每日漏斗汇总 Mapper。
 */
public interface BizFunnelDailyMapper {
    List<BizFunnelDaily> selectBizFunnelDailyList(BizFunnelDaily bizFunnelDaily);

    int deleteByStatDate(String statDate);

    int insertFromEventLog(String statDate);

    Map<String, Object> selectCommunityQualifiedPilotMetric(
            @Param("startDate") String startDate,
            @Param("endDate") String endDate);

    /**
     * R6 路线购买与游玩漏斗（只读）：按日 × 主题 × 步骤返回去重人数与事实数。
     * {@code from}/{@code toExclusive} 为 yyyy-MM-dd，半开区间。
     */
    List<Map<String, Object>> selectRouteFunnel(
            @Param("from") String from,
            @Param("toExclusive") String toExclusive);

    // ===== R7 路线与站点到访报告：只读聚合，结果里没有 member_id / 坐标 / 精确时间 =====

    Map<String, Object> selectRouteVisitorTopic(@Param("topicId") Long topicId);

    Long countRouteVisitorSessions(@Param("topicId") Long topicId);

    List<Map<String, Object>> selectRouteVisitorRunStats(@Param("topicId") Long topicId,
            @Param("from") Date from, @Param("to") Date to, @Param("byDay") boolean byDay);

    List<Map<String, Object>> selectRouteVisitorRefundDaily(@Param("topicId") Long topicId,
            @Param("from") Date from, @Param("to") Date to);

    List<Map<String, Object>> selectRouteVisitorStations(@Param("topicId") Long topicId);

    List<Map<String, Object>> selectRouteVisitorStationStats(@Param("topicId") Long topicId,
            @Param("from") Date from, @Param("to") Date to, @Param("byDay") boolean byDay);

    List<Map<String, Object>> selectRouteVisitorUndatedCompletions(@Param("topicId") Long topicId);
}
