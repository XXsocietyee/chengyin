package com.chengyinhub.framework.security;

import com.chengyinhub.common.annotation.Anonymous;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.type.filter.AnnotationTypeFilter;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;

import java.io.IOException;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 审计 1122 C3：允许匿名访问的接口必须逐个经过复核。
 *
 * <p>从编译后的控制器类上读取 {@link Anonymous} 与映射注解（与 PermitAllUrlProperties 同一来源），
 * 与 {@code security/anonymous-endpoints-reviewed.txt} 比对。新增匿名接口而未登记复核即失败；
 * 已登记但不再匿名的条目也要求删除，名单始终与代码一致。</p>
 */
class AnonymousEndpointReviewTest {

    private static final String REVIEWED = "security/anonymous-endpoints-reviewed.txt";

    static Set<String> anonymousEndpoints() throws ClassNotFoundException {
        return anonymousEndpoints(false);
    }

    static Set<String> anonymousEndpoints(boolean includeTestClasses) throws ClassNotFoundException {
        ClassPathScanningCandidateComponentProvider scanner = new ClassPathScanningCandidateComponentProvider(false);
        scanner.addIncludeFilter(new AnnotationTypeFilter(Controller.class));
        Set<String> result = new TreeSet<>();
        for (BeanDefinition bd : scanner.findCandidateComponents("com.chengyinhub")) {
            Class<?> type = Class.forName(bd.getBeanClassName());
            if (!includeTestClasses && fromTestClasses(type)) continue;
            boolean classAnonymous = AnnotatedElementUtils.hasAnnotation(type, Anonymous.class);
            RequestMapping typeMapping = AnnotatedElementUtils.findMergedAnnotation(type, RequestMapping.class);
            List<String> prefixes = typeMapping == null || typeMapping.path().length == 0
                    ? List.of("") : Arrays.asList(typeMapping.path());
            for (Method m : type.getMethods()) {
                RequestMapping mapping = AnnotatedElementUtils.findMergedAnnotation(m, RequestMapping.class);
                if (mapping == null) continue;
                if (!classAnonymous && !AnnotatedElementUtils.hasAnnotation(m, Anonymous.class)) continue;
                List<String> paths = mapping.path().length == 0 ? List.of("") : Arrays.asList(mapping.path());
                String verbs = mapping.method().length == 0 ? "ANY"
                        : Arrays.stream(mapping.method()).map(Enum::name).sorted().collect(Collectors.joining(","));
                for (String prefix : prefixes) {
                    for (String path : paths) {
                        result.add(verbs + " " + normalise(prefix, path) + "  " + type.getSimpleName() + "#" + m.getName());
                    }
                }
            }
        }
        return result;
    }

    private static boolean fromTestClasses(Class<?> type) {
        java.security.CodeSource src = type.getProtectionDomain().getCodeSource();
        return src != null && src.getLocation() != null && src.getLocation().toString().contains("test-classes");
    }

    private static String normalise(String prefix, String path) {
        String joined = ("/" + prefix + "/" + path).replaceAll("/+", "/");
        if (joined.length() > 1 && joined.endsWith("/")) joined = joined.substring(0, joined.length() - 1);
        return joined.replaceAll("\\{[^}]*}", "*");
    }

    static Set<String> reviewed() throws IOException {
        String text = new String(new ClassPathResource(REVIEWED).getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        Set<String> out = new TreeSet<>();
        for (String line : text.split("\n")) {
            String t = line.strip();
            if (t.isEmpty() || t.startsWith("#")) continue;
            int note = t.indexOf(" | ");
            out.add(note < 0 ? t : t.substring(0, note).strip());
        }
        return out;
    }

    @Test
    void everyAnonymousEndpointIsOnTheReviewedList() throws Exception {
        Set<String> actual = anonymousEndpoints();
        assertTrue(actual.size() > 0, "扫描不到任何匿名接口，扫描本身可能失效");
        Set<String> listed = reviewed();
        List<String> unreviewed = new ArrayList<>(actual);
        unreviewed.removeAll(listed);
        List<String> stale = new ArrayList<>(listed);
        stale.removeAll(actual);
        assertEquals(List.of(), unreviewed, "新的匿名接口必须先复核，再登记到 " + REVIEWED);
        assertEquals(List.of(), stale, "名单里有已不再匿名的接口，请从 " + REVIEWED + " 删除");
    }

    @Anonymous
    @org.springframework.web.bind.annotation.RestController
    @RequestMapping("/probe")
    static class ProbeController {
        @org.springframework.web.bind.annotation.GetMapping("/{id}/x")
        public void open() { }
    }

    @Test
    void probeFromTestClassesIsNotPartOfTheProductionList() throws Exception {
        assertTrue(anonymousEndpoints().stream().noneMatch(e -> e.contains("ProbeController")));
    }

    @Test
    void negativeControlDetectsAnUnlistedAnonymousEndpoint() throws Exception {
        assertTrue(anonymousEndpoints(true).contains("GET /probe/*/x  ProbeController#open"),
                "扫描必须能识别类级 @Anonymous 与路径变量");
    }
}
