package com.chengyinhub.business.service.support;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 门店权益的每日名额、开始日期与闲时可用时段(merchant_chapter_offer.daily_capacity / valid_start + coop_perk.redeem_rule)在核销时的判定。
 * 核销事务与玩家端核销码处共用同一段文案;两列/时段为 NULL = 不限。纯函数,不读库。
 */
public final class OfferRedeemLimits {
    public static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");
    public static final String DAILY_FULL = "今日名额已满，请改天再来";
    public static final String ALL_DAY = "全天可用";
    private static final Pattern HOURS_PATTERN = Pattern.compile(
            "(?:(工作日|周末)\\s*)?(\\d{1,2}):(\\d{2})\\s*[-~至—–]\\s*(\\d{1,2}):(\\d{2})");

    private OfferRedeemLimits() {
    }

    public static LocalDate today() {
        return LocalDate.now(ZONE);
    }

    public static LocalDateTime now() {
        return LocalDateTime.now(ZONE);
    }

    public static String notStarted(LocalDate validStart) {
        return "权益还没开始，" + validStart.getMonthValue() + "月" + validStart.getDayOfMonth() + "日起可用";
    }

    public static String outsideHoursMessage(String normalizedWindow) {
        return "当前不在可用时段（" + normalizedWindow + "），请在该时段到店核销";
    }

    /**
     * @param usedToday 这份供给今天已成功核销的份数
     * @return 拒绝文案;可核销 = null。先判开始日期,再判当日名额
     */
    public static String rejection(Integer dailyCapacity, LocalDate validStart, int usedToday, LocalDate today) {
        if (validStart != null && today != null && today.isBefore(validStart)) return notStarted(validStart);
        if (dailyCapacity != null && usedToday >= dailyCapacity) return DAILY_FULL;
        return null;
    }

    /**
     * 含闲时可用时段的完整判定：先判开始日期 → 再判当日名额 → 最后判闲时可用时段。
     * offPeakHoursOrRule 为空或不含时段标签时视为全天可用（存量兼容）。
     */
    public static String rejection(Integer dailyCapacity, LocalDate validStart, int usedToday, LocalDate today,
                                   String offPeakHoursOrRule, LocalDateTime now) {
        String base = rejection(dailyCapacity, validStart, usedToday, today);
        if (base != null) return base;
        return outsideHours(offPeakHoursOrRule, now);
    }

    /**
     * 校验并规范化商家填写的闲时时段（如 "14:00-17:00"、"工作日 10:00-17:00"、"周末 09:30-11:30"）。
     * 空串或 "全天可用" 返回 null（表示不限时段）；格式非法或起止倒挂抛 IllegalArgumentException。
     */
    public static String normalizeOffPeakHours(String raw) {
        if (raw == null) return null;
        String trimmed = raw.trim();
        if (trimmed.isEmpty() || ALL_DAY.equals(trimmed) || "全天".equals(trimmed) || "不限".equals(trimmed)) {
            return null;
        }
        Matcher m = HOURS_PATTERN.matcher(trimmed);
        if (!m.matches()) {
            throw new IllegalArgumentException("可用时段格式请使用 HH:mm-HH:mm（例如 14:00-17:00 或 工作日 14:00-17:00）");
        }
        return formatWindow(m);
    }

    /** 从可用时段字符串或 coop_perk.redeem_rule 文案中提取规范化的时段窗口；不含有效时段返回 null。 */
    public static String extractOffPeakHours(String text) {
        if (text == null || text.trim().isEmpty()) return null;
        Matcher m = HOURS_PATTERN.matcher(text);
        if (!m.find()) return null;
        try {
            return formatWindow(m);
        } catch (IllegalArgumentException ignored) {
            return null;
        }
    }

    /** 拼装写入 coop_perk.redeem_rule 的纯白话核销规则（零 DDL 复用 redeem_rule 列）。 */
    public static String composeRedeemRule(String normalizedOffPeakHours, Integer dailyCap) {
        StringBuilder sb = new StringBuilder("到店扫码核销");
        if (normalizedOffPeakHours != null && !normalizedOffPeakHours.isEmpty()) {
            sb.append("；可用时段：").append(normalizedOffPeakHours);
        }
        if (dailyCap != null && dailyCap > 0) {
            sb.append("；每日限量").append(dailyCap).append("份");
        }
        return sb.toString();
    }

    /** 判断当前时刻是否落在声明的闲时可用时段之外；合法或在时段内返回 null。 */
    public static String outsideHours(String offPeakHoursOrRule, LocalDateTime now) {
        if (offPeakHoursOrRule == null || now == null) return null;
        String trimmed = offPeakHoursOrRule.trim();
        if (trimmed.isEmpty()) return null;
        Matcher m = HOURS_PATTERN.matcher(trimmed);
        if (!m.find()) return null;
        String normalized;
        LocalTime start;
        LocalTime end;
        try {
            normalized = formatWindow(m);
            start = parseTime(m.group(2), m.group(3));
            end = parseTime(m.group(4), m.group(5));
        } catch (IllegalArgumentException ignored) {
            return null;
        }
        String dayKind = m.group(1);
        if ("工作日".equals(dayKind)) {
            DayOfWeek dow = now.getDayOfWeek();
            if (dow == DayOfWeek.SATURDAY || dow == DayOfWeek.SUNDAY) {
                return outsideHoursMessage(normalized);
            }
        } else if ("周末".equals(dayKind)) {
            DayOfWeek dow = now.getDayOfWeek();
            if (dow != DayOfWeek.SATURDAY && dow != DayOfWeek.SUNDAY) {
                return outsideHoursMessage(normalized);
            }
        }
        LocalTime current = now.toLocalTime();
        if (current.isBefore(start) || current.isAfter(end)) {
            return outsideHoursMessage(normalized);
        }
        return null;
    }

    private static String formatWindow(Matcher m) {
        LocalTime start = parseTime(m.group(2), m.group(3));
        LocalTime end = parseTime(m.group(4), m.group(5));
        if (!end.isAfter(start)) {
            throw new IllegalArgumentException("结束时间须晚于开始时间");
        }
        String prefix = m.group(1) == null ? "" : m.group(1) + " ";
        return prefix + String.format("%02d:%02d-%02d:%02d",
                start.getHour(), start.getMinute(), end.getHour(), end.getMinute());
    }

    private static LocalTime parseTime(String hourText, String minuteText) {
        int hour = Integer.parseInt(hourText);
        int minute = Integer.parseInt(minuteText);
        if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
            throw new IllegalArgumentException("可用时段小时或分钟无效");
        }
        return LocalTime.of(hour, minute);
    }

    /** yyyy-MM-dd(或更长的日期时间串)取日期;空或不成形 = null。 */
    public static LocalDate parseDate(Object value) {
        String text = value == null ? "" : String.valueOf(value).trim();
        if (text.length() < 10) return null;
        try {
            return LocalDate.parse(text.substring(0, 10));
        } catch (java.time.format.DateTimeParseException e) {
            return null;
        }
    }
}
