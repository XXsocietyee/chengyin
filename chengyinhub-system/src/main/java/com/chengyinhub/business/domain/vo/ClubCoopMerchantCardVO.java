package com.chengyinhub.business.domain.vo;

/**
 * 俱乐部找商家 / 发合作邀约用的商家卡。
 *
 * <p>只放两个调用方实际渲染的字段：
 * {@code pages/club/detail} 的场地卡（id、名称、封面、logo、地址、品类、承接标记、
 * 营业状态、容量、收费、时段、坐标、适合的活动类型）和
 * {@code pages/coop/invite} 的勾选对象（memberId 是邀约 toId，不是联系方式）。
 * 电话、微信、二维码、执照、审核备注、证件不进这个类型。</p>
 */
public class ClubCoopMerchantCardVO {

    private Long id;
    private Long memberId;
    private String name;
    private String logo;
    private String coverImage;
    private String address;
    private Integer categoryId;
    private Integer coopOpen;
    private String suitActivityTypes;
    private String availableTime;
    private String businessTime;
    private Integer capacity;
    private Integer chargeType;
    private Integer businessStatus;
    private Double locationLat;
    private Double locationLng;

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public Long getMemberId() { return memberId; }
    public void setMemberId(Long memberId) { this.memberId = memberId; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getLogo() { return logo; }
    public void setLogo(String logo) { this.logo = logo; }
    public String getCoverImage() { return coverImage; }
    public void setCoverImage(String coverImage) { this.coverImage = coverImage; }
    public String getAddress() { return address; }
    public void setAddress(String address) { this.address = address; }
    public Integer getCategoryId() { return categoryId; }
    public void setCategoryId(Integer categoryId) { this.categoryId = categoryId; }
    public Integer getCoopOpen() { return coopOpen; }
    public void setCoopOpen(Integer coopOpen) { this.coopOpen = coopOpen; }
    public String getSuitActivityTypes() { return suitActivityTypes; }
    public void setSuitActivityTypes(String suitActivityTypes) { this.suitActivityTypes = suitActivityTypes; }
    public String getAvailableTime() { return availableTime; }
    public void setAvailableTime(String availableTime) { this.availableTime = availableTime; }
    public String getBusinessTime() { return businessTime; }
    public void setBusinessTime(String businessTime) { this.businessTime = businessTime; }
    public Integer getCapacity() { return capacity; }
    public void setCapacity(Integer capacity) { this.capacity = capacity; }
    public Integer getChargeType() { return chargeType; }
    public void setChargeType(Integer chargeType) { this.chargeType = chargeType; }
    public Integer getBusinessStatus() { return businessStatus; }
    public void setBusinessStatus(Integer businessStatus) { this.businessStatus = businessStatus; }
    public Double getLocationLat() { return locationLat; }
    public void setLocationLat(Double locationLat) { this.locationLat = locationLat; }
    public Double getLocationLng() { return locationLng; }
    public void setLocationLng(Double locationLng) { this.locationLng = locationLng; }
}
