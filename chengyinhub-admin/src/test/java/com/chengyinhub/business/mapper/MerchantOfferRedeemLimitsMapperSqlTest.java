package com.chengyinhub.business.mapper;

import com.chengyinhub.business.domain.MerchantChapterOffer;
import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.io.Resources;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 每日名额闸的 SQL(解析真 XML):判定读必须是对单行供给的 FOR UPDATE 当前读 —— 这是并发不超额的那把锁;
 * 计数按「日期是不是今天」读写;计数列不进核销扣配额、供给求和与通用列清单。
 */
class MerchantOfferRedeemLimitsMapperSqlTest {
    private static final String OFFER = "mapper/business/MerchantChapterOfferMapper.xml";
    private static final String NS = "com.chengyinhub.business.mapper.MerchantChapterOfferMapper.";
    private Configuration cfg;

    @BeforeEach
    void parse() throws Exception {
        cfg = new Configuration();
        cfg.getTypeAliasRegistry().registerAlias("MerchantChapterOffer", MerchantChapterOffer.class);
        try (InputStream in = Resources.getResourceAsStream(OFFER)) {
            new XMLMapperBuilder(in, cfg, OFFER, cfg.getSqlFragments()).parse();
        }
    }

    private String sql(String statement) {
        Map<String, Object> p = new HashMap<>();
        p.put("id", 1L); p.put("today", "2026-11-23"); p.put("chapterId", 6L);
        p.put("offerIds", List.of(1L, 2L)); p.put("chapterIds", List.of(6L));
        return cfg.getMappedStatement(NS + statement).getBoundSql(p).getSql().replaceAll("\\s+", " ").trim().toLowerCase();
    }

    @Test
    void limitsAreReadWithARowLockOnTheSingleOffer() {
        String s = sql("selectRedeemLimitsForUpdate");
        assertTrue(s.endsWith("where id = ? for update"), s);
        assertTrue(s.contains("daily_capacity as dailycapacity") && s.contains("as validstart"), s);
        assertTrue(s.contains("case when daily_used_date = ? then daily_used else 0 end as usedtoday"), s);
    }

    @Test
    void countingResetsOnANewDayAndReleaseNeverGoesNegative() {
        String add = sql("addDailyUsed");
        assertTrue(add.contains("daily_used = case when daily_used_date = ? then daily_used + 1 else 1 end"), add);
        assertTrue(add.contains("daily_used_date = ?") && add.endsWith("where id = ?"), add);
        String release = sql("releaseDailyUsed");
        assertTrue(release.contains("set daily_used = daily_used - 1"), release);
        assertTrue(release.endsWith("where id = ? and daily_used_date = ? and daily_used > 0"), release);
    }

    @Test
    void playerSideReadIsPlainAndScopedToToday() {
        String s = sql("selectDailyUsedByOfferIds");
        assertTrue(s.contains("where daily_used_date = ? and id in ( ? , ? )"), s);
        assertFalse(s.contains("for update") || s.contains("for share"), s);
    }

    @Test
    void counterColumnsStayOutOfQuotaAndGenericReads() {
        for (String statement : List.of("selectById", "selectByIdForUpdate", "selectByChapter", "selectByTopic",
                "selectLiveByChapterIds", "selectLiveDisplayByChapterIds", "sumRemainingQuotaByChapter",
                "sumRemainingQuotaByChapterForUpdate", "consumeQuota", "releaseQuota")) {
            assertFalse(sql(statement).contains("daily_used"), statement + " 不得读 daily_used");
        }
    }
}
