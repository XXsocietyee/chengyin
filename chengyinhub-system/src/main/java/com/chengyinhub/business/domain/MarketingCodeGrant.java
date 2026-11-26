package com.chengyinhub.business.domain;

import com.chengyinhub.common.constant.PurchaseKind;

import java.util.Date;

/**
 * 平台码授权可玩事实（{@code marketing_code_grant}）：“凭码解锁”，不是付款、不是注册单。
 *
 * <p>一张平台码兑换后按商品内每个作品落一行；只在自玩域（owner_type=1，owner=主题）有意义。
 * 撤销只把 status 置为 REVOKED，停掉后续可玩；已完成/已核销的内容不回滚、也不会因撤销而复活。
 */
public class MarketingCodeGrant {

    public static final int STATUS_ACTIVE = 0;
    public static final int STATUS_REVOKED = 1;

    private Long id;
    private Long voucherId;
    private Long memberId;
    private Long productId;
    private Long productRevision;
    private Long topicId;
    private Long contentRevision;
    private Integer quantity;
    private Integer seatCount;
    private Integer status;
    private Date validFrom;
    private Date validTo;
    private Date grantedAt;
    private Date revokedAt;
    private String revokeReason;
    private String requestId;
    private String requestFingerprint;
    private String idempotencyKey;
    private Date createTime;
    private Date updateTime;

    public static String idempotencyKeyOf(Long voucherId, Long topicId) {
        return "PCG:" + voucherId + ":" + topicId;
    }

    /** 本人、本主题、未撤销（时效另判：已开局的本局可打完，与通行证同口径）。 */
    public boolean activeFor(Long actor, Long topic) {
        return Integer.valueOf(STATUS_ACTIVE).equals(status)
                && actor != null && actor.equals(memberId)
                && topic != null && topic.equals(topicId);
    }

    /** 未开局的新使用：必须在有效期内（valid_to 为空 = 随商品不过期）。 */
    public boolean validAt(Date now) {
        return (validFrom == null || !validFrom.after(now))
                && (validTo == null || validTo.after(now));
    }

    /**
     * 供原可玩链路读取的<b>瞬时</b>视图，不落库：id 为空（不是 cms_registration 行），
     * payment_status 为空（不是已付），只带范围、票种口径与有效期。
     */
    public CmsRegistration toPlayPass() {
        CmsRegistration pass = new CmsRegistration();
        pass.setMemberId(memberId);
        pass.setOwnerType(1L);
        pass.setOwnerId(topicId);
        pass.setRegistrationStatus(2);
        pass.setPurchaseKind(PurchaseKind.SELF_PLAY_PASS);
        pass.setExpiresAt(validTo);
        return pass;
    }

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getVoucherId() { return voucherId; }
    public void setVoucherId(Long voucherId) { this.voucherId = voucherId; }
    public Long getMemberId() { return memberId; }
    public void setMemberId(Long memberId) { this.memberId = memberId; }
    public Long getProductId() { return productId; }
    public void setProductId(Long productId) { this.productId = productId; }
    public Long getProductRevision() { return productRevision; }
    public void setProductRevision(Long productRevision) { this.productRevision = productRevision; }
    public Long getTopicId() { return topicId; }
    public void setTopicId(Long topicId) { this.topicId = topicId; }
    public Long getContentRevision() { return contentRevision; }
    public void setContentRevision(Long contentRevision) { this.contentRevision = contentRevision; }
    public Integer getQuantity() { return quantity; }
    public void setQuantity(Integer quantity) { this.quantity = quantity; }
    public Integer getSeatCount() { return seatCount; }
    public void setSeatCount(Integer seatCount) { this.seatCount = seatCount; }
    public Integer getStatus() { return status; }
    public void setStatus(Integer status) { this.status = status; }
    public Date getValidFrom() { return validFrom; }
    public void setValidFrom(Date validFrom) { this.validFrom = validFrom; }
    public Date getValidTo() { return validTo; }
    public void setValidTo(Date validTo) { this.validTo = validTo; }
    public Date getGrantedAt() { return grantedAt; }
    public void setGrantedAt(Date grantedAt) { this.grantedAt = grantedAt; }
    public Date getRevokedAt() { return revokedAt; }
    public void setRevokedAt(Date revokedAt) { this.revokedAt = revokedAt; }
    public String getRevokeReason() { return revokeReason; }
    public void setRevokeReason(String revokeReason) { this.revokeReason = revokeReason; }
    public String getRequestId() { return requestId; }
    public void setRequestId(String requestId) { this.requestId = requestId; }
    public String getRequestFingerprint() { return requestFingerprint; }
    public void setRequestFingerprint(String requestFingerprint) { this.requestFingerprint = requestFingerprint; }
    public String getIdempotencyKey() { return idempotencyKey; }
    public void setIdempotencyKey(String idempotencyKey) { this.idempotencyKey = idempotencyKey; }
    public Date getCreateTime() { return createTime; }
    public void setCreateTime(Date createTime) { this.createTime = createTime; }
    public Date getUpdateTime() { return updateTime; }
    public void setUpdateTime(Date updateTime) { this.updateTime = updateTime; }
}
