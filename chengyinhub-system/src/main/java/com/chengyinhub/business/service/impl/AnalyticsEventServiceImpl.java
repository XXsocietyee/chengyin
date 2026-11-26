package com.chengyinhub.business.service.impl;

import com.chengyinhub.business.domain.BizEventLog;
import com.chengyinhub.business.domain.dto.AnalyticsBatchDTO;
import com.chengyinhub.business.domain.dto.AnalyticsEventDTO;
import com.chengyinhub.business.mapper.BizEventLogMapper;
import com.chengyinhub.business.mapper.BizFunnelDailyMapper;
import com.chengyinhub.business.mapper.CommunityPostMapper;
import com.chengyinhub.business.service.IAnalyticsEventService;
import com.chengyinhub.business.service.IRecommendationService;
import com.chengyinhub.common.utils.DateUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.chengyinhub.business.domain.dto.RegistrationCohortFact;
import com.chengyinhub.business.mapper.PostGameOutcomeMapper;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.TreeMap;
import java.util.function.Predicate;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.JsonNode;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.Comparator;

/**
 * P3 行为事件服务实现。
 */
@Service
public class AnalyticsEventServiceImpl implements IAnalyticsEventService {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final ZoneId ANALYTICS_ZONE = ZoneId.of("Asia/Shanghai");
    @Autowired
    private BizEventLogMapper bizEventLogMapper;

    @Autowired
    private BizFunnelDailyMapper bizFunnelDailyMapper;

    @Autowired
    private IRecommendationService recommendationService;

    @Autowired
    private CommunityPostMapper communityPostMapper;

    /** 复用完局/复报报表的只读报名事实源（cms_registration + refund_application），不另写一份口径。 */
    @Autowired
    private PostGameOutcomeMapper postGameOutcomeMapper;

    /** 数据截止时刻；单测替换为固定时钟。 */
    private Clock clock = Clock.system(ANALYTICS_ZONE);

    static final String ROUTE_FUNNEL_VERSION = "route_funnel_v1";
    static final String REPEAT_SIGNUP_VERSION = "repeat_signup_v1";
    static final int REPEAT_WINDOW_DAYS = 30;
    private static final int MEMBER_BATCH = 500;
    /** 漏斗步骤顺序；与 BizFunnelDailyMapper.selectRouteFunnel 的 step_code 一一对应。 */
    static final List<String> ROUTE_FUNNEL_STEPS = List.of(
            "detail_view", "checkout_open", "order_created", "paid", "paid_cash",
            "play_started", "completed", "refunded");

    @Override
    @Transactional(rollbackFor = Exception.class)
    public int recordBatch(Long memberId, AnalyticsBatchDTO request) {
        if (request == null || request.getEvents() == null || request.getEvents().isEmpty()) {
            return 0;
        }
        int accepted = 0;
        for (AnalyticsEventDTO item : request.getEvents()) {
            Date occurredAt = item.getOccurredAt() == null ? new Date() : item.getOccurredAt();
            BizEventLog event = new BizEventLog();
            event.setEventName(item.getEventName());
            event.setMemberId(memberId);
            // 成员归因使用认证态 memberId，不持久化客户端可控的 openid/anonymousId。
            event.setAnonymousId("");
            event.setSessionId(item.getSessionId());
            event.setSource(item.getSource());
            event.setPagePath(item.getPagePath());
            event.setBizType(item.getBizType());
            event.setBizId(item.getBizId());
            event.setCityCode(item.getCityCode());
            event.setPropertiesJson(item.getPropertiesJson());
            if ("community_post_qualified_view".equals(item.getEventName())) {
                // 原始事件按 user-post-day 去重；跨日消费保留，试点窗口分母再按 user-post 去重。
                String statDate = occurredAt.toInstant().atZone(ANALYTICS_ZONE)
                        .toLocalDate().format(DateTimeFormatter.ISO_LOCAL_DATE);
                event.setIdempotencyKey("community-post-qualified-" + item.getBizId() + "-" + statDate);
            } else {
                event.setIdempotencyKey(item.getIdempotencyKey());
            }
            event.setActorScope(memberId == null ? "ANONYMOUS" : "MEMBER:" + memberId);
            event.setOccurredAt(occurredAt);
            if (isRegistrationOutcome(item.getEventName())) {
                bindRegistrationFact(memberId, event);
            }
            event.setCreateTime(DateUtils.getNowDate());
            int inserted = bizEventLogMapper.insertBizEventLog(event);
            if (inserted == 1) {
                recommendationService.updateProfileFromEvent(event);
            }
            if (inserted != 1) {
                BizEventLog existing = bizEventLogMapper.selectIdempotentEventForUpdate(event);
                if (existing == null || !sameEvent(existing, event, item.getOccurredAt() == null)) {
                    throw new IllegalArgumentException("事件幂等键已用于不同内容或未确认落库");
                }
            }
            // 持久化重复事件同样得到确认，但不重复画像副作用。
            accepted++;
        }
        return accepted;
    }

    private boolean isRegistrationOutcome(String eventName) {
        return "signup_submit".equals(eventName) || "payment_success".equals(eventName);
    }

    private void bindRegistrationFact(Long memberId, BizEventLog event) {
        Long registrationId;
        try {
            JsonNode properties = JSON.readTree(event.getPropertiesJson() == null ? "{}" : event.getPropertiesJson());
            JsonNode rawId = properties == null ? null : properties.get("registrationId");
            String value = rawId == null ? "" : rawId.asText();
            if (!value.matches("[1-9][0-9]{0,18}")) throw new IllegalArgumentException();
            registrationId = Long.valueOf(value);
        } catch (Exception invalidId) {
            throw new IllegalArgumentException("成交埋点必须关联原报名事实");
        }
        BizEventLog fact = bizEventLogMapper.selectRegistrationEventFact(memberId, registrationId, event.getEventName());
        if (fact == null || fact.getOccurredAt() == null
                || !Objects.equals(fact.getBizId(), event.getBizId())
                || !Objects.equals(fact.getBizType(), event.getBizType())) {
            throw new IllegalArgumentException("成交埋点必须关联原报名事实");
        }
        // 客户端成功观察不能造订单或金额；原报名身份防止换幂等键重复计权。
        event.setIdempotencyKey("registration-" + registrationId);
        event.setOccurredAt(fact.getOccurredAt());
        event.setPropertiesJson("{\"registrationId\":" + registrationId + "}");
    }

    private boolean sameEvent(BizEventLog existing, BizEventLog requested, boolean serverAssignedTime) {
        if (!Objects.equals(existing.getMemberId(), requested.getMemberId())
                || !Objects.equals(existing.getEventName(), requested.getEventName())
                || !Objects.equals(existing.getBizId(), requested.getBizId())
                || !Objects.equals(emptyToNull(existing.getBizType()), emptyToNull(requested.getBizType()))) {
            return false;
        }
        // 合格阅读的已确定身份为 user/post/day，不以另一会话或阅读时刻重复计数。
        if ("community_post_qualified_view".equals(requested.getEventName())
                || isRegistrationOutcome(requested.getEventName())) return true;
        return Objects.equals(emptyToNull(existing.getSessionId()), emptyToNull(requested.getSessionId()))
                && Objects.equals(emptyToNull(existing.getSource()), emptyToNull(requested.getSource()))
                && Objects.equals(emptyToNull(existing.getPagePath()), emptyToNull(requested.getPagePath()))
                && Objects.equals(emptyToNull(existing.getCityCode()), emptyToNull(requested.getCityCode()))
                && sameProperties(existing.getPropertiesJson(), requested.getPropertiesJson())
                && (serverAssignedTime || (existing.getOccurredAt() != null && requested.getOccurredAt() != null
                && existing.getOccurredAt().getTime() / 1000 == requested.getOccurredAt().getTime() / 1000));
    }

    private String emptyToNull(String value) { return value == null || value.isEmpty() ? null : value; }

    private boolean sameProperties(String left, String right) {
        try {
            return Objects.equals(JSON.readTree(left == null || left.isEmpty() ? "{}" : left),
                    JSON.readTree(right == null || right.isEmpty() ? "{}" : right));
        } catch (Exception e) {
            return false;
        }
    }

    @Override
    public Long visibleCommunityPostAuthor(Long memberId, Long postId) {
        if (memberId == null || postId == null || postId <= 0) {
            return null;
        }
        com.chengyinhub.business.domain.community.CommunityPost post =
                communityPostMapper.selectById(postId, memberId);
        return post == null ? null : post.getAuthorId();
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public int aggregateDaily(String statDate) {
        bizFunnelDailyMapper.deleteByStatDate(statDate);
        return bizFunnelDailyMapper.insertFromEventLog(statDate);
    }

    @Override
    public Map<String, Object> routeFunnel(LocalDate startDate, LocalDate endDate) {
        Instant cutoff = clock.instant();
        List<Map<String, Object>> facts = bizFunnelDailyMapper.selectRouteFunnel(
                startDate.toString(), endDate.plusDays(1).toString());
        if (facts == null) {
            throw new IllegalStateException("路线漏斗事实读取失败");
        }
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("definitionVersion", ROUTE_FUNNEL_VERSION);
        data.put("startDate", startDate.toString());
        data.put("endDate", endDate.toString());
        data.put("dataCutoffAt", Date.from(cutoff));
        data.put("steps", ROUTE_FUNNEL_STEPS);
        data.put("rows", pivotRouteFunnel(facts));
        return data;
    }

    /**
     * 按 (日期, 主题) 展平成一行：每步给 {step}Members（去重人数）与 {step}Facts（去重事实数：订单/局/退款单/事件）。
     * 查询成功但没有该步事实 ⇒ 真 0；整个查询失败已在上游报错。
     */
    static List<Map<String, Object>> pivotRouteFunnel(List<Map<String, Object>> facts) {
        Map<String, Map<String, Object>> rows = new LinkedHashMap<>();
        for (Map<String, Object> fact : facts) {
            String statDate = String.valueOf(column(fact, "stat_date"));
            Object topicId = column(fact, "topic_id");
            String step = String.valueOf(column(fact, "step_code"));
            if (!ROUTE_FUNNEL_STEPS.contains(step)) continue;
            Map<String, Object> row = rows.computeIfAbsent(statDate + "|" + topicId, key -> {
                Map<String, Object> created = new LinkedHashMap<>();
                created.put("statDate", statDate);
                created.put("topicId", topicId == null ? null : ((Number) topicId).longValue());
                created.put("topicName", column(fact, "topic_name"));
                for (String name : ROUTE_FUNNEL_STEPS) {
                    created.put(camel(name) + "Members", 0L);
                    created.put(camel(name) + "Facts", 0L);
                }
                return created;
            });
            row.put(camel(step) + "Members", number(column(fact, "member_count")));
            row.put(camel(step) + "Facts", number(column(fact, "fact_count")));
        }
        return new ArrayList<>(rows.values());
    }

    private static Object column(Map<String, Object> row, String name) {
        // MySQL 驱动返回别名原样小写，H2 返回大写；两种都读。
        return row.containsKey(name) ? row.get(name) : row.get(name.toUpperCase(java.util.Locale.ROOT));
    }

    private static long number(Object value) {
        return value == null ? 0L : ((Number) value).longValue();
    }

    private static String camel(String step) {
        StringBuilder out = new StringBuilder();
        boolean upper = false;
        for (char c : step.toCharArray()) {
            if (c == '_') { upper = true; continue; }
            out.append(upper ? Character.toUpperCase(c) : c);
            upper = false;
        }
        return out.toString();
    }

    @Override
    public Map<String, Object> repeatSignup(LocalDate cohortStart, LocalDate cohortEnd) {
        Instant cutoff = clock.instant();
        Instant from = cohortStart.atStartOfDay(ANALYTICS_ZONE).toInstant();
        Instant toExclusive = cohortEnd.plusDays(1).atStartOfDay(ANALYTICS_ZONE).toInstant();
        // 历史上界覆盖窗末首单 + 30 天（含恰好第 30 天那一刻）；不设下界，才能判「全历史首笔」。
        Instant historyEnd = toExclusive.plus(Duration.ofDays(REPEAT_WINDOW_DAYS + 1L));
        List<Long> memberIds = postGameOutcomeMapper.selectCohortMemberIds(Date.from(from), Date.from(toExclusive));
        if (memberIds == null) {
            throw new IllegalStateException("复购口径报名事实读取失败");
        }
        List<RegistrationCohortFact> history = new ArrayList<>();
        for (int i = 0; i < memberIds.size(); i += MEMBER_BATCH) {
            List<RegistrationCohortFact> batch = postGameOutcomeMapper.selectPaidRegistrationHistory(
                    memberIds.subList(i, Math.min(memberIds.size(), i + MEMBER_BATCH)), Date.from(historyEnd));
            if (batch == null) {
                throw new IllegalStateException("复购口径报名事实读取失败");
            }
            history.addAll(batch);
        }
        Map<String, Object> data = computeRepeatSignup(history, from, toExclusive, cutoff);
        data.put("cohortStart", cohortStart.toString());
        data.put("cohortEnd", cohortEnd.toString());
        return data;
    }

    /**
     * repeat_signup_v1 纯计算（fixture 测试入口）。
     *
     * <ul>
     *   <li>订单 = 同 parent_order_no 的所有席位行；无 parent_order_no 时单行即一单。一单多席只算一次。</li>
     *   <li>主口径 PAID_VALID：已支付且报名成功、未全额退款、实付 &gt; 0（部分退款仍有效，免单不计）。</li>
     *   <li>并列口径 ALL_SIGNUPS：一切已确认报名（payment_status 2/4，含免单与之后被退的单）。</li>
     *   <li>cohort = 该口径下全历史首单的支付时刻落在 [from, toExclusive)；
     *       复购 = 另一独立订单支付时刻在 [首单, 首单 + 30 天]（恰好 30 天算在内）。</li>
     *   <li>首单 + 30 天晚于数据截止 ⇒ 未成熟，只计 immatureCount，不进分母；分母为 0 时 rate 为 null（未知），不是 0%。</li>
     * </ul>
     */
    static Map<String, Object> computeRepeatSignup(List<RegistrationCohortFact> history,
                                                   Instant from, Instant toExclusive, Instant cutoff) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("definitionVersion", REPEAT_SIGNUP_VERSION);
        data.put("windowDays", REPEAT_WINDOW_DAYS);
        data.put("dataCutoffAt", Date.from(cutoff));
        data.put("primary", repeatFigure("PAID_VALID", history, from, toExclusive, cutoff,
                fact -> PostGameOutcomeReportServiceImpl.isValidlyPaid(fact)
                        && !PostGameOutcomeReportServiceImpl.isFullyRefunded(fact)
                        && !PostGameOutcomeReportServiceImpl.isFree(fact)));
        data.put("allSignups", repeatFigure("ALL_SIGNUPS", history, from, toExclusive, cutoff,
                fact -> Integer.valueOf(2).equals(fact.getPaymentStatus())
                        || Integer.valueOf(4).equals(fact.getPaymentStatus())));
        return data;
    }

    private static Map<String, Object> repeatFigure(String basis, List<RegistrationCohortFact> history,
                                                    Instant from, Instant toExclusive, Instant cutoff,
                                                    Predicate<RegistrationCohortFact> qualifies) {
        // member -> (orderKey -> 该订单最早的合格支付时刻)
        Map<Long, Map<String, Instant>> ordersByMember = new TreeMap<>();
        for (RegistrationCohortFact fact : history) {
            if (fact == null || fact.getMemberId() == null || fact.getPaymentTime() == null) continue;
            Instant paidAt = fact.getPaymentTime().toInstant();
            if (paidAt.isAfter(cutoff) || !qualifies.test(fact)) continue;
            String orderKey = fact.getParentOrderNo() != null && !fact.getParentOrderNo().isBlank()
                    ? "order:" + fact.getParentOrderNo() : "registration:" + fact.getRegistrationId();
            ordersByMember.computeIfAbsent(fact.getMemberId(), key -> new HashMap<>())
                    .merge(orderKey, paidAt, (left, right) -> left.isBefore(right) ? left : right);
        }
        long numerator = 0;
        long denominator = 0;
        long immature = 0;
        for (Map<String, Instant> orders : ordersByMember.values()) {
            Map.Entry<String, Instant> first = null;
            for (Map.Entry<String, Instant> order : orders.entrySet()) {
                if (first == null || order.getValue().isBefore(first.getValue())
                        || (order.getValue().equals(first.getValue()) && order.getKey().compareTo(first.getKey()) < 0)) {
                    first = order;
                }
            }
            if (first == null || first.getValue().isBefore(from) || !first.getValue().isBefore(toExclusive)) continue;
            Instant windowEnd = first.getValue().plus(Duration.ofDays(REPEAT_WINDOW_DAYS));
            if (windowEnd.isAfter(cutoff)) {
                immature++;
                continue;
            }
            denominator++;
            for (Map.Entry<String, Instant> order : orders.entrySet()) {
                if (order.getKey().equals(first.getKey())) continue;
                if (!order.getValue().isBefore(first.getValue()) && !order.getValue().isAfter(windowEnd)) {
                    numerator++;
                    break;
                }
            }
        }
        Map<String, Object> figure = new LinkedHashMap<>();
        figure.put("basis", basis);
        figure.put("numerator", numerator);
        figure.put("denominator", denominator);
        figure.put("immatureCount", immature);
        figure.put("rate", denominator == 0 ? null
                : BigDecimal.valueOf(numerator).divide(BigDecimal.valueOf(denominator), 4, RoundingMode.HALF_UP));
        return figure;
    }

    // ===== R7 路线与站点到访报告（只读；与漏斗/复购等其它报表方法互不共享状态） =====

    /** 查询窗口上限（含首尾，天），与后台漏斗同一上限。 */
    static final int ROUTE_VISITOR_MAX_DAYS = 90;
    /** 小格子抑制阈值：去重玩家数少于此值的格子不出数字。 */
    static final int ROUTE_VISITOR_MIN_PLAYERS = 3;
    static final String ROUTE_VISITOR_SUPPRESSED = "<3";
    /** 未知值在导出里的写法，与后台页面的破折号一致；JSON 里未知是 null。 */
    static final String ROUTE_VISITOR_UNKNOWN = "—";
    static final String ROUTE_VISITOR_TEST_EXCLUSION =
            "NO_SERVER_MARKER：topic_route_session / player_node_progress / redemption 无测试或预览标记，未排除";

    @Override
    @Transactional(readOnly = true)
    public Map<String, Object> routeVisitorReport(Long topicId, LocalDate startDate, LocalDate endDate) {
        if (topicId == null || topicId <= 0) {
            throw new IllegalArgumentException("请选择主题");
        }
        if (startDate == null || endDate == null) {
            throw new IllegalArgumentException("开始和结束日期不能为空");
        }
        if (startDate.isAfter(endDate)) {
            throw new IllegalArgumentException("开始日期不能晚于结束日期");
        }
        if (ChronoUnit.DAYS.between(startDate, endDate) + 1 > ROUTE_VISITOR_MAX_DAYS) {
            throw new IllegalArgumentException("查询窗口不能超过" + ROUTE_VISITOR_MAX_DAYS + "天");
        }
        Map<String, Object> topic = bizFunnelDailyMapper.selectRouteVisitorTopic(topicId);
        if (topic == null) {
            throw new IllegalArgumentException("主题不存在");
        }
        Date from = Date.from(startDate.atStartOfDay(ANALYTICS_ZONE).toInstant());
        Date to = Date.from(endDate.plusDays(1).atStartOfDay(ANALYTICS_ZONE).toInstant());

        Long sessionProbe = bizFunnelDailyMapper.countRouteVisitorSessions(topicId);
        if (sessionProbe == null) {
            throw new IllegalStateException("路线局来源不可读，拒绝把未知报成 0");
        }
        // 从未写过路线局的主题（线性未配旅程）没有开局/完局事实：整列未知，不是 0。
        boolean runsKnown = sessionProbe > 0;
        Map<String, Map<String, Object>> runByDay = indexByDay(required(
                bizFunnelDailyMapper.selectRouteVisitorRunStats(topicId, from, to, true), "路线局"));
        List<Map<String, Object>> runTotalRows = required(
                bizFunnelDailyMapper.selectRouteVisitorRunStats(topicId, from, to, false), "路线局");
        Map<String, Map<String, Object>> refundByDay = indexByDay(required(
                bizFunnelDailyMapper.selectRouteVisitorRefundDaily(topicId, from, to), "退款"));
        List<Map<String, Object>> stationRows = required(
                bizFunnelDailyMapper.selectRouteVisitorStations(topicId), "站点");
        List<Map<String, Object>> stationDayRows = required(
                bizFunnelDailyMapper.selectRouteVisitorStationStats(topicId, from, to, true), "站点事实");
        List<Map<String, Object>> stationTotalRows = required(
                bizFunnelDailyMapper.selectRouteVisitorStationStats(topicId, from, to, false), "站点事实");
        List<Map<String, Object>> undatedRows = required(
                bizFunnelDailyMapper.selectRouteVisitorUndatedCompletions(topicId), "站点完成");

        List<Map<String, Object>> routeDays = new ArrayList<>();
        long refundTotal = 0;
        for (LocalDate day = startDate; !day.isAfter(endDate); day = day.plusDays(1)) {
            String key = day.toString();
            Map<String, Object> refund = refundByDay.get(key);
            long refunds = refund == null ? 0 : longOf(refund.get("refunds"));
            refundTotal += refunds;
            routeDays.add(routeVisitorRouteRow(key, runsKnown, runByDay.get(key), refunds));
        }
        Map<String, Object> routeTotal = routeVisitorRouteRow("合计", runsKnown,
                runTotalRows.isEmpty() ? null : runTotalRows.get(0), refundTotal);

        // 站点清单决定排序；已从主题里删掉但仍有历史事实的站点排在最后。
        Map<Long, Map<String, Object>> stationById = new LinkedHashMap<>();
        Map<Long, Integer> stationOrder = new HashMap<>();
        for (Map<String, Object> station : stationRows) {
            Long nodeId = longOf(station.get("node_id"));
            stationOrder.put(nodeId, stationOrder.size());
            stationById.put(nodeId, station);
        }
        Map<Long, Map<String, Object>> totalByStation = new HashMap<>();
        for (Map<String, Object> row : stationTotalRows) {
            Long nodeId = longOf(row.get("node_id"));
            totalByStation.put(nodeId, row);
            if (!stationById.containsKey(nodeId)) {
                stationOrder.put(nodeId, Integer.MAX_VALUE);
                stationById.put(nodeId, null);
            }
        }
        Map<Long, Map<String, Object>> undatedByStation = new HashMap<>();
        for (Map<String, Object> row : undatedRows) {
            Long nodeId = longOf(row.get("node_id"));
            undatedByStation.put(nodeId, row);
            if (!stationById.containsKey(nodeId)) {
                stationOrder.put(nodeId, Integer.MAX_VALUE);
                stationById.put(nodeId, null);
            }
        }

        List<Map<String, Object>> stations = new ArrayList<>();
        for (Map.Entry<Long, Map<String, Object>> entry : stationById.entrySet()) {
            Map<String, Object> row = routeVisitorStationRow(null, entry.getKey(), entry.getValue(),
                    totalByStation.get(entry.getKey()));
            Map<String, Object> undated = undatedByStation.get(entry.getKey());
            row.put("undatedCompletions", undated == null ? (Object) 0L
                    : smallCell(longOf(undated.get("completions")), longOf(undated.get("players"))));
            stations.add(row);
        }

        List<Map<String, Object>> stationDays = new ArrayList<>();
        for (Map<String, Object> row : stationDayRows) {
            Long nodeId = longOf(row.get("node_id"));
            stationDays.add(routeVisitorStationRow((String) row.get("stat_day"), nodeId,
                    stationById.get(nodeId), row));
        }
        stationDays.sort(Comparator.comparing((Map<String, Object> row) -> String.valueOf(row.get("date")))
                .thenComparing(row -> stationOrder.getOrDefault((Long) row.get("nodeId"), Integer.MAX_VALUE))
                .thenComparing(row -> (Long) row.get("nodeId")));

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("topicId", topicId);
        data.put("topicName", topic.get("topic_name"));
        data.put("startDate", startDate.toString());
        data.put("endDate", endDate.toString());
        data.put("timeZone", ANALYTICS_ZONE.getId());
        data.put("smallCellThreshold", ROUTE_VISITOR_MIN_PLAYERS);
        data.put("suppressedText", ROUTE_VISITOR_SUPPRESSED);
        data.put("runsSource", runsKnown ? "TOPIC_ROUTE_SESSION" : "UNKNOWN_NO_ROUTE_SESSION");
        data.put("testExclusionBasis", ROUTE_VISITOR_TEST_EXCLUSION);
        data.put("routeDays", routeDays);
        data.put("routeTotal", routeTotal);
        data.put("stations", stations);
        data.put("stationDays", stationDays);
        return data;
    }

    @Override
    @Transactional(readOnly = true)
    @SuppressWarnings("unchecked")
    public String routeVisitorReportCsv(Long topicId, LocalDate startDate, LocalDate endDate) {
        Map<String, Object> report = routeVisitorReport(topicId, startDate, endDate);
        StringBuilder csv = new StringBuilder("﻿");
        csvLine(csv, "主题", report.get("topicName"));
        csvLine(csv, "日期范围", report.get("startDate") + " ~ " + report.get("endDate"));
        csvLine(csv, "说明", "少于" + ROUTE_VISITOR_MIN_PLAYERS + "名玩家的格子显示 " + ROUTE_VISITOR_SUPPRESSED
                + "；无事实来源显示 " + ROUTE_VISITOR_UNKNOWN);
        csv.append("\r\n");
        csvLine(csv, "路线按天");
        csvLine(csv, "日期", "开局", "完局", "平均用时(分钟)", "玩家", "退款");
        List<Map<String, Object>> routeRows = new ArrayList<>((List<Map<String, Object>>) report.get("routeDays"));
        routeRows.add((Map<String, Object>) report.get("routeTotal"));
        for (Map<String, Object> row : routeRows) {
            csvLine(csv, row.get("date"), csvValue(row.get("runsStarted")), csvValue(row.get("runsCompleted")),
                    csvValue(row.get("avgDurationMinutes")), csvValue(row.get("players")), csvValue(row.get("refunds")));
        }
        csv.append("\r\n");
        csvLine(csv, "站点合计");
        csvLine(csv, "站点", "到访", "完成", "商家核销", "权益兑换", "玩家", "无日期完成(全期)");
        for (Map<String, Object> row : (List<Map<String, Object>>) report.get("stations")) {
            csvLine(csv, row.get("stationName"), csvValue(row.get("arrivals")), csvValue(row.get("completions")),
                    csvValue(row.get("verifications")), csvValue(row.get("perkRedemptions")),
                    csvValue(row.get("players")), csvValue(row.get("undatedCompletions")));
        }
        csv.append("\r\n");
        csvLine(csv, "站点按天");
        csvLine(csv, "日期", "站点", "到访", "完成", "商家核销", "权益兑换", "玩家");
        for (Map<String, Object> row : (List<Map<String, Object>>) report.get("stationDays")) {
            csvLine(csv, row.get("date"), row.get("stationName"), csvValue(row.get("arrivals")),
                    csvValue(row.get("completions")), csvValue(row.get("verifications")),
                    csvValue(row.get("perkRedemptions")), csvValue(row.get("players")));
        }
        return csv.toString();
    }

    private static Map<String, Object> routeVisitorRouteRow(String label, boolean runsKnown,
                                                            Map<String, Object> run, long refunds) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("date", label);
        if (runsKnown) {
            long players = run == null ? 0 : longOf(run.get("players"));
            row.put("runsStarted", smallCell(run == null ? 0 : longOf(run.get("runs_started")), players));
            row.put("runsCompleted", smallCell(run == null ? 0 : longOf(run.get("runs_completed")), players));
            row.put("avgDurationMinutes", durationCell(run, players));
            row.put("players", smallCell(players, players));
        } else {
            row.put("runsStarted", null);
            row.put("runsCompleted", null);
            row.put("avgDurationMinutes", null);
            row.put("players", null);
        }
        // 退款与玩家无关，按笔数同样不出 1、2 这样的小数字。
        row.put("refunds", smallCell(refunds, refunds));
        return row;
    }

    private static Map<String, Object> routeVisitorStationRow(String day, Long nodeId, Map<String, Object> station,
                                                              Map<String, Object> facts) {
        Map<String, Object> row = new LinkedHashMap<>();
        if (day != null) {
            row.put("date", day);
        }
        row.put("nodeId", nodeId);
        Object name = station == null ? null : station.get("station_name");
        row.put("stationName", station == null ? "已删除站点 #" + nodeId
                : (name == null || String.valueOf(name).trim().isEmpty() ? "站点 #" + nodeId : String.valueOf(name)));
        boolean hasMerchant = station != null && longOf(station.get("has_merchant")) == 1;
        long players = facts == null ? 0 : longOf(facts.get("players"));
        row.put("arrivals", smallCell(facts == null ? 0 : longOf(facts.get("arrivals")), players));
        row.put("completions", smallCell(facts == null ? 0 : longOf(facts.get("completions")), players));
        // 没有承接商家的站点不存在核销/兑换事实：未知（破折号），不是 0。
        row.put("verifications", hasMerchant
                ? smallCell(facts == null ? 0 : longOf(facts.get("verifications")), players) : null);
        row.put("perkRedemptions", hasMerchant
                ? smallCell(facts == null ? 0 : longOf(facts.get("perk_redemptions")), players) : null);
        row.put("players", smallCell(players, players));
        return row;
    }

    /** 有数字且去重玩家数少于阈值 ⇒ "<3"；0 是确知的 0，照常显示。 */
    static Object smallCell(long value, long players) {
        if (value > 0 && players < ROUTE_VISITOR_MIN_PLAYERS) {
            return ROUTE_VISITOR_SUPPRESSED;
        }
        return value;
    }

    private static Object durationCell(Map<String, Object> run, long players) {
        long runs = run == null ? 0 : longOf(run.get("duration_runs"));
        Object seconds = run == null ? null : run.get("duration_seconds_sum");
        if (runs <= 0 || !(seconds instanceof Number)) {
            return null;
        }
        if (players < ROUTE_VISITOR_MIN_PLAYERS || runs < ROUTE_VISITOR_MIN_PLAYERS) {
            return ROUTE_VISITOR_SUPPRESSED;
        }
        return new BigDecimal(seconds.toString())
                .divide(BigDecimal.valueOf(runs * 60L), 1, RoundingMode.HALF_UP);
    }

    private static <T> List<T> required(List<T> rows, String source) {
        if (rows == null) {
            throw new IllegalStateException(source + "来源不可读，拒绝把未知报成 0");
        }
        return rows;
    }

    private static Map<String, Map<String, Object>> indexByDay(List<Map<String, Object>> rows) {
        Map<String, Map<String, Object>> byDay = new HashMap<>();
        for (Map<String, Object> row : rows) {
            Object day = row.get("stat_day");
            if (day != null) {
                byDay.put(String.valueOf(day), row);
            }
        }
        return byDay;
    }

    private static long longOf(Object value) {
        return value instanceof Number ? ((Number) value).longValue() : 0L;
    }

    private static Object csvValue(Object value) {
        return value == null ? ROUTE_VISITOR_UNKNOWN : value;
    }

    private static void csvLine(StringBuilder csv, Object... cells) {
        for (int i = 0; i < cells.length; i++) {
            if (i > 0) {
                csv.append(',');
            }
            String text = cells[i] == null ? "" : String.valueOf(cells[i]);
            // 站点名来自内容作者：防表格公式注入。
            if (!text.isEmpty() && "=+-@\t\r".indexOf(text.charAt(0)) >= 0) {
                text = "'" + text;
            }
            if (text.indexOf(',') >= 0 || text.indexOf('"') >= 0 || text.indexOf('\n') >= 0 || text.indexOf('\r') >= 0) {
                text = '"' + text.replace("\"", "\"\"") + '"';
            }
            csv.append(text);
        }
        csv.append("\r\n");
    }
}
