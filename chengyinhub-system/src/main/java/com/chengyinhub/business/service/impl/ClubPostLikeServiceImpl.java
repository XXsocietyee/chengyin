package com.chengyinhub.business.service.impl;

import com.chengyinhub.common.utils.DateUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import com.chengyinhub.business.mapper.ClubPostLikeMapper;
import com.chengyinhub.business.domain.ClubPostLike;
import com.chengyinhub.business.service.IClubPostLikeService;

/**
 * 俱乐部动态点赞 Service 业务层处理
 */
@Service
public class ClubPostLikeServiceImpl implements IClubPostLikeService
{
    @Autowired
    private ClubPostLikeMapper clubPostLikeMapper;

    @Override
    public ClubPostLike selectByPostAndMember(Long postId, Long memberId)
    {
        return clubPostLikeMapper.selectByPostAndMember(postId, memberId);
    }

    @Override
    public java.util.Set<Long> selectLikedPostIds(java.util.Collection<Long> postIds, Long memberId)
    {
        java.util.Set<Long> ids = new java.util.LinkedHashSet<>();
        if (postIds != null) for (Long id : postIds) if (id != null) ids.add(id);
        if (memberId == null || ids.isEmpty()) return new java.util.HashSet<>();
        java.util.List<Long> rows = clubPostLikeMapper.selectLikedPostIds(ids, memberId);
        return rows == null ? new java.util.HashSet<>() : new java.util.HashSet<>(rows);
    }

    @Override
    public int insertClubPostLike(ClubPostLike clubPostLike)
    {
        clubPostLike.setCreateTime(DateUtils.getNowDate());
        return clubPostLikeMapper.insertClubPostLike(clubPostLike);
    }

    @Override
    public int deleteByPostAndMember(Long postId, Long memberId)
    {
        return clubPostLikeMapper.deleteByPostAndMember(postId, memberId);
    }
}
