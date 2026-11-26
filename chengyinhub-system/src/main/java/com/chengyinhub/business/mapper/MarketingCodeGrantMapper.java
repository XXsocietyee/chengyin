package com.chengyinhub.business.mapper;

import com.chengyinhub.business.domain.MarketingCodeGrant;
import org.apache.ibatis.annotations.Param;

import java.util.Date;
import java.util.List;

/** 平台码授权可玩事实。只有插入与 ACTIVE→REVOKED 一种迁移；不写任何支付/注册/收入表。 */
public interface MarketingCodeGrantMapper {

    int insert(MarketingCodeGrant grant);

    List<MarketingCodeGrant> selectByVoucher(@Param("voucherId") Long voucherId);

    List<MarketingCodeGrant> selectByVoucherForUpdate(@Param("voucherId") Long voucherId);

    List<MarketingCodeGrant> selectByMemberRequest(@Param("memberId") Long memberId,
                                                   @Param("requestId") String requestId);

    /** 本人本主题的 ACTIVE 事实（按 actor + 主题收窄，不扫全主题）。 */
    List<MarketingCodeGrant> selectActiveByMemberTopic(@Param("memberId") Long memberId,
                                                       @Param("topicId") Long topicId);

    int revokeByVoucher(@Param("voucherId") Long voucherId,
                        @Param("reason") String reason,
                        @Param("revokedAt") Date revokedAt);
}
