package com.chengyinhub.business.service.support;

import com.chengyinhub.business.domain.CmsTopic;
import com.chengyinhub.business.domain.MarketingProduct;
import com.chengyinhub.business.domain.MarketingProductItem;
import com.chengyinhub.business.domain.MarketingProductOrder;
import com.chengyinhub.business.domain.OmsTicket;
import com.chengyinhub.business.exception.MarketingProductException;
import com.chengyinhub.business.mapper.CmsTopicMapper;
import com.chengyinhub.business.service.IOmsTicketService;
import com.chengyinhub.business.service.IProductRoleService;
import com.chengyinhub.business.mapper.MarketingProductMapper;
import com.chengyinhub.business.mapper.MarketingProductOrderMapper;
import com.chengyinhub.business.util.RefundPolicy;
import com.chengyinhub.common.constant.PurchaseKind;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;

/** 商品可售与加座前置校验；报价与下单共用，避免两套规则漂移。 */
@Component
public class MarketingProductRules {

    private static final int MAX_QUANTITY = 100;

    private final MarketingProductMapper productMapper;
    private final MarketingProductOrderMapper orderMapper;
    private final CmsTopicMapper topicMapper;
    private final IOmsTicketService ticketService;

    /** 纯积分多席商品的折合金额口径；非 Spring 构造时按缺省费率。 */
    @org.springframework.beans.factory.annotation.Autowired(required = false)
    private PointsValuePolicy pointsValuePolicy;

    /** 主题是否平台自营。缺失时按非自营拒绝，避免付款后才发现不能代收。 */
    @Autowired(required = false)
    private IProductRoleService productRoleService;

    public void setProductRoleService(IProductRoleService productRoleService) {
        this.productRoleService = productRoleService;
    }

    public MarketingProductRules(MarketingProductMapper productMapper,
                                 MarketingProductOrderMapper orderMapper,
                                 CmsTopicMapper topicMapper,
                                 IOmsTicketService ticketService) {
        this.productMapper = productMapper;
        this.orderMapper = orderMapper;
        this.topicMapper = topicMapper;
        this.ticketService = ticketService;
    }

    public MarketingProduct requireProduct(Long productId) {
        if (productId == null || productId <= 0) {
            throw MarketingProductException.badRequest("PRODUCT_INVALID", "商品编号不合法");
        }
        MarketingProduct product = productMapper.selectById(productId);
        if (product == null) throw MarketingProductException.notFound("PRODUCT_NOT_FOUND", "商品不存在");
        return product;
    }

    public List<MarketingProductItem> items(Long productId) {
        List<MarketingProductItem> items = productMapper.selectItems(productId);
        return items == null ? new ArrayList<>() : items;
    }

    /** 每个覆盖主题的单买票面（分摊权重与上限）；读取失败返回 null（按权重 1）。 */
    public List<BigDecimal> singlePrices(List<MarketingProductItem> items) {
        List<BigDecimal> prices = new ArrayList<>();
        if (items == null) return prices;
        for (MarketingProductItem item : items) {
            BigDecimal price = null;
            try {
                CmsTopic topic = topicMapper.selectCmsTopicById(item.getTopicId());
                if (topic != null) price = topic.getSelfPlayPrice();
            } catch (RuntimeException unavailable) {
                price = null;
            }
            prices.add(price);
        }
        return prices;
    }

    public void requireSellable(MarketingProduct product, Date now) {
        if (!Integer.valueOf(MarketingProduct.STATUS_ON_SALE).equals(product.getStatus())) {
            throw MarketingProductException.conflict("PRODUCT_NOT_ON_SALE", "商品未在售");
        }
        if (product.getSaleStartAt() != null && product.getSaleStartAt().after(now)) {
            throw MarketingProductException.conflict("SALE_NOT_STARTED", "商品尚未开售");
        }
        if (product.getSaleEndAt() != null && !product.getSaleEndAt().after(now)) {
            throw MarketingProductException.conflict("SALE_ENDED", "商品已停售");
        }
        if (product.getValidityKind() != null
                && product.getValidityKind() == MarketingProduct.VALIDITY_FIXED_WINDOW
                && (product.getFixedValidTo() == null || !product.getFixedValidTo().after(now))) {
            throw MarketingProductException.conflict("PERIOD_ENDED", "本期商品已到期");
        }
        if (product.getProductKind() != null
                && product.getProductKind() == MarketingProduct.KIND_EXTRA_SEAT
                && product.getParentProductId() == null) {
            throw MarketingProductException.conflict("ADD_ON_BASE_MISSING", "加座商品未绑定原商品");
        }
        if (product.getPurchaseKind() == null
                || (product.getPurchaseKind() != 2 && product.getPurchaseKind() != 3)) {
            throw MarketingProductException.conflict("PURCHASE_KIND_INVALID", "商品购买类型配置不合法");
        }
        if (product.occupiesExploreCapacity() && product.getPurchaseKind() != 3) {
            throw MarketingProductException.conflict("EXPLORE_CAPACITY_INVALID",
                    "只有探索票才能占章节容量");
        }
        if (items(product.getId()).isEmpty()) {
            throw MarketingProductException.conflict("PRODUCT_HAS_NO_CONTENT", "商品未绑定任何作品");
        }
        Integer route = product.getFulfillmentRoute();
        if (route == null || (route != MarketingProduct.ROUTE_SELF_PLAY_GRANT
                && route != MarketingProduct.ROUTE_TICKET_REGISTRATION
                && route != MarketingProduct.ROUTE_EXTRA_SEAT_GRANT)) {
            throw MarketingProductException.conflict("FULFILLMENT_ROUTE_INVALID", "商品履约路由配置不合法");
        }
        if (product.usesTicketRegistration()) {
            // 团体/学校：必须绑定真实 oms_ticket，由既有报名/席位链路承载；不另建席位真源。
            if (product.getTicketId() == null || product.getTicketId() <= 0) {
                throw MarketingProductException.conflict("TICKET_BINDING_MISSING", "团体/学校商品未绑定票种");
            }
            if (ticketService.selectOmsTicketById(product.getTicketId()) == null) {
                throw MarketingProductException.conflict("TICKET_BINDING_NOT_FOUND", "绑定的票种不存在");
            }
        } else if (product.getTicketId() != null) {
            throw MarketingProductException.conflict("TICKET_BINDING_UNEXPECTED", "该路由不应绑定票种");
        }
        if (product.isExtraSeatRoute() && product.getParentProductId() == null) {
            throw MarketingProductException.conflict("ADD_ON_BASE_MISSING", "加座商品未绑定原商品");
        }
        if (Integer.valueOf(1).equals(product.getGiftAllowed())
                && product.getValidityKind() != null
                && product.getValidityKind() == MarketingProduct.VALIDITY_ACTIVATE_ON_FIRST_USE) {
            // 礼品按"单行转移"发放：领取前买家行已存在，不能是首次使用型（否则领取时才有行）。
            throw MarketingProductException.conflict("GIFT_REQUIRES_EXISTING_ROW",
                    "礼品商品不能使用“首次使用起算”有效期");
        }
    }

    /**
     * 自玩多席行的票面覆盖校验：用成交时<b>同一段</b>分摊代码（{@link MarketingAllocation#lines}）试算，
     * 应付超过"单人自玩价 × 每份席位 × 份数"即拒绝。只作用于 {@link MarketingAllocation#isMultiSeatSelfPlay}
     * 的商品；单席商品不做任何新增校验（行为与此前一致）。报价、建单（付款前）和可售列表（{@link #isSellable}）共用这一处；
     * 不放进 requireSellable，以免改变团体结算/加座等其它入口的既有拒绝顺序。
     */
    public void requireListCoversPayable(MarketingProduct product, List<MarketingProductItem> items, int quantity) {
        if (!MarketingAllocation.isMultiSeatSelfPlay(product) || items == null || items.isEmpty()) return;
        List<BigDecimal> singlePrices = singlePrices(items);
        for (BigDecimal price : singlePrices) {
            if (price == null || price.signum() <= 0) {
                throw MarketingProductException.conflict("SEAT_LIST_PRICE_MISSING",
                        "多人票覆盖的主题缺少单人自玩价，暂不可售");
            }
        }
        BigDecimal total = allocationTotal(product, quantity);
        if (total == null || total.signum() <= 0) return;
        try {
            MarketingAllocation.lines(product, items, singlePrices, total, quantity);
        } catch (IllegalStateException exceeded) {
            if (!"ALLOCATION_EXCEEDS_LIST".equals(exceeded.getMessage())) throw exceeded;
            throw MarketingProductException.conflict("SEAT_PRICE_EXCEEDS_LIST",
                    "多人票价格高于单人价 × 人数，暂不可售");
        }
    }

    /** 与成交侧分摊总额同源：有现金标价用现金总额，纯积分商品用积分折合金额。 */
    private BigDecimal allocationTotal(MarketingProduct product, int quantity) {
        BigDecimal cash = MarketingQuotePayload.cashTotal(product.getCashPrice(), quantity);
        if (cash != null && cash.signum() > 0) return cash;
        Integer points = MarketingQuotePayload.pointsTotal(product.getPointsPrice(), quantity);
        if (points == null) return null;
        PointsValuePolicy policy = pointsValuePolicy == null ? PointsValuePolicy.codeDefaults() : pointsValuePolicy;
        return policy.yuanOf(points.longValue());
    }

    public boolean isSellable(MarketingProduct product, Date now) {
        try {
            requireSellable(product, now);
            // 多席自玩：每份应付超过"单人价 × 每份席位"即不可售，不出现在列表（报价/建单另按实际份数再拦）。
            requireListCoversPayable(product, items(product.getId()), 1);
            return true;
        } catch (MarketingProductException rejected) {
            return false;
        }
    }

    /**
     * 团体/学校转入既有报名结算所需的真实参数（ownerType/ownerId/ticketId/tickets）。
     * 票种解析不到时仍给出 ticketId 并标 ticketResolved=false，客户端据此报配置缺口而不是猜参数。
     */
    public java.util.Map<String, Object> ticketCheckout(MarketingProduct product, int quantity) {
        OmsTicket ticket = boundTicket(product);
        java.util.Map<String, Object> checkout = new java.util.LinkedHashMap<>();
        checkout.put("quoteEndpoint", "/api/registration/quote");
        checkout.put("createEndpoint", "/api/registration/create");
        // 与 MG（团体/学校）lane 的命名对齐；同值别名，避免两边各写一份端点常量。
        checkout.put("groupQuoteEndpoint", "/api/marketing/group-checkout/quote");
        checkout.put("groupCreateEndpoint", "/api/marketing/group-checkout/create");
        checkout.put("productId", product == null ? null : product.getId());
        checkout.put("ticketId", ticket == null ? (product == null ? null : product.getTicketId()) : ticket.getId());
        if (ticket != null) {
            checkout.put("ownerType", ticket.getOwnerType());
            checkout.put("ownerId", ticket.getOwnerId());
            // ownerType=2 时 ownerId 就是活动 id；场次时间/事实由 MG lane 按此 id 自行解析。
            checkout.put("activityId", Long.valueOf(2L).equals(ticket.getOwnerType()) ? ticket.getOwnerId() : null);
            checkout.put("sessionStartAt", ticket.getStartTime());
            checkout.put("sessionEndAt", ticket.getEndTime());
            checkout.put("signupDeadline", ticket.getSignupDeadline());
            checkout.put("remainingInventory", ticket.getRemainingInventory());
        }
        checkout.put("quantity", quantity);
        java.util.List<java.util.Map<String, Object>> tickets = new java.util.ArrayList<>();
        java.util.Map<String, Object> line = new java.util.LinkedHashMap<>();
        line.put("ticketId", ticket == null ? (product == null ? null : product.getTicketId()) : ticket.getId());
        line.put("count", quantity);
        tickets.add(line);
        checkout.put("tickets", tickets);
        checkout.put("ticketResolved", ticket != null);
        return checkout;
    }

    /** 团体/学校的原票种（报价跳转用）；未绑定返回 null。 */
    public OmsTicket boundTicket(MarketingProduct product) {
        if (product == null || product.getTicketId() == null || product.getTicketId() <= 0) return null;
        return ticketService.selectOmsTicketById(product.getTicketId());
    }

    public void requireQuantity(int quantity) {
        if (quantity < 1 || quantity > MAX_QUANTITY) {
            throw MarketingProductException.badRequest("QUANTITY_INVALID", "数量不合法");
        }
    }

    /** 加座必须挂在本人已付、且商品匹配的原商品订单上；原订单已付金额不改。 */
    public Long requireAddOnBase(long memberId, MarketingProduct product, String originalOrderNo) {
        if (product.getParentProductId() == null) {
            throw MarketingProductException.badRequest("ADD_ON_BASE_MISSING", "加座商品未绑定原商品");
        }
        if (originalOrderNo == null || originalOrderNo.trim().isEmpty()) {
            throw MarketingProductException.badRequest("ORIGINAL_ORDER_REQUIRED", "请提供原订单号");
        }
        MarketingProductOrder original = orderMapper.selectByOrderNo(originalOrderNo.trim());
        if (original == null || !Long.valueOf(memberId).equals(original.getMemberId())) {
            throw MarketingProductException.forbidden("ORIGINAL_ORDER_FORBIDDEN", "原订单不属于你");
        }
        if (!Integer.valueOf(MarketingProductOrder.STATUS_PAID).equals(original.getStatus())) {
            throw MarketingProductException.conflict("ORIGINAL_ORDER_NOT_PAID", "原订单尚未支付");
        }
        if (Integer.valueOf(MarketingProductOrder.FULFILLMENT_GIFT).equals(original.getFulfillmentKind())) {
            throw MarketingProductException.conflict("ORIGINAL_ORDER_IS_GIFT", "礼品订单不能加座");
        }
        if (!product.getParentProductId().equals(original.getProductId())) {
            throw MarketingProductException.conflict("ADD_ON_BASE_MISMATCH", "加座商品与原订单不匹配");
        }
        if (original.getPrimaryRegistrationId() == null) {
            throw MarketingProductException.conflict("ORIGINAL_ADMISSION_MISSING", "原订单尚无原注册准入");
        }
        return original.getId();
    }

    /**
     * 成交发放前就会做的主题可售检查：主题还在、必须是平台自营、有平台费率、退款窗口能定下来。
     * 付款参数发出之前调用，避免钱扣了才在发放时失败。判据与
     * {@code MarketingProductFulfillmentServiceImpl} 落单时相同。
     *
     * @param termsVersion 成交条款版本。多人票开放式路线允许没有履约窗，与发放侧同一例外。
     */
    public void requireCollectibleTopics(MarketingProduct product, List<MarketingProductItem> items,
                                         String termsVersion) {
        if (product == null || items == null || items.isEmpty()) {
            throw MarketingProductException.conflict("PRODUCT_HAS_NO_CONTENT", "商品未绑定任何作品");
        }
        boolean explore = product.occupiesExploreCapacity();
        boolean seatTicket = TopicSeatProducts.TERMS_VERSION.equals(termsVersion);
        for (MarketingProductItem item : items) {
            Long topicId = item == null ? null : item.getTopicId();
            CmsTopic topic = topicId == null ? null : topicMapper.selectCmsTopicById(topicId);
            if (topic == null || Integer.valueOf(2).equals(topic.getDelFlag())) {
                throw MarketingProductException.conflict("TOPIC_NOT_SELLABLE",
                        "商品覆盖的主题不存在或已删除");
            }
            if (productRoleService == null || !productRoleService.isPlatformOwned(topic.getId())) {
                throw MarketingProductException.conflict("TOPIC_NOT_PLATFORM_OWNED",
                        "商品覆盖的主题非平台自营,拒绝代收");
            }
            if (topic.getFeePlatformRate() == null) {
                throw MarketingProductException.conflict("TOPIC_FEE_RATE_MISSING",
                        "主题缺少平台费率快照,拒绝落单");
            }
            requireRefundWindow(product, topic, explore, seatTicket);
        }
    }

    /** 与发放侧 {@code applyRefundSnapshot} 同一口退款钟：定不下来就还不能收款。 */
    private void requireRefundWindow(MarketingProduct product, CmsTopic topic, boolean explore, boolean seatTicket) {
        if (explore) {
            Date anchor = exploreExpiryAnchor(product);
            if (RefundPolicy.snapshotOnPurchase(PurchaseKind.EXPLORE_PASS, null, anchor) == null) {
                throw MarketingProductException.conflict("REFUND_WINDOW_MISSING",
                        "探索票缺少到期锚点,退款窗口无法确定,该商品暂不可售");
            }
            return;
        }
        try {
            FulfillmentWindowResolver.resolve(topic, null);
        } catch (IllegalStateException missingWindow) {
            if (seatTicket && FulfillmentWindowResolver.isOpenEnded(topic)) {
                return;
            }
            throw MarketingProductException.conflict("REFUND_WINDOW_MISSING",
                    "主题履约窗未配置,退款窗口无法确定,该商品暂不可售");
        }
    }

    /** 只判断到期锚点能不能定下来，不把这个时刻写进订单。 */
    private static Date exploreExpiryAnchor(MarketingProduct product) {
        Integer kind = product.getValidityKind();
        if (kind == null || kind == MarketingProduct.VALIDITY_NONE) {
            return null;
        }
        if (kind == MarketingProduct.VALIDITY_RELATIVE_DAYS
                || kind == MarketingProduct.VALIDITY_ACTIVATE_ON_FIRST_USE) {
            if (product.getValidDays() == null || product.getValidDays() <= 0) {
                return null;
            }
            return new Date();
        }
        if (kind == MarketingProduct.VALIDITY_FIXED_WINDOW) {
            return product.getFixedValidTo();
        }
        return null;
    }
}
