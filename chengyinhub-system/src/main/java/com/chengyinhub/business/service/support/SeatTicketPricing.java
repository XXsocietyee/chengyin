package com.chengyinhub.business.service.support;

import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * 自玩多人票定价规则（owner 2026-11-24 批准）。服务端唯一实现；回填迁移
 * {@code migration_20261124_seat_products_backfill.sql} 用同样的分整数算式表达，并由
 * {@code SeatProductBackfillMySqlIT} 对照本类逐条核对。
 *
 * <p>票面 list = 单人自玩价 × 人数。售价 = 不低于 list × 折扣率、且以 .9 元结尾（分位 = 90）的最小金额，
 * 再封顶为 list。折扣率：2 人 0.83，4 人 0.75。全程按分做整数运算，不用浮点。
 */
public final class SeatTicketPricing {

    /** 每个主题都提供的多人票人数，按展示顺序。 */
    public static final int[] SEAT_COUNTS = {2, 4};

    private SeatTicketPricing() {
    }

    /** 折扣率的百分数；不支持的人数抛 {@link IllegalArgumentException}。 */
    public static int ratePercent(int seats) {
        if (seats == 2) return 83;
        if (seats == 4) return 75;
        throw new IllegalArgumentException("不支持的多人票人数:" + seats);
    }

    /** 票面（分）= 单人价（分）× 人数。 */
    public static long listCents(BigDecimal singleSelfPlayPrice, int seats) {
        return Math.multiplyExact(singleCents(singleSelfPlayPrice), (long) seats);
    }

    /** 多人票售价（元，两位小数）。 */
    public static BigDecimal price(BigDecimal singleSelfPlayPrice, int seats) {
        return BigDecimal.valueOf(priceCents(singleSelfPlayPrice, seats), 2);
    }

    /** 多人票售价（分）。 */
    public static long priceCents(BigDecimal singleSelfPlayPrice, int seats) {
        int rate = ratePercent(seats);
        long list = listCents(singleSelfPlayPrice, seats);
        // 不低于 list × rate 的最小整分：ceil(list × rate / 100)，list、rate 都为正。
        long target = (Math.multiplyExact(list, (long) rate) + 99) / 100;
        // 上调到最近的 .90 结尾。
        long endingNine = target + Math.floorMod(90 - target, 100L);
        return Math.min(endingNine, list);
    }

    private static long singleCents(BigDecimal singleSelfPlayPrice) {
        if (singleSelfPlayPrice == null || singleSelfPlayPrice.signum() <= 0) {
            throw new IllegalArgumentException("单人自玩价必须大于 0");
        }
        try {
            return singleSelfPlayPrice.movePointRight(2).setScale(0, RoundingMode.UNNECESSARY).longValueExact();
        } catch (ArithmeticException notWholeCents) {
            throw new IllegalArgumentException("单人自玩价必须精确到分:" + singleSelfPlayPrice.toPlainString());
        }
    }
}
