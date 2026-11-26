package com.chengyinhub.business.service.support;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 现金通道是否已接到本域订单。
 *
 * <p>默认关闭（{@code marketing.product.cash-enabled=false}），关闭时报价只显示积分通道，
 * 现金单只落 PENDING_CASH。MKO 支付路由已接通：{@code JdbcWechatPaymentOrderOwner} 按 MKO 前缀
 * 锁定 marketing_product_order 行的待付现金金额（biz_type=MARKETING），
 * {@code WechatPaymentCallbackRouter} 把 MKO 回调先于 registration 兜底交给
 * {@code IMarketingProductPurchaseService#handlePaidOrder}。是否开卖由 owner 在服务器上翻开关决定。
 */
@Component
public class MarketingCashChannel {

    private final boolean enabled;

    public MarketingCashChannel(@Value("${marketing.product.cash-enabled:false}") boolean enabled) {
        this.enabled = enabled;
    }

    public boolean enabled() { return enabled; }

    public String unavailableReason() {
        return enabled ? null : "PAYMENT_OWNER_ROUTE_NOT_WIRED";
    }
}
