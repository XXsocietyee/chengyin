package com.chengyinhub.business.mapper;

import com.chengyinhub.business.domain.MarketingProduct;
import com.chengyinhub.business.domain.MarketingProductItem;
import org.apache.ibatis.annotations.Param;

import java.util.Date;
import java.util.List;

/** 商品配置与内容绑定。只读消费为主；insert 供运营配置与 MySqlIT 使用。 */
public interface MarketingProductMapper {

    MarketingProduct selectById(@Param("id") Long id);

    MarketingProduct selectByIdForUpdate(@Param("id") Long id);

    List<MarketingProduct> selectSellable(@Param("city") String city,
                                          @Param("kind") Integer kind,
                                          @Param("now") Date now,
                                          @Param("limit") int limit);

    /** 同 {@link #selectSellable}，另要求商品内容绑定了该主题（marketing_product_item.topic_id）。 */
    List<MarketingProduct> selectSellableByTopic(@Param("city") String city,
                                                 @Param("kind") Integer kind,
                                                 @Param("topicId") Long topicId,
                                                 @Param("now") Date now,
                                                 @Param("limit") int limit);

    List<MarketingProductItem> selectItems(@Param("productId") Long productId);

    List<MarketingProductItem> selectItemsByProductIds(@Param("productIds") List<Long> productIds);

    int insertProduct(MarketingProduct product);

    int insertItem(MarketingProductItem item);

    /**
     * 按稳定商品编码读取（主题多人票同步用；编码即幂等身份）。不加锁：缺行时的 FOR UPDATE 会持间隙锁，
     * 不同主题并发插入会互相死锁。同一主题由调用方先锁主题行串行，改行走 revision CAS。
     */
    MarketingProduct selectByProductCode(@Param("productCode") String productCode);

    /**
     * 主题多人票同步：改名、改价、改上架状态，revision 加一。只按 id + 编码 + 旧 revision 命中，
     * 别的商品不可能被改到；返回 0 表示行已被别人改过。
     */
    int updateSeatProduct(@Param("id") Long id,
                          @Param("productCode") String productCode,
                          @Param("expectedRevision") Long expectedRevision,
                          @Param("productName") String productName,
                          @Param("cashPrice") java.math.BigDecimal cashPrice,
                          @Param("status") Integer status,
                          @Param("now") Date now);

    /** 主题多人票同步：刷新绑定行的标题快照与内容修订（只命中该商品的该主题）。 */
    int updateItemSnapshot(@Param("productId") Long productId,
                           @Param("topicId") Long topicId,
                           @Param("topicTitle") String topicTitle,
                           @Param("contentRevision") Long contentRevision);
}
