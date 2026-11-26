package com.chengyinhub.business.service.impl;

import com.chengyinhub.business.domain.MarketingCodeGrant;
import com.chengyinhub.business.mapper.MarketingCodeGrantMapper;
import com.chengyinhub.business.service.IMarketingCodeGrantPlayEligibility;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;

/**
 * 平台码授权 → 可玩资格的只读投影。只在自玩域（owner_type=1）生效；开关关闭时恒为空。
 */
@Service
public class MarketingCodeGrantPlayEligibility implements IMarketingCodeGrantPlayEligibility {

    private static final long OWNER_TOPIC = 1L;

    private final MarketingCodeGrantMapper grantMapper;
    private final boolean enabled;

    public MarketingCodeGrantPlayEligibility(MarketingCodeGrantMapper grantMapper,
            @Value("${channel.platform-issued.enabled:false}") boolean enabled) {
        this.grantMapper = grantMapper;
        this.enabled = enabled;
    }

    @Override
    @Transactional(readOnly = true)
    public List<MarketingCodeGrant> playFacts(Long memberId, long ownerType, Long ownerId) {
        if (!enabled || memberId == null || memberId <= 0
                || ownerType != OWNER_TOPIC || ownerId == null || ownerId <= 0) return new ArrayList<>();
        List<MarketingCodeGrant> rows = grantMapper.selectActiveByMemberTopic(memberId, ownerId);
        List<MarketingCodeGrant> out = new ArrayList<>();
        if (rows != null) for (MarketingCodeGrant row : rows) {
            if (row != null && row.activeFor(memberId, ownerId)) out.add(row);
        }
        return out;
    }
}
