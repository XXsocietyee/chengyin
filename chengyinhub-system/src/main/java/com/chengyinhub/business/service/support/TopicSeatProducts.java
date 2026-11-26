package com.chengyinhub.business.service.support;

import com.chengyinhub.business.domain.CmsTopic;
import com.chengyinhub.business.domain.MarketingProduct;
import com.chengyinhub.business.domain.MarketingProductItem;
import com.chengyinhub.business.mapper.CmsTopicMapper;
import com.chengyinhub.business.mapper.MarketingProductMapper;
import com.chengyinhub.business.service.IProductRoleService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Objects;

/**
 * 每个平台自营自玩主题的双人票 / 四人小队票（owner 2026-11-24）。
 *
 * <p>幂等：按稳定编码 {@link #productCode(long, int)} 找行，每个主题恰好一条 2 席、一条 4 席商品，
 * 只绑定该主题。价格只来自 {@link SeatTicketPricing}。主题可售条件与 #912 发放侧一致：
 * 未删除、平台自营（内容槽 PLATFORM）、{@code self_play=1}、{@code self_play_price>0}、有平台费率快照、
 * 履约窗（start/end）可解析或开放式（start/end 都为空，2026-11-24 SEATS2）。不满足时把已有多人票置 0（草稿），绝不删除（订单会引用）。
 *
 * <p>owner 手工停售（status=2）的行保持停售，只跟随改名改价。编码被别的形状占用时不动它，只记日志。
 * 调用方在改主题价格/可售条件的同一事务里调用；本类先锁主题行，同一主题的并发同步串行，改行另走 revision CAS。
 */
@Component
public class TopicSeatProducts {

    private static final Logger log = LoggerFactory.getLogger(TopicSeatProducts.class);

    public static final String TERMS_VERSION = "SEAT_SELF_PLAY_20261124";
    static final int NAME_MAX = 120;
    static final int TITLE_MAX = 160;

    private final CmsTopicMapper topicMapper;
    private final MarketingProductMapper productMapper;
    private final IProductRoleService productRoleService;

    public TopicSeatProducts(CmsTopicMapper topicMapper,
                             MarketingProductMapper productMapper,
                             IProductRoleService productRoleService) {
        this.topicMapper = topicMapper;
        this.productMapper = productMapper;
        this.productRoleService = productRoleService;
    }

    /** 同步结果：每个人数一项，便于日志与测试。 */
    public static final class Change {
        public final int seats;
        public final String action;
        public final Long productId;

        Change(int seats, String action, Long productId) {
            this.seats = seats;
            this.action = action;
            this.productId = productId;
        }

        @Override
        public String toString() {
            return seats + ":" + action + (productId == null ? "" : "#" + productId);
        }
    }

    public static String productCode(long topicId, int seats) {
        return "SEAT" + seats + "-T" + topicId;
    }

    /** 主题名 + 票名，按 Unicode 码点截到列宽。 */
    public static String productName(String topicName, int seats) {
        String suffix = seats == 2 ? "双人票" : seats == 4 ? "四人小队票" : seats + "人票";
        String base = trimSpaces(topicName);
        int room = NAME_MAX - 1 - suffix.length();
        return (base.isEmpty() ? "" : truncate(base, room) + "·") + suffix;
    }

    /** 不可售原因；可售返回 null。与 MarketingProductFulfillmentServiceImpl 发放前校验同口径。 */
    public static String ineligibleReason(CmsTopic topic, boolean platformOwned) {
        if (topic == null) return "TOPIC_MISSING";
        if (Integer.valueOf(2).equals(topic.getDelFlag())) return "TOPIC_DELETED";
        if (!platformOwned) return "NOT_PLATFORM_OWNED";
        if (!Integer.valueOf(1).equals(topic.getSelfPlay())) return "SELF_PLAY_OFF";
        BigDecimal price = topic.getSelfPlayPrice();
        if (price == null || price.signum() <= 0) return "SELF_PLAY_PRICE_MISSING";
        if (price.stripTrailingZeros().scale() > 2) return "SELF_PLAY_PRICE_NOT_CENTS";
        if (topic.getFeePlatformRate() == null) return "FEE_SNAPSHOT_MISSING";
        // 开放式路线（start/end 都为空）与单人自玩票同样可售：退款不打快照，读侧转人工（RefundPolicy）。
        if (FulfillmentWindowResolver.isOpenEnded(topic)) return null;
        try {
            FulfillmentWindowResolver.resolve(topic, null);
        } catch (IllegalStateException missingWindow) {
            return "FULFILLMENT_WINDOW_MISSING";
        }
        return null;
    }

    /** 绑定行冻结的内容修订：最近一次发布的配置版本；LINEAR 主题未发布分支路线时记 1（仅报价签名/展示元数据）。 */
    public static long contentRevision(CmsTopic topic) {
        Long version = topic.getPublishedConfigVersion();
        return version != null && version > 0 ? version : 1L;
    }

    /** 为该主题建好或更新两条多人票；不可售时下架。 */
    public List<Change> sync(Long topicId) {
        List<Change> changes = new ArrayList<>();
        if (topicId == null || topicId <= 0) return changes;
        CmsTopic topic = topicMapper.selectCmsTopicByIdForUpdate(topicId);
        boolean platformOwned = topic != null && productRoleService.isPlatformOwned(topicId);
        String reason = ineligibleReason(topic, platformOwned);
        Date now = new Date();
        for (int seats : SeatTicketPricing.SEAT_COUNTS) {
            changes.add(syncOne(topicId, topic, seats, reason, now));
        }
        log.info("seat products synced topicId={} eligible={} reason={} changes={}",
                topicId, reason == null, reason, changes);
        return changes;
    }

    private Change syncOne(long topicId, CmsTopic topic, int seats, String reason, Date now) {
        String code = productCode(topicId, seats);
        MarketingProduct existing = productMapper.selectByProductCode(code);
        if (existing != null && !ownedShape(existing, topicId, seats)) {
            log.warn("seat product code {} holds another shape (id={}); left untouched", code, existing.getId());
            return new Change(seats, "FOREIGN_SKIPPED", existing.getId());
        }
        if (reason != null) {
            if (existing == null) return new Change(seats, "NONE", null);
            if (!Integer.valueOf(MarketingProduct.STATUS_ON_SALE).equals(existing.getStatus())) {
                return new Change(seats, "UNCHANGED", existing.getId());
            }
            update(existing, code, existing.getProductName(), existing.getCashPrice(), MarketingProduct.STATUS_DRAFT, now);
            return new Change(seats, "DEACTIVATED", existing.getId());
        }
        String name = productName(topic.getName(), seats);
        BigDecimal price = SeatTicketPricing.price(topic.getSelfPlayPrice(), seats);
        String title = truncate(trimSpaces(topic.getName()), TITLE_MAX);
        long revision = contentRevision(topic);
        if (existing == null) {
            MarketingProduct created = insert(code, name, price, seats, now);
            MarketingProductItem item = new MarketingProductItem();
            item.setProductId(created.getId());
            item.setTopicId(topicId);
            item.setTopicTitle(title);
            item.setContentRevision(revision);
            item.setSortNo(0);
            item.setCreateTime(now);
            if (productMapper.insertItem(item) != 1) {
                throw new IllegalStateException("多人票绑定主题写入失败 code=" + code);
            }
            return new Change(seats, "CREATED", created.getId());
        }
        int status = Integer.valueOf(MarketingProduct.STATUS_OFF_SALE).equals(existing.getStatus())
                ? MarketingProduct.STATUS_OFF_SALE : MarketingProduct.STATUS_ON_SALE;
        boolean productChanged = !name.equals(existing.getProductName())
                || existing.getCashPrice() == null || price.compareTo(existing.getCashPrice()) != 0
                || !Integer.valueOf(status).equals(existing.getStatus());
        MarketingProductItem item = productMapper.selectItems(existing.getId()).get(0);
        boolean itemChanged = !title.equals(item.getTopicTitle()) || !Long.valueOf(revision).equals(item.getContentRevision());
        if (itemChanged) {
            productMapper.updateItemSnapshot(existing.getId(), topicId, title, revision);
        }
        if (productChanged || itemChanged) {
            // 改价/改内容都必须递增 revision（报价签名带 revision，旧报价随之失效）。
            update(existing, code, name, price, status, now);
            return new Change(seats, "UPDATED", existing.getId());
        }
        return new Change(seats, "UNCHANGED", existing.getId());
    }

    private boolean ownedShape(MarketingProduct product, long topicId, int seats) {
        if (!Integer.valueOf(MarketingProduct.KIND_SINGLE_QUEST).equals(product.getProductKind())
                || !Integer.valueOf(MarketingProduct.ROUTE_SELF_PLAY_GRANT).equals(product.getFulfillmentRoute())
                || !Integer.valueOf(seats).equals(product.getSeatCount())
                || product.getTicketId() != null
                || product.getParentProductId() != null) {
            return false;
        }
        List<MarketingProductItem> items = productMapper.selectItems(product.getId());
        return items != null && items.size() == 1 && Objects.equals(items.get(0).getTopicId(), topicId);
    }

    private MarketingProduct insert(String code, String name, BigDecimal price, int seats, Date now) {
        MarketingProduct product = new MarketingProduct();
        product.setProductCode(code);
        product.setProductName(name);
        product.setProductKind(MarketingProduct.KIND_SINGLE_QUEST);
        product.setPurchaseKind(2);
        product.setExploreCapacity(0);
        product.setFulfillmentRoute(MarketingProduct.ROUTE_SELF_PLAY_GRANT);
        product.setTicketId(null);
        product.setCashPrice(price);
        product.setPointsPrice(null);
        // #912：多人票不得用 3（首次使用起算）——未激活就没有原单行，到账后无法邀请同伴。
        product.setValidityKind(MarketingProduct.VALIDITY_NONE);
        product.setSeatCount(seats);
        product.setGiftAllowed(0);
        product.setStatus(MarketingProduct.STATUS_ON_SALE);
        product.setTermsVersion(TERMS_VERSION);
        product.setRevision(1L);
        product.setCreateTime(now);
        product.setUpdateTime(now);
        if (productMapper.insertProduct(product) != 1 || product.getId() == null) {
            throw new IllegalStateException("多人票商品写入失败 code=" + code);
        }
        return product;
    }

    private void update(MarketingProduct existing, String code, String name, BigDecimal price, int status, Date now) {
        if (productMapper.updateSeatProduct(existing.getId(), code, existing.getRevision(), name, price, status, now) != 1) {
            throw new IllegalStateException("多人票商品已被并发修改 code=" + code);
        }
    }

    /** 与 MySQL TRIM() 同口径：只去首尾半角空格（回填迁移按同一规则命名）。 */
    static String trimSpaces(String value) {
        if (value == null) return "";
        int from = 0;
        int to = value.length();
        while (from < to && value.charAt(from) == ' ') from++;
        while (to > from && value.charAt(to - 1) == ' ') to--;
        return value.substring(from, to);
    }

    static String truncate(String value, int maxCodePoints) {
        if (maxCodePoints <= 0) return "";
        if (value.codePointCount(0, value.length()) <= maxCodePoints) return value;
        return value.substring(0, value.offsetByCodePoints(0, maxCodePoints));
    }
}
