package com.chengyinhub.business.support;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * 章节位置可承接的一级商家品类清单(cms_topic_chapter.allowed_category_ids)。
 *
 * <p>存储是逗号分隔的品类 id；{@code category_id} 始终是第一项。列为空 = 只认 {@code category_id}
 * (存量行的回填口径)。申请校验、可见性过滤、邀请候选与入驻校验都读这里，不各写一套。
 */
public final class ChapterAllowedCategories {

    /** 一个位置最多列几个品类。 */
    public static final int MAX = 8;

    private ChapterAllowedCategories() {
    }

    /** 生效清单：主品类在前，其余按存储顺序去重；主品类为空时清单为空。坏片段在读侧忽略。 */
    public static List<Integer> effective(Integer primaryCategoryId, String allowedCategoryIds) {
        Set<Integer> out = new LinkedHashSet<>();
        if (primaryCategoryId == null || primaryCategoryId <= 0) {
            return new ArrayList<>(out);
        }
        out.add(primaryCategoryId);
        if (allowedCategoryIds != null) {
            for (String part : allowedCategoryIds.split(",")) {
                Integer id = parseOrNull(part);
                if (id != null) out.add(id);
            }
        }
        return new ArrayList<>(out);
    }

    public static boolean matches(Integer merchantCategoryId, Integer primaryCategoryId, String allowedCategoryIds) {
        return merchantCategoryId != null
                && effective(primaryCategoryId, allowedCategoryIds).contains(merchantCategoryId);
    }

    /**
     * 写侧归一：主品类排第一、去重；只有主品类时落 null。片段不是正整数或超过 {@link #MAX} 个即拒。
     */
    public static String normalize(Integer primaryCategoryId, String allowedCategoryIds) {
        if (allowedCategoryIds == null || allowedCategoryIds.trim().isEmpty()) {
            return null;
        }
        if (primaryCategoryId == null || primaryCategoryId <= 0) {
            throw new IllegalStateException("开放商家承接的章节必须选择适合商家品类");
        }
        Set<Integer> out = new LinkedHashSet<>();
        out.add(primaryCategoryId);
        for (String part : allowedCategoryIds.split(",")) {
            if (part.trim().isEmpty()) continue;
            Integer id = parseOrNull(part);
            if (id == null) {
                throw new IllegalStateException("适合商家品类不合法");
            }
            out.add(id);
        }
        if (out.size() > MAX) {
            throw new IllegalStateException("一个位置最多选择" + MAX + "个商家品类");
        }
        if (out.size() == 1) {
            return null;
        }
        StringBuilder csv = new StringBuilder();
        for (Integer id : out) {
            if (csv.length() > 0) csv.append(',');
            csv.append(id);
        }
        return csv.toString();
    }

    private static Integer parseOrNull(String raw) {
        if (raw == null) return null;
        String text = raw.trim();
        if (text.isEmpty() || text.length() > 9) return null;
        for (int i = 0; i < text.length(); i++) {
            if (!Character.isDigit(text.charAt(i))) return null;
        }
        int id = Integer.parseInt(text);
        return id > 0 ? id : null;
    }
}
