package com.chengyinhub.business.mapper;

import org.apache.ibatis.annotations.Param;
import com.chengyinhub.business.domain.ClubPostLike;

/**
 * 俱乐部动态点赞 Mapper 接口
 */
public interface ClubPostLikeMapper
{
    public ClubPostLike selectByPostAndMember(@Param("postId") Long postId, @Param("memberId") Long memberId);

    /** 审计 1122 E2:一页帖子一次查出本人点过赞的帖子 id,替代逐帖查询。 */
    public java.util.List<Long> selectLikedPostIds(@Param("postIds") java.util.Collection<Long> postIds, @Param("memberId") Long memberId);

    public int insertClubPostLike(ClubPostLike clubPostLike);

    public int deleteByPostAndMember(@Param("postId") Long postId, @Param("memberId") Long memberId);
}
