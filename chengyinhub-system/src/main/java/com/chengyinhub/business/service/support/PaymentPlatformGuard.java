package com.chengyinhub.business.service.support;

/**
 * iOS 上的虚拟商品不能走普通微信支付。虚拟支付开关关着、或价格没有映射时直接拒绝。
 * 没有上报平台时不拦截，避免旧客户端把安卓购票一起挡掉。
 */
public final class PaymentPlatformGuard {

    public static final String IOS_VIRTUAL_MESSAGE = "iOS 暂不支持购买该票种";

    private PaymentPlatformGuard() {}

    public static boolean isIos(String platform) {
        if (platform == null) return false;
        String value = platform.trim().toLowerCase();
        return "ios".equals(value) || "iphone".equals(value);
    }

    /** xpayReady 为真时放行（调用方已确认开关打开且价格已映射）。 */
    public static void rejectIosVirtualJsapi(String platform, boolean xpayReady) {
        if (xpayReady || !isIos(platform)) return;
        throw new IosVirtualPayRejected(IOS_VIRTUAL_MESSAGE);
    }

    public static class IosVirtualPayRejected extends RuntimeException {
        public IosVirtualPayRejected(String message) { super(message); }
    }
}
