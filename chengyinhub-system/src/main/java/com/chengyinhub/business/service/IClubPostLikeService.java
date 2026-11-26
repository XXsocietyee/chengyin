package com.chengyinhub.business.service;

import com.chengyinhub.business.domain.ClubPostLike;

/**
 * 俱乐部动态点赞 Service 接口
 */
public interface IClubPostLikeService
{
    public ClubPostLike selectByPostAndMember(Long postId, Long memberId);

    /** 本人在给定帖子里点过赞的帖子 id;未登录或空列表返回空集。默认实现逐条查,生产实现一次批量查询。 */
    default java.util.Set<Long> selectLikedPostIds(java.util.Collection<Long> postIds, Long memberId)
    {
        java.util.Set<Long> liked = new java.util.HashSet<>();
        if (memberId == null || postIds == null) return liked;
        for (Long id : postIds)
        {
            if (id != null && selectByPostAndMember(id, memberId) != null) liked.add(id);
        }
        return liked;
    }

    public int insertClubPostLike(ClubPostLike clubPostLike);

    public int deleteByPostAndMember(Long postId, Long memberId);
}
