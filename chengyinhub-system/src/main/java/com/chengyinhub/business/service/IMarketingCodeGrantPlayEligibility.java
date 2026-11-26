package com.chengyinhub.business.service;

import com.chengyinhub.business.domain.MarketingCodeGrant;

import java.util.List;

/**
 * 平台码授权对可玩资格的影响（只读，一次按 actor + owner 域的查询），与礼品
 * {@link IMarketingGiftPlayEligibility} 并列，合并点在 {@code CurrentPlayRegistration.collect}。
 *
 * <p>只在自玩域（{@code owner_type=1}，owner 为主题）有意义；活动/场次恒返回空，走原报名资格。
 * 只返回本人、本主题、ACTIVE 的事实；开关 {@code channel.platform-issued.enabled} 关闭时恒为空。
 * 缺失（null）时调用方按"无码授权事实"处理，原行为不变。
 */
public interface IMarketingCodeGrantPlayEligibility {

    List<MarketingCodeGrant> playFacts(Long memberId, long ownerType, Long ownerId);
}
