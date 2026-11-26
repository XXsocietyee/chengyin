package com.chengyinhub.business.domain.dto;

/**
 * DEC-F12 B 购票人把空闲内含席位按手机号转赠给同伴。
 * 手机号只在本请求里出现一次:服务端规范化后只存盲索引与脱敏号,不落明文、不写日志。
 */
public class SeatPhoneTransferRequest {

    private Long registrationId;
    private Integer seatNo;
    private String name;
    private String phone;
    private String requestId;

    public Long getRegistrationId() { return registrationId; }
    public void setRegistrationId(Long value) { registrationId = value; }
    public Integer getSeatNo() { return seatNo; }
    public void setSeatNo(Integer value) { seatNo = value; }
    public String getName() { return name; }
    public void setName(String value) { name = value; }
    public String getPhone() { return phone; }
    public void setPhone(String value) { phone = value; }
    public String getRequestId() { return requestId; }
    public void setRequestId(String value) { requestId = value; }

    /** 不把姓名/手机号带进日志。 */
    @Override
    public String toString() {
        return "SeatPhoneTransferRequest{registrationId=" + registrationId + ", seatNo=" + seatNo + "}";
    }
}
