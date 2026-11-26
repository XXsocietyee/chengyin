package com.chengyinhub.common.exception;

/**
 * 核销被门店权益的每日名额或开始日期拒绝。业务拒绝:只在核销事务内、写流水之前抛出,
 * 抛出即整笔核销事务回滚,肯定没有核销。message 就是给柜台与玩家看的那句话。
 */
public class RedeemLimitRejectedException extends IllegalStateException {
    private static final long serialVersionUID = 1L;

    public RedeemLimitRejectedException(String message) {
        super(message);
    }
}
