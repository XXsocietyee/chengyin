package com.chengyinhub.business.service.support;

import java.time.LocalDate;
import java.time.ZoneId;

/**
 * 门店权益的每日名额与开始日期(merchant_chapter_offer.daily_capacity / valid_start)在核销时的判定。
 * 核销事务与玩家端核销码处共用同一段文案;两列为 NULL = 不限。纯函数,不读库。
 */
public final class OfferRedeemLimits {
    public static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");
    public static final String DAILY_FULL = "今日名额已满，请改天再来";

    private OfferRedeemLimits() {
    }

    public static LocalDate today() {
        return LocalDate.now(ZONE);
    }

    public static String notStarted(LocalDate validStart) {
        return "权益还没开始，" + validStart.getMonthValue() + "月" + validStart.getDayOfMonth() + "日起可用";
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
