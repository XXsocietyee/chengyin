package com.chengyinhub.business.service.support;

import com.chengyinhub.business.domain.UmsMemberSettlementDebt;
import com.chengyinhub.business.mapper.UmsMemberSettlementDebtMapper;
import com.chengyinhub.business.service.IPlayerWithdrawalCooldownService;
import com.chengyinhub.business.service.impl.MerchantReferralBountyService;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.List;

/**
 * 提现冻结额的唯一解析点：拓展赏金冻结 + 未到期的 PLAYER 投诉补偿冷静额 + 未清结算欠款的未抵扣余额。
 *
 * <p><b>为什么必须只有一处</b>：银行卡与微信零钱是两条提现腿，历史上就因为「只在一条腿刨冻结额」
 * 让冻结款从另一条口子提走过一次（见 CashWithdrawServiceImpl 里的那段注释）。
 * 两条腿都从这里取<b>同一个总额</b>、一次传给原子扣减，将来加第三条腿也不会再漏。
 *
 * <p><b>fail-closed</b>：各来源都刻意不 try/catch。任一查询挂了就让提现整单失败；
 * 吞异常当 0 = 冻结静默失效、钱当场提走，正是它要防的那件事。
 *
 * <p>返回值带分项：原子扣减只用 {@link Frozen#total()} 一个数，但拒绝文案要能指明是哪道闸
 * —— 「余额不足」和「有 30 元在冷静期」对用户是两件事，对排障也是。
 */
@Component
public class WithdrawalFrozenAmountResolver {

    private final MerchantReferralBountyService referralBountyService;
    private final IPlayerWithdrawalCooldownService cooldownService;

    public WithdrawalFrozenAmountResolver(MerchantReferralBountyService referralBountyService,
                                          IPlayerWithdrawalCooldownService cooldownService) {
        this.referralBountyService = referralBountyService;
        this.cooldownService = cooldownService;
    }

    @org.springframework.beans.factory.annotation.Autowired
    private com.chengyinhub.business.mapper.MerchantReferralBountyMapper bountyMapper;
    @org.springframework.beans.factory.annotation.Autowired
    private com.chengyinhub.business.mapper.PlayerWithdrawalCooldownMapper cooldownMapper;
    @org.springframework.beans.factory.annotation.Autowired
    private UmsMemberSettlementDebtMapper debtMapper;

    /** Caller holds the member balance lock in its financial transaction. */
    public Frozen resolveForWithdrawal(Long memberId) {
        if (memberId == null) throw new IllegalArgumentException("member identity required");
        return new Frozen(sum(bountyMapper.selectFrozenAmountsForUpdate(memberId, new java.util.Date())),
                sum(cooldownMapper.selectUnexpiredAmountsForUpdate(memberId)),
                openSettlementDebt(memberId));
    }

    private static BigDecimal sum(java.util.List<BigDecimal> amounts) {
        if (amounts == null) throw new IllegalStateException("Frozen current read unavailable");
        BigDecimal total = BigDecimal.ZERO;
        for (BigDecimal amount : amounts) if (amount != null) total = total.add(amount);
        return total;
    }

    /** 该会员当前不可提现的冻结额分项，三项都 ≥0。 */
    public Frozen resolve(Long memberId) {
        if (memberId == null) {
            return new Frozen(BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO);
        }
        return new Frozen(nz(referralBountyService.frozenAmount(memberId)),
                nz(cooldownService.frozenAmount(memberId)),
                openSettlementDebt(memberId));
    }

    /**
     * 未清欠款里还没从余额扣走的部分(amount - repaid_amount)。
     * 结算抵扣已经加过 repaid_amount 并扣过余额，这里不能再按原欠款额冻一次。
     * 与赏金、冷静期同一把当前读：{@code selectOpenByMemberForUpdate}。
     * 纯单测用 new 造解析器时没有这颗 mapper，Spring 缺 bean 则启动失败，不会带着空闸跑。
     */
    private BigDecimal openSettlementDebt(Long memberId) {
        if (debtMapper == null) {
            return BigDecimal.ZERO;
        }
        return unpaidRemainder(debtMapper.selectOpenByMemberForUpdate(memberId));
    }

    private static BigDecimal unpaidRemainder(List<UmsMemberSettlementDebt> rows) {
        if (rows == null) throw new IllegalStateException("Frozen current read unavailable");
        BigDecimal total = BigDecimal.ZERO;
        for (UmsMemberSettlementDebt debt : rows) {
            if (debt == null || (debt.getStatus() != null && debt.getStatus() != 0)) {
                continue;
            }
            BigDecimal amount = debt.getAmount() == null ? BigDecimal.ZERO : debt.getAmount();
            BigDecimal repaid = debt.getRepaidAmount() == null ? BigDecimal.ZERO : debt.getRepaidAmount();
            BigDecimal remaining = amount.subtract(repaid);
            if (remaining.signum() > 0) total = total.add(remaining);
        }
        return total;
    }

    private static BigDecimal nz(BigDecimal value) {
        return value == null ? BigDecimal.ZERO : value;
    }

    /** 冻结额分项。两条提现腿一次算完、一次传给 deductWithdrawableBalance，禁止分别扣。 */
    public static final class Frozen {
        /**
         * A3 锁定的业务错误码。中文文案能给用户看，但小程序与监控要按<b>稳定符号</b>分流 ——
         * 文案随时可能被改写，码不行。两条提现腿被冷静期挡住时都必须带它。
         */
        public static final String PLAYER_WITHDRAWAL_COOLDOWN = "PLAYER_WITHDRAWAL_COOLDOWN";

        private final BigDecimal referralBounty;
        private final BigDecimal playerComplaintCooldown;
        private final BigDecimal settlementDebt;

        Frozen(BigDecimal referralBounty, BigDecimal playerComplaintCooldown, BigDecimal settlementDebt) {
            this.referralBounty = referralBounty;
            this.playerComplaintCooldown = playerComplaintCooldown;
            this.settlementDebt = settlementDebt;
        }

        public BigDecimal getReferralBounty() { return referralBounty; }

        public BigDecimal getPlayerComplaintCooldown() { return playerComplaintCooldown; }

        public BigDecimal getSettlementDebt() { return settlementDebt; }

        public BigDecimal total() { return referralBounty.add(playerComplaintCooldown).add(settlementDebt); }

        public boolean isEmpty() { return total().compareTo(BigDecimal.ZERO) <= 0; }

        /**
         * 提现被拒时抛出去的完整理由：命中冷静期就前缀固定机器码，人话原样留在后面。
         *
         * <p>前缀式在本仓库是既有体例（EDITION_FINAL_PENDING: / PAYEE_FIELD_REQUIRED: 同形）。
         * 两条提现腿都必须用它，不能一条带码一条不带。
         */
        public String rejectionMessage() {
            return playerComplaintCooldown.compareTo(BigDecimal.ZERO) > 0
                    ? PLAYER_WITHDRAWAL_COOLDOWN + ":" + describe()
                    : describe();
        }

        /** 拒绝文案：点名是哪一道闸挡的，别只说「余额不足」。 */
        public String describe() {
            boolean hasBounty = referralBounty.compareTo(BigDecimal.ZERO) > 0;
            boolean hasCooldown = playerComplaintCooldown.compareTo(BigDecimal.ZERO) > 0;
            boolean hasDebt = settlementDebt.compareTo(BigDecimal.ZERO) > 0;
            if (!hasDebt && hasBounty && hasCooldown) {
                return "可提现余额不足(其中 " + referralBounty + " 元为拓展赏金冻结、"
                        + playerComplaintCooldown + " 元为投诉补偿冷静期,到期后可提现)";
            }
            if (!hasDebt && hasBounty) {
                return "可提现余额不足(其中 " + referralBounty + " 元为拓展赏金,入账 48 小时后可提现)";
            }
            if (!hasDebt && hasCooldown) {
                return "可提现余额不足(其中 " + playerComplaintCooldown
                        + " 元为投诉补偿冷静期,到账 48 小时后可提现)";
            }
            if (!hasDebt) {
                return "用户余额不足";
            }
            StringBuilder message = new StringBuilder("可提现余额不足(其中 ");
            if (hasBounty) {
                message.append(referralBounty).append(" 元为拓展赏金冻结、");
            }
            if (hasCooldown) {
                message.append(playerComplaintCooldown).append(" 元为投诉补偿冷静期、");
            }
            message.append(settlementDebt).append(" 元为未结清结算欠款,抵扣完成前不可提现)");
            return message.toString();
        }
    }
}
