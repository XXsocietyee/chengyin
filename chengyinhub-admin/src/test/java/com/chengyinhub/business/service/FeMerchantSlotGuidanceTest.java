package com.chengyinhub.business.service;

import com.chengyinhub.business.domain.CmsTopic;
import com.chengyinhub.business.domain.CmsTopicChapter;
import com.chengyinhub.business.domain.CmsTopicChapterTemplateMeta;
import com.chengyinhub.business.domain.dto.ChapterDTO;
import com.chengyinhub.business.mapper.CmsMemberTemplateMapper;
import com.chengyinhub.business.mapper.CmsTopicChapterMapper;
import com.chengyinhub.business.mapper.CmsTopicMapper;
import com.chengyinhub.business.mapper.CmsTopicNodeMapper;
import com.chengyinhub.business.mapper.CmsTopicTemplateMetaMapper;
import com.chengyinhub.business.mapper.MerchantChapterApplicationMapper;
import com.chengyinhub.business.mapper.MerchantChapterOfferMapper;
import com.chengyinhub.business.service.impl.CmsTopicChapterServiceImpl;
import com.chengyinhub.business.service.impl.TopicContentCopyServiceImpl;
import com.chengyinhub.business.service.impl.TopicContentGraphAuthoringServiceImpl;
import com.chengyinhub.business.service.support.CommercialTopicPolicy;
import com.chengyinhub.business.service.support.TopicContentWriteGuard;
import com.chengyinhub.common.constant.ProductType;
import com.chengyinhub.system.domain.SysCategory;
import com.chengyinhub.system.service.ISysCategoryService;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

/**
 * 自由探索商家参与(审计 FE-MERCHANT-GAPS-1122):
 * P0-1 位置说明随复制与章节重建保留;P0-2 可承接品类清单的写入校验与复制;
 * P1-6 主办方逐章开关走招商配置校验;P1-11 复制带上组队设置。
 */
class FeMerchantSlotGuidanceTest {

    private static final Long SOURCE_TOPIC = 9915201L;
    private static final Long NEW_TOPIC = 700L;
    private static final Long OWNER = 1001L;

    // ---------- P1-11 / P0-1 / P0-2:复制 ----------

    @Test
    void copyKeepsTeamModeAndTeamSize() {
        CmsTopic original = new CmsTopic();
        original.setId(SOURCE_TOPIC);
        original.setProductType(ProductType.FREE_EXPLORE);
        original.setTeamMode(2);
        original.setTeamMaxMembers(6);

        CmsTopic copied = ReflectionTestUtils.invokeMethod(new TopicContentCopyServiceImpl(),
                "copyTopicBasicInfo", original, null, null);

        assertEquals(Integer.valueOf(2), copied.getTeamMode());
        assertEquals(Integer.valueOf(6), copied.getTeamMaxMembers());
    }

    @Test
    void copyCarriesRoleNeedToTheMappedNewChaptersOnly() {
        TopicContentCopyServiceImpl copy = new TopicContentCopyServiceImpl();
        CmsTopicTemplateMetaMapper metaMapper = mock(CmsTopicTemplateMetaMapper.class);
        ReflectionTestUtils.setField(copy, "cmsTopicTemplateMetaMapper", metaMapper);
        when(metaMapper.selectChapterMetaByTopicId(SOURCE_TOPIC)).thenReturn(Arrays.asList(
                meta(11L, "坐坐逛逛｜参考示例 · 适合店铺：书店咖啡、甜品咖啡。"),
                meta(12L, "  "),
                meta(99L, "不在本次复制里的章节")));
        Map<Long, Long> chapterIds = new HashMap<>();
        chapterIds.put(11L, 911L);
        chapterIds.put(12L, 912L);

        ReflectionTestUtils.invokeMethod(copy, "copyChapterRoleNeed", SOURCE_TOPIC, NEW_TOPIC, chapterIds);

        verify(metaMapper).upsertChapterRoleNeed(911L, NEW_TOPIC, "坐坐逛逛｜参考示例 · 适合店铺：书店咖啡、甜品咖啡。");
        verify(metaMapper, never()).upsertChapterRoleNeed(any(), any(), org.mockito.ArgumentMatchers.eq("  "));
        verify(metaMapper, never()).upsertChapterRoleNeed(org.mockito.ArgumentMatchers.eq(99L), any(), any());
    }

    @Test
    void copyCarriesAllowedCategoryListWithPrimaryFirst() {
        TopicContentCopyServiceImpl copy = new TopicContentCopyServiceImpl();
        CmsTopicMapper topicMapper = mock(CmsTopicMapper.class);
        CmsTopicChapterMapper chapterMapper = mock(CmsTopicChapterMapper.class);
        CmsTopicNodeMapper nodeMapper = mock(CmsTopicNodeMapper.class);
        ISysCategoryService categories = mock(ISysCategoryService.class);
        CmsTopicTemplateMetaMapper metaMapper = mock(CmsTopicTemplateMetaMapper.class);
        ReflectionTestUtils.setField(copy, "cmsTopicMapper", topicMapper);
        ReflectionTestUtils.setField(copy, "cmsTopicChapterMapper", chapterMapper);
        ReflectionTestUtils.setField(copy, "cmsTopicNodeMapper", nodeMapper);
        ReflectionTestUtils.setField(copy, "sysCategoryService", categories);
        ReflectionTestUtils.setField(copy, "cmsTopicTemplateMetaMapper", metaMapper);
        when(categories.selectSysCategoryById(18L)).thenReturn(category(18L));
        when(topicMapper.updateCmsTopic(any())).thenReturn(1);

        CmsTopicChapter multi = chapter(11L, 18);
        CmsTopicChapter single = chapter(12L, 18);
        when(chapterMapper.selectCmsTopicChapterList(any())).thenReturn(Arrays.asList(multi, single));
        CmsTopicChapter storedMulti = new CmsTopicChapter();
        storedMulti.setId(11L);
        storedMulti.setAllowedCategoryIds("21,18");
        CmsTopicChapter storedSingle = new CmsTopicChapter();
        storedSingle.setId(12L);
        when(chapterMapper.selectAllowedCategoriesByTopicId(SOURCE_TOPIC))
                .thenReturn(Arrays.asList(storedMulti, storedSingle));
        long[] nextId = {910L};
        doAnswer(invocation -> {
            ((CmsTopicChapter) invocation.getArgument(0)).setId(++nextId[0]);
            return 1;
        }).when(chapterMapper).insertCmsTopicChapter(any(CmsTopicChapter.class));
        when(metaMapper.selectChapterMetaByTopicId(SOURCE_TOPIC))
                .thenReturn(Collections.singletonList(meta(11L, "最低交付要求：写清杯型。")));

        CmsTopic newTopic = new CmsTopic();
        newTopic.setId(NEW_TOPIC);
        newTopic.setProductType(ProductType.FREE_EXPLORE);
        ReflectionTestUtils.invokeMethod(copy, "copyChaptersAndNodes",
                SOURCE_TOPIC, newTopic, new HashMap<Long, Long>(), null, false);

        ArgumentCaptor<CmsTopicChapter> inserted = ArgumentCaptor.forClass(CmsTopicChapter.class);
        verify(chapterMapper, org.mockito.Mockito.times(2)).insertCmsTopicChapter(inserted.capture());
        List<CmsTopicChapter> rows = inserted.getAllValues();
        assertEquals("18,21", rows.get(0).getAllowedCategoryIds(), "主品类排第一");
        assertEquals(Integer.valueOf(18), rows.get(0).getCategoryId());
        assertNull(rows.get(1).getAllowedCategoryIds(), "单品类位置不落清单");
        verify(metaMapper).upsertChapterRoleNeed(911L, NEW_TOPIC, "最低交付要求：写清杯型。");
    }

    // ---------- P0-1:编辑器整体重建章节后元数据改挂 ----------

    @Test
    void chapterRebuildRekeysMetaWithinTheSameTopicOnly() {
        TopicContentGraphAuthoringServiceImpl graph = new TopicContentGraphAuthoringServiceImpl();
        CmsTopicTemplateMetaMapper metaMapper = mock(CmsTopicTemplateMetaMapper.class);
        ReflectionTestUtils.setField(graph, "chapterTemplateMetaMapper", metaMapper);

        ReflectionTestUtils.invokeMethod(graph, "rekeyChapterMeta", NEW_TOPIC, 911L, 1911L);
        ReflectionTestUtils.invokeMethod(graph, "rekeyChapterMeta", NEW_TOPIC, null, 1912L);
        ReflectionTestUtils.invokeMethod(graph, "rekeyChapterMeta", NEW_TOPIC, 0L, 1913L);
        ReflectionTestUtils.invokeMethod(graph, "rekeyChapterMeta", NEW_TOPIC, 1914L, 1914L);

        verify(metaMapper).rekeyChapterMeta(NEW_TOPIC, 911L, 1911L);
        verifyNoMoreInteractions(metaMapper);
    }

    // ---------- P0-2:保存时校验并归一品类清单 ----------

    @Test
    void savingNormalizesAllowedListAndValidatesEveryCategory() {
        ISysCategoryService categories = mock(ISysCategoryService.class);
        when(categories.selectSysCategoryById(18L)).thenReturn(category(18L));
        when(categories.selectSysCategoryById(21L)).thenReturn(category(21L));
        SysCategory child = category(22L);
        child.setParentId(18L);
        when(categories.selectSysCategoryById(22L)).thenReturn(child);
        CmsTopicMapper topicMapper = mock(CmsTopicMapper.class);
        TopicContentWriteGuard guard = new TopicContentWriteGuard(topicMapper, mock(CmsTopicChapterMapper.class),
                mock(CmsMemberTemplateMapper.class), mock(IProductRoleService.class), categories);

        ChapterDTO ok = new ChapterDTO();
        ok.setRecruitEnabled(1);
        ok.setCategoryId(18);
        ok.setAllowedCategoryIds("21,18");
        guard.assertChapterShapeForTopic(ok, NEW_TOPIC);
        assertEquals("18,21", ok.getAllowedCategoryIds());

        ChapterDTO onlyPrimary = new ChapterDTO();
        onlyPrimary.setRecruitEnabled(1);
        onlyPrimary.setCategoryId(18);
        onlyPrimary.setAllowedCategoryIds("18");
        guard.assertChapterShapeForTopic(onlyPrimary, NEW_TOPIC);
        assertNull(onlyPrimary.getAllowedCategoryIds());

        ChapterDTO secondLevel = new ChapterDTO();
        secondLevel.setRecruitEnabled(1);
        secondLevel.setCategoryId(18);
        secondLevel.setAllowedCategoryIds("18,22");
        assertEquals("适合商家品类不存在或已停用", assertThrows(IllegalStateException.class,
                () -> guard.assertChapterShapeForTopic(secondLevel, NEW_TOPIC)).getMessage());

        ChapterDTO garbage = new ChapterDTO();
        garbage.setRecruitEnabled(1);
        garbage.setCategoryId(18);
        garbage.setAllowedCategoryIds("18,abc");
        assertThrows(IllegalStateException.class, () -> guard.assertChapterShapeForTopic(garbage, NEW_TOPIC));

        ChapterDTO noPrimary = new ChapterDTO();
        noPrimary.setAllowedCategoryIds("21");
        guard.assertChapterShapeForTopic(noPrimary, NEW_TOPIC);
        assertNull(noPrimary.getAllowedCategoryIds(), "没有主品类的章节不留清单");
    }

    // ---------- 编辑器回读 ----------

    @Test
    void editorReadbackAttachesRoleNeedAndEffectiveCategoryList() {
        CmsTopicChapterServiceImpl service = new CmsTopicChapterServiceImpl();
        CmsTopicChapterMapper chapterMapper = mock(CmsTopicChapterMapper.class);
        CmsTopicTemplateMetaMapper metaMapper = mock(CmsTopicTemplateMetaMapper.class);
        ReflectionTestUtils.setField(service, "cmsTopicChapterMapper", chapterMapper);
        ReflectionTestUtils.setField(service, "cmsTopicTemplateMetaMapper", metaMapper);
        CmsTopicChapter stored = new CmsTopicChapter();
        stored.setId(911L);
        stored.setAllowedCategoryIds("18,21");
        when(chapterMapper.selectAllowedCategoriesByTopicId(NEW_TOPIC)).thenReturn(Collections.singletonList(stored));
        when(metaMapper.selectChapterMetaByTopicId(NEW_TOPIC))
                .thenReturn(Collections.singletonList(meta(911L, "最低交付要求：写清杯型。")));
        CmsTopicChapter multi = chapter(911L, 18);
        CmsTopicChapter single = chapter(912L, 30);
        CmsTopicChapter unconfigured = chapter(913L, null);

        service.attachRecruitmentGuidance(NEW_TOPIC, Arrays.asList(multi, single, unconfigured));

        assertEquals("最低交付要求：写清杯型。", multi.getRoleNeed());
        assertEquals("18,21", multi.getAllowedCategoryIds());
        assertNull(single.getRoleNeed());
        assertEquals("30", single.getAllowedCategoryIds(), "存量行:清单 = 单品类");
        assertNull(unconfigured.getAllowedCategoryIds());
    }

    // ---------- P1-6:主办方逐章开关 ----------

    @Test
    void ownerCannotCloseSlotThatAlreadyHasApplicationsOrSupply() {
        ToggleFixture f = new ToggleFixture();
        f.current.setRecruitEnabled(1);
        when(f.applicationMapper.countCurrentByChapter(f.current.getId())).thenReturn(1);
        when(f.offerMapper.countAllByChapter(f.current.getId())).thenReturn(1);

        IllegalStateException error = assertThrows(IllegalStateException.class,
                () -> f.service.setChapterRecruitAsOwner(f.current.getId(), OWNER, 0));

        assertTrue(error.getMessage().contains("不能关闭商家承接"));
        verify(f.chapterMapper, never()).setRecruitEnabledIfOwned(anyLong(), anyLong(), any());
    }

    @Test
    void ownerCanCloseSlotWithoutRelations() {
        ToggleFixture f = new ToggleFixture();
        f.current.setRecruitEnabled(1);
        when(f.chapterMapper.setRecruitEnabledIfOwned(f.current.getId(), OWNER, 0)).thenReturn(1);

        assertEquals(1, f.service.setChapterRecruitAsOwner(f.current.getId(), OWNER, 0));
        verify(f.topicMapper).selectCmsTopicByIdForUpdate(NEW_TOPIC);
    }

    @Test
    void ownerCannotOpenSlotOnNonFreeExploreTopic() {
        ToggleFixture f = new ToggleFixture();
        f.topic.setProductType(ProductType.ORIENTEERING);

        assertEquals("仅自由探索主题可开启章节商家承接", assertThrows(IllegalStateException.class,
                () -> f.service.setChapterRecruitAsOwner(f.current.getId(), OWNER, 1)).getMessage());
        verify(f.chapterMapper, never()).setRecruitEnabledIfOwned(anyLong(), anyLong(), any());
    }

    @Test
    void ownerCannotOpenSlotWithoutCategoryOrWithUnsupportedTerms() {
        ToggleFixture f = new ToggleFixture();
        f.current.setCategoryId(null);
        assertEquals("开放商家承接的章节必须选择适合商家品类", assertThrows(IllegalStateException.class,
                () -> f.service.setChapterRecruitAsOwner(f.current.getId(), OWNER, 1)).getMessage());

        f.current.setCategoryId(18);
        f.current.setTermsMode("REVSHARE");
        assertThrows(IllegalStateException.class,
                () -> f.service.setChapterRecruitAsOwner(f.current.getId(), OWNER, 1));

        f.current.setTermsMode("PERK");
        f.current.setMaxMerchant(200);
        assertThrows(IllegalStateException.class,
                () -> f.service.setChapterRecruitAsOwner(f.current.getId(), OWNER, 1));
        verify(f.chapterMapper, never()).setRecruitEnabledIfOwned(anyLong(), anyLong(), any());
    }

    @Test
    void ownerOpensValidSlot_andNonOwnerIsLeftToOwnerScopedSql() {
        ToggleFixture f = new ToggleFixture();
        when(f.chapterMapper.setRecruitEnabledIfOwned(f.current.getId(), OWNER, 1)).thenReturn(1);
        assertEquals(1, f.service.setChapterRecruitAsOwner(f.current.getId(), OWNER, 1));

        // 非归属人:不做校验也不报主题状态,由带 owner 谓词的 SQL 返回 0
        f.current.setCategoryId(null);
        when(f.chapterMapper.setRecruitEnabledIfOwned(f.current.getId(), 777L, 1)).thenReturn(0);
        assertEquals(0, f.service.setChapterRecruitAsOwner(f.current.getId(), 777L, 1));
    }

    private static final class ToggleFixture {
        final CmsTopicChapterMapper chapterMapper = mock(CmsTopicChapterMapper.class);
        final CmsTopicMapper topicMapper = mock(CmsTopicMapper.class);
        final MerchantChapterApplicationMapper applicationMapper = mock(MerchantChapterApplicationMapper.class);
        final MerchantChapterOfferMapper offerMapper = mock(MerchantChapterOfferMapper.class);
        final CmsTopicChapterServiceImpl service = new CmsTopicChapterServiceImpl();
        final CmsTopic topic = new CmsTopic();
        final CmsTopicChapter current = new CmsTopicChapter();

        ToggleFixture() {
            ISysCategoryService categories = mock(ISysCategoryService.class);
            when(categories.selectSysCategoryById(18L)).thenReturn(category(18L));
            ReflectionTestUtils.setField(service, "cmsTopicChapterMapper", chapterMapper);
            ReflectionTestUtils.setField(service, "cmsTopicMapper", topicMapper);
            ReflectionTestUtils.setField(service, "merchantChapterApplicationMapper", applicationMapper);
            ReflectionTestUtils.setField(service, "merchantChapterOfferMapper", offerMapper);
            ReflectionTestUtils.setField(service, "sysCategoryService", categories);
            ReflectionTestUtils.setField(service, "productRoleService", mock(IProductRoleService.class));
            ReflectionTestUtils.setField(service, "commercialTopicPolicy", mock(CommercialTopicPolicy.class));
            topic.setId(NEW_TOPIC);
            topic.setMemberId(OWNER);
            topic.setProductType(ProductType.FREE_EXPLORE);
            topic.setDelFlag(0);
            current.setId(33L);
            current.setTopicId(NEW_TOPIC);
            current.setRecruitEnabled(0);
            current.setCategoryId(18);
            current.setTermsMode("PERK");
            current.setMaxMerchant(1);
            when(chapterMapper.selectCmsTopicChapterById(33L)).thenReturn(current);
            when(topicMapper.selectCmsTopicById(NEW_TOPIC)).thenReturn(topic);
            when(topicMapper.selectCmsTopicByIdForUpdate(NEW_TOPIC)).thenReturn(topic);
        }
    }

    private static CmsTopicChapterTemplateMeta meta(Long chapterId, String roleNeed) {
        CmsTopicChapterTemplateMeta meta = new CmsTopicChapterTemplateMeta();
        meta.setChapterId(chapterId);
        meta.setRoleNeed(roleNeed);
        return meta;
    }

    private static CmsTopicChapter chapter(Long id, Integer categoryId) {
        CmsTopicChapter chapter = new CmsTopicChapter();
        chapter.setId(id);
        chapter.setName("位置" + id);
        chapter.setCategoryId(categoryId);
        chapter.setRecruitEnabled(1);
        chapter.setTermsMode("PERK");
        chapter.setMaxMerchant(1);
        return chapter;
    }

    private static SysCategory category(Long id) {
        SysCategory category = new SysCategory();
        category.setId(id);
        category.setType(6L);
        category.setParentId(0L);
        category.setStatus(1);
        category.setDelFlag(0);
        return category;
    }
}
