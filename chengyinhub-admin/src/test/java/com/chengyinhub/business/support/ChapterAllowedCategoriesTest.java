package com.chengyinhub.business.support;

import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** P0-2:位置可承接品类清单的读写口径。 */
class ChapterAllowedCategoriesTest {

    @Test
    void nullOrBlankListMeansSingleCategory() {
        assertEquals(Collections.singletonList(18), ChapterAllowedCategories.effective(18, null));
        assertEquals(Collections.singletonList(18), ChapterAllowedCategories.effective(18, "  "));
        assertTrue(ChapterAllowedCategories.matches(18, 18, null));
        assertFalse(ChapterAllowedCategories.matches(21, 18, null));
    }

    @Test
    void primaryCategoryAlwaysComesFirstAndIsNotDuplicated() {
        assertEquals(Arrays.asList(18, 21, 22), ChapterAllowedCategories.effective(18, "21,18,22,21"));
        assertTrue(ChapterAllowedCategories.matches(22, 18, "21,22"));
        assertFalse(ChapterAllowedCategories.matches(23, 18, "21,22"));
        assertFalse(ChapterAllowedCategories.matches(null, 18, "21,22"));
    }

    @Test
    void chapterWithoutPrimaryCategoryMatchesNothing() {
        assertTrue(ChapterAllowedCategories.effective(null, "21,22").isEmpty());
        assertFalse(ChapterAllowedCategories.matches(21, null, "21,22"));
    }

    @Test
    void readSideIgnoresBrokenFragments() {
        assertEquals(Arrays.asList(18, 21), ChapterAllowedCategories.effective(18, "x, 21 ,-3,0,,1e3"));
    }

    @Test
    void normalizePutsPrimaryFirstAndStoresNullForSingleCategory() {
        assertEquals("18,21,22", ChapterAllowedCategories.normalize(18, "21, 22,18"));
        assertNull(ChapterAllowedCategories.normalize(18, "18"));
        assertNull(ChapterAllowedCategories.normalize(18, ""));
        assertNull(ChapterAllowedCategories.normalize(null, null));
    }

    @Test
    void normalizeRejectsInvalidInput() {
        assertThrows(IllegalStateException.class, () -> ChapterAllowedCategories.normalize(18, "21,abc"));
        assertThrows(IllegalStateException.class, () -> ChapterAllowedCategories.normalize(18, "21,-1"));
        assertThrows(IllegalStateException.class, () -> ChapterAllowedCategories.normalize(null, "21"));
        assertThrows(IllegalStateException.class,
                () -> ChapterAllowedCategories.normalize(1, "2,3,4,5,6,7,8,9"));
        assertEquals("1,2,3,4,5,6,7,8", ChapterAllowedCategories.normalize(1, "2,3,4,5,6,7,8"));
    }
}
