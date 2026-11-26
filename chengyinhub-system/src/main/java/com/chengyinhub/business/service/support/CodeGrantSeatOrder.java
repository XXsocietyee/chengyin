package com.chengyinhub.business.service.support;

import com.chengyinhub.business.domain.CmsRegistration;
import com.chengyinhub.business.domain.MarketingCodeGrant;

/**
 * DEC-F17(2026-11-25 业主拍板「建一张 ¥0 已付单」):N 座平台兑换码的 ¥0 席位锚单的唯一判定口径。
 *
 * <p>标记复用既有来源列 {@code cms_registration.create_by}:锚单恒为 {@link #CREATED_BY},
 * 该值只由 {@code CmsRegistrationMapper.insertCodeGrantSeatOrder} 写入(服务端常量;下单路径写 memberId,
 * 通用后台新增已关闭,后台编辑白名单不含 create_by),客户端无法伪造。
 * 一码最多一张由既有唯一键 {@code uk_reg_member_request(member_id, request_id)} 保证:
 * 一张码只归一个兑换人,request_id 恒为 {@link #requestIdOf}。不新增列、不需要迁移。
 *
 * <p>资金读侧(结算、退款、分佣/奖励等)用 {@link #isCodeGranted} 或 SQL
 * {@code coalesce(r.create_by,'') <> 'platform-code'} 排除锚单。
 */
public final class CodeGrantSeatOrder {

    /** 锚单 create_by / update_by 的服务端常量。 */
    public static final String CREATED_BY = "platform-code";

    private CodeGrantSeatOrder() { }

    /** 锚单 request_id:与授权幂等键同形(PCG:码id:主题id),配合 member_id 唯一键一码一张。 */
    public static String requestIdOf(Long voucherId, Long topicId) {
        return MarketingCodeGrant.idempotencyKeyOf(voucherId, topicId);
    }

    /** 是否码授予的 ¥0 锚单。只看服务端写入的来源列。 */
    public static boolean isCodeGranted(CmsRegistration registration) {
        return registration != null && CREATED_BY.equals(registration.getCreateBy());
    }
}
