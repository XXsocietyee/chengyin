package com.chengyinhub.business.domain.dto;

import java.util.Date;

/**
 * 管理端平台自发码请求。商品/数量由运营指定（无外部订单可取）；
 * 批次号由服务端生成；备注只在管理端可见，不下发玩家。
 */
public class PlatformCodeIssueRequest {

    private String requestId;
    private Long productId;
    private Integer batchSize;
    private Integer quantity;
    private Date expiresAt;
    private String note;
    /** 可选：仅 batchSize=1 时可绑定会员（“不属于此账号”由此产生）。 */
    private Long boundMemberId;

    public String getRequestId() { return requestId; }
    public void setRequestId(String requestId) { this.requestId = requestId; }
    public Long getProductId() { return productId; }
    public void setProductId(Long productId) { this.productId = productId; }
    public Integer getBatchSize() { return batchSize; }
    public void setBatchSize(Integer batchSize) { this.batchSize = batchSize; }
    public Integer getQuantity() { return quantity; }
    public void setQuantity(Integer quantity) { this.quantity = quantity; }
    public Date getExpiresAt() { return expiresAt; }
    public void setExpiresAt(Date expiresAt) { this.expiresAt = expiresAt; }
    public String getNote() { return note; }
    public void setNote(String note) { this.note = note; }
    public Long getBoundMemberId() { return boundMemberId; }
    public void setBoundMemberId(Long boundMemberId) { this.boundMemberId = boundMemberId; }
}
