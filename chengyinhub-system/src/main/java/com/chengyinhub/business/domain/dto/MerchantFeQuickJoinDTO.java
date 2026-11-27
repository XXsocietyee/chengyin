package com.chengyinhub.business.domain.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.io.Serializable;
import java.math.BigDecimal;

/**
 * §4.3 商家 5 分钟 4 字段快速加入自由探索（POST /api/merchant/fe/quick-join）入参。
 *
 * <p>4 个纯白话字段取代内部术语：到店福利说明、门店原价、闲时可用时段与每日上限、门头照片（缺省取入驻照片）。
 */
public class MerchantFeQuickJoinDTO implements Serializable {
    private static final long serialVersionUID = 1L;

    @Schema(description = "目标章节ID")
    private Long chapterId;

    @Schema(description = "可选：待接受的邀请/申请ID（服务端严格校验归属与章节一致）")
    private Long applicationId;

    @Schema(description = "到店福利说明（例如：美式咖啡一杯）")
    private String perkDescription;

    @Schema(description = "门店原价（元）")
    private BigDecimal originalPrice;

    @Schema(description = "闲时可用时段（例如：14:00-17:00 或 工作日 14:00-17:00；空=全天可用）")
    private String offPeakHours;

    @Schema(description = "每日接待上限（正整数，映射 OfferRedeemLimits / daily_capacity）")
    private Integer dailyCap;

    @Schema(description = "总可核销份数（可选；不传按每日上限推算默认额度）")
    private Integer quotaTotal;

    @Schema(description = "门头照片（可选；不传默认复用商家入驻门头照）")
    private String storefrontPhoto;

    @Schema(description = "是否勾选同意合作条款")
    private Boolean termsAgreed;

    public Long getChapterId() { return chapterId; }
    public void setChapterId(Long chapterId) { this.chapterId = chapterId; }

    public Long getApplicationId() { return applicationId; }
    public void setApplicationId(Long applicationId) { this.applicationId = applicationId; }

    public String getPerkDescription() { return perkDescription; }
    public void setPerkDescription(String perkDescription) { this.perkDescription = perkDescription; }

    public BigDecimal getOriginalPrice() { return originalPrice; }
    public void setOriginalPrice(BigDecimal originalPrice) { this.originalPrice = originalPrice; }

    public String getOffPeakHours() { return offPeakHours; }
    public void setOffPeakHours(String offPeakHours) { this.offPeakHours = offPeakHours; }

    public Integer getDailyCap() { return dailyCap; }
    public void setDailyCap(Integer dailyCap) { this.dailyCap = dailyCap; }

    public Integer getQuotaTotal() { return quotaTotal; }
    public void setQuotaTotal(Integer quotaTotal) { this.quotaTotal = quotaTotal; }

    public String getStorefrontPhoto() { return storefrontPhoto; }
    public void setStorefrontPhoto(String storefrontPhoto) { this.storefrontPhoto = storefrontPhoto; }

    public Boolean getTermsAgreed() { return termsAgreed; }
    public void setTermsAgreed(Boolean termsAgreed) { this.termsAgreed = termsAgreed; }
}
