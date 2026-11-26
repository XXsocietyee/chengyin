package com.chengyinhub.business.domain.dto;

import com.fasterxml.jackson.annotation.JsonFormat;

import java.util.Date;

public class ClubGovernanceBanRequest {
    private Long clubId;
    private Long targetMemberId;
    private String reason;
    /**
     * CU-C-55:端上原样发的是设备本地墙上时间串(无时区无偏移),后端按东八区反解,
     * 于是「7 天」会随时区漂移(走查实测 7 天实差 6 天 9 小时 ≈ 设备比东八区慢 15h)。
     * 新端改发 epoch 毫秒:同一时刻在哪儿都是同一时刻,「7 天」= 服务端 7×24 小时。
     * 老端仍然只发 expiresAt 字符串,所以字符串口径保留(并显式钉死东八区)。
     */
    private Long expiresAtEpochMs;
    /**
     * AUDIT-1122 L08-066(业主 2026-11-24 默认选项 A):新端只发所选天数(7/30/90),
     * 到期时刻由服务器按自己的时钟算,不受手机时间影响。有这个字段时优先于上面两种老口径。
     */
    private Integer durationDays;
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "Asia/Shanghai")
    private Date expiresAt;
    private String requestId;

    public Long getClubId() { return clubId; }
    public void setClubId(Long clubId) { this.clubId = clubId; }
    public Long getTargetMemberId() { return targetMemberId; }
    public void setTargetMemberId(Long targetMemberId) { this.targetMemberId = targetMemberId; }
    public String getReason() { return reason; }
    public void setReason(String reason) { this.reason = reason; }
    public Long getExpiresAtEpochMs() { return expiresAtEpochMs; }
    public void setExpiresAtEpochMs(Long expiresAtEpochMs) { this.expiresAtEpochMs = expiresAtEpochMs; }
    public Integer getDurationDays() { return durationDays; }
    public void setDurationDays(Integer durationDays) { this.durationDays = durationDays; }
    public Date getExpiresAt() { return expiresAt; }
    public void setExpiresAt(Date expiresAt) { this.expiresAt = expiresAt; }
    public String getRequestId() { return requestId; }
    public void setRequestId(String requestId) { this.requestId = requestId; }
}
