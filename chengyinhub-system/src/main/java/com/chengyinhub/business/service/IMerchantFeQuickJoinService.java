package com.chengyinhub.business.service;

import com.chengyinhub.business.domain.dto.MerchantFeQuickJoinDTO;

import java.util.Map;

/**
 * §4.3 商家 5 分钟 4 字段快速加入自由探索聚合服务。
 */
public interface IMerchantFeQuickJoinService {

    /**
     * 一次聚合完成：校验商家归属/邀请与章节资格 → 接受邀请或提交申请 → 保存免玩法模板节点 →
     * 创建权益模板并入驻供给（写入 OfferRedeemLimits 对应的每日上限与闲时时段）。
     *
     * @param ownerMemberId 当前登录商家 Owner 的 memberId（服务端鉴权解析，绝不取前端传参）
     * @param request       4 字段纯白话入参
     * @return 聚合结果摘要（status/applicationId/nodeId/offerId/perkTemplateId/storefrontPhoto/redeemLimits）
     */
    Map<String, Object> quickJoin(Long ownerMemberId, MerchantFeQuickJoinDTO request);
}
