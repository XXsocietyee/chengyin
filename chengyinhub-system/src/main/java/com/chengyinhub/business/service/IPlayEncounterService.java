package com.chengyinhub.business.service;

import java.util.Map;

/**
 * 玩法 Beat(Encounter)只读解析:这一拍演什么。
 *
 * <p>只读,不写任何表;状态取自本局 {@code topic_route_session.state_json},
 * 完成/到店事实复用既有服务。
 */
public interface IPlayEncounterService {


    /**
     * 解析一个节点上的这一拍。
     *
     * @return 契约形状见 R2-B7;node/topic 不匹配、无局、无权访问时抛 ServiceException(业务错误)。
     */
    default Map<String, Object> resolve(Long memberId, Long topicId, Long nodeId) {
        return resolve(memberId, topicId, null, nodeId, null);
    }
    Map<String, Object> resolve(Long memberId, Long topicId, Long activityId, Long nodeId);

    /** 支持轻量视角提示 roleHint（A/B/C/D 或 SOLO 逃生舱），缺省沿用既有队伍/席位判定。 */
    default Map<String, Object> resolve(Long memberId, Long topicId, Long activityId, Long nodeId, String roleHint) {
        return resolve(memberId, topicId, activityId, nodeId);
    }
}
