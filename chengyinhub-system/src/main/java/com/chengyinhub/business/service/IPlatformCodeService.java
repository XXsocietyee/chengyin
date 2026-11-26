package com.chengyinhub.business.service;

import com.chengyinhub.business.domain.dto.ChannelRedeemResult;
import com.chengyinhub.business.domain.dto.ChannelVoucherRevokeRequest;
import com.chengyinhub.business.domain.dto.ChannelVoucherView;
import com.chengyinhub.business.domain.dto.PlatformCodeIssueRequest;

import java.util.List;

/**
 * 平台自发兑换码（开关 {@code channel.platform-issued.enabled}，默认关闭）。
 *
 * <p>兑换产出 {@code marketing_code_grant} 授权事实（凭码解锁），不写 cms_registration、
 * 不建支付行/零元已付单、不入收入队列。外部渠道码链路不经过本服务。
 */
public interface IPlatformCodeService {

    boolean enabled();

    List<ChannelVoucherView> issue(long operatorUserId, PlatformCodeIssueRequest request);

    List<ChannelVoucherView> list(long operatorUserId, String batchNo, Integer status, int limit);

    ChannelVoucherView revoke(long operatorUserId, Long voucherId, ChannelVoucherRevokeRequest request);

    /** 由 {@code POST /api/channel/redeem} 在识别出平台码（issuer_type=PLATFORM）后调用；调用方已校验码哈希。 */
    ChannelRedeemResult redeem(long memberId, Long voucherId, String requestId, String requestFingerprint);
}
