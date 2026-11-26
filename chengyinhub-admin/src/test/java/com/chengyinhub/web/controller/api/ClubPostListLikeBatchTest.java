package com.chengyinhub.web.controller.api;

import com.chengyinhub.business.domain.Club;
import com.chengyinhub.business.domain.ClubPost;
import com.chengyinhub.business.domain.ClubPostComment;
import com.chengyinhub.business.domain.dto.ClubPostMutationRequest;
import com.chengyinhub.business.service.IClubMemberService;
import com.chengyinhub.business.service.IClubPostCommentService;
import com.chengyinhub.business.service.IClubPostLikeService;
import com.chengyinhub.business.service.IClubPostService;
import com.chengyinhub.business.service.IClubService;
import com.chengyinhub.business.service.IViewCreativeSquareService;
import com.chengyinhub.business.service.support.ClubPostReferenceGuard;
import com.chengyinhub.common.core.domain.AjaxResult;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 审计 1122 E2:俱乐部帖子列表的点赞态一页一次批量查询,不再逐帖查库;结果与逐帖查一致。
 */
class ClubPostListLikeBatchTest {

    private static final Long CLUB_ID = 73L;
    private static final Long VIEWER = 42L;

    private IClubService clubService;
    private IClubMemberService memberService;
    private IClubPostService postService;
    private IViewCreativeSquareService squareService;
    private ClubPostReferenceGuard guard;
    private ApiClubController controller;
    private IClubPostLikeService likes;
    private Club club;

    @BeforeEach
    void setUp() {
        clubService = mock(IClubService.class);
        memberService = mock(IClubMemberService.class);
        postService = mock(IClubPostService.class);
        squareService = mock(IViewCreativeSquareService.class);
        guard = mock(ClubPostReferenceGuard.class);
        controller = spy(new ApiClubController());
        doReturn(VIEWER).when(controller).getAppUserId();
        ReflectionTestUtils.setField(controller, "clubService", clubService);
        ReflectionTestUtils.setField(controller, "clubMemberService", memberService);
        ReflectionTestUtils.setField(controller, "clubPostService", postService);
        // 帖文卡头像「+」关注:查看者对作者的关注态(批量查询,默认空 = 都没关注)
        ReflectionTestUtils.setField(controller, "umsMemberFollowMapper", org.mockito.Mockito.mock(com.chengyinhub.business.mapper.UmsMemberFollowMapper.class));
        ReflectionTestUtils.setField(controller, "viewCreativeSquareService", squareService);
        ReflectionTestUtils.setField(controller, "clubPostReferenceGuard", guard);
        likes = mock(IClubPostLikeService.class);
        ReflectionTestUtils.setField(controller, "clubPostLikeService", likes);
        ReflectionTestUtils.setField(controller, "clubPostCommentService", mock(IClubPostCommentService.class));
        club = new Club();
        club.setId(CLUB_ID);
        club.setMemberId(9L);
        when(clubService.selectClubById(CLUB_ID)).thenReturn(club);
    }

    private ClubPost post(long id, Integer refType, Long refId) {
        ClubPost post = new ClubPost();
        post.setId(id);
        post.setClubId(CLUB_ID);
        post.setRefType(refType);
        post.setRefId(refId);
        post.setDelFlag(0); // 库里的行恒有 del_flag;评论列表只对未删帖开放(MC-053)
        return post;
    }

    @Test
    void likeStateIsLoadedOnceForTheWholePage() {
        ClubPost a = post(1L, null, null);
        ClubPost b = post(2L, null, null);
        ClubPost c = post(3L, null, null);
        when(postService.selectClubPostPage(any(), any(), anyInt()))
                .thenReturn(new ArrayList<>(Arrays.asList(a, b, c)));
        when(likes.selectLikedPostIds(any(), org.mockito.ArgumentMatchers.eq(VIEWER)))
                .thenReturn(new java.util.HashSet<>(Collections.singletonList(2L)));
        ClubPost query = new ClubPost();
        query.setClubId(CLUB_ID);

        AjaxResult res = controller.postList(query);

        assertEquals(200, res.get(AjaxResult.CODE_TAG));
        assertEquals(Boolean.FALSE, a.getIsLiked());
        assertEquals(Boolean.TRUE, b.getIsLiked());
        assertEquals(Boolean.FALSE, c.getIsLiked());
        verify(likes, org.mockito.Mockito.times(1)).selectLikedPostIds(any(), any());
        verify(likes, never()).selectByPostAndMember(any(), any());
    }

    @Test
    void defaultImplementationMatchesPerPostLookup() {
        IClubPostLikeService perPost = new IClubPostLikeService() {
            public com.chengyinhub.business.domain.ClubPostLike selectByPostAndMember(Long postId, Long memberId) {
                return postId == 7L && memberId == 42L ? new com.chengyinhub.business.domain.ClubPostLike() : null;
            }
            public int insertClubPostLike(com.chengyinhub.business.domain.ClubPostLike like) { return 0; }
            public int deleteByPostAndMember(Long postId, Long memberId) { return 0; }
        };
        assertEquals(java.util.Set.of(7L), perPost.selectLikedPostIds(Arrays.asList(6L, 7L, null), 42L));
        assertTrue(perPost.selectLikedPostIds(Arrays.asList(6L, 7L), null).isEmpty());
    }

    @Test
    void productionServiceSkipsTheQueryForGuestsAndEmptyPages() {
        com.chengyinhub.business.mapper.ClubPostLikeMapper mapper = mock(com.chengyinhub.business.mapper.ClubPostLikeMapper.class);
        com.chengyinhub.business.service.impl.ClubPostLikeServiceImpl svc = new com.chengyinhub.business.service.impl.ClubPostLikeServiceImpl();
        ReflectionTestUtils.setField(svc, "clubPostLikeMapper", mapper);
        when(mapper.selectLikedPostIds(any(), org.mockito.ArgumentMatchers.eq(42L))).thenReturn(Arrays.asList(5L));

        assertTrue(svc.selectLikedPostIds(Arrays.asList(5L, 6L), null).isEmpty());
        assertTrue(svc.selectLikedPostIds(Collections.emptyList(), 42L).isEmpty());
        assertEquals(java.util.Set.of(5L), svc.selectLikedPostIds(Arrays.asList(5L, 6L, null), 42L));
        verify(mapper, org.mockito.Mockito.times(1)).selectLikedPostIds(any(), any());
    }
}
