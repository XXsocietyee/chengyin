package com.chengyinhub.business.mapper;

import com.chengyinhub.business.domain.MerchantChapterOffer;
import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.io.Resources;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * P1-7 的 SQL 归属与隔离(解析真 XML):写语句的 where 带归属与 status=1;
 * sale_paused / removed_by 只出现在专用语句里,不进核销、供给求和与通用列清单。
 */
class MerchantOfferOwnerControlsMapperSqlTest {
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

    private String sql(String statement, Object param) {
        return cfg.getMappedStatement(NS + statement).getBoundSql(param).getSql()
                .replaceAll("\\s+", " ").toLowerCase();
    }

    private Map<String, Object> params() {
        Map<String, Object> p = new HashMap<>();
        p.put("id", 1L); p.put("merchantId", 2L); p.put("topicId", 3L); p.put("operatorId", 4L);
        p.put("quotaTotal", 5); p.put("paused", 1); p.put("reason", "r"); p.put("required", true);
        p.put("chapterId", 6L);
        return p;
    }

    @Test
    void ownQuotaIsOwnerScopedLiveOnlyAndGuardedAgainstUsed() {
        String s = sql("updateOwnQuota", params());
        assertTrue(s.contains("set quota_total = ?"), s);
        assertTrue(s.contains("where id = ? and merchant_id = ? and status = 1"), s);
        assertTrue(s.contains("quota_used <= ?"), s);
        assertFalse(s.contains("quota_used ="), "名额调整不改已用份数: " + s);
    }

    @Test
    void ownSalePausedIsOwnerScopedLiveOnlyAndTouchesNothingElse() {
        String s = sql("updateOwnSalePaused", params());
        assertTrue(s.contains("set sale_paused = ?"), s);
        assertTrue(s.contains("where id = ? and merchant_id = ? and status = 1"), s);
        assertFalse(s.contains("status = 0") || s.contains("quota_"), s);
    }

    @Test
    void organizerRemovalIsTopicScopedLiveOnlyAndRecordsReasonAndOperator() {
        String s = sql("removeByOrganizer", params());
        assertTrue(s.contains("status = 0") && s.contains("withdraw_reason = ?")
                && s.contains("withdraw_required = ?") && s.contains("removed_by = ?"), s);
        assertTrue(s.contains("where id = ? and topic_id = ? and status = 1"), s);
        assertFalse(s.contains("quota_"), "移除不改条款与已用份数: " + s);
    }

    @Test
    void merchantWithdrawalStatementIsUnchanged() {
        String s = sql("withdrawOwned", params());
        assertTrue(s.contains("where id = ? and merchant_id = ? and status = 1"), s);
        assertFalse(s.contains("removed_by") || s.contains("sale_paused"), s);
    }

    @Test
    void pausedSumsCountOnlyLivePausedOffersAndOnlyThePurchaseVariantLocks() {
        String plain = sql("sumPausedRemainingQuotaByChapter", 6L);
        String current = sql("sumPausedRemainingQuotaByChapterForUpdate", 6L);
        for (String s : new String[]{plain, current}) {
            assertTrue(s.contains("sum(quota_total - quota_used)"), s);
            assertTrue(s.contains("status = 1") && s.contains("valid_end is null") && s.contains("valid_end >"), s);
            assertTrue(s.contains("sale_paused = 1"), s);
        }
        assertFalse(plain.contains("for share") || plain.contains("for update"), plain);
        assertTrue(current.endsWith("for share"), current);
    }

    @Test
    void redemptionSupplyAndGenericReadsNeverReferenceTheNewColumns() {
        String[] untouched = {
                sql("consumeQuota", 1L), sql("releaseQuota", 1L),
                sql("sumRemainingQuotaByChapter", 6L), sql("sumRemainingQuotaByChapterForUpdate", 6L),
                sql("selectById", 1L), sql("selectByIdForUpdate", 1L), sql("selectByChapter", 6L),
                sql("selectByTopic", 3L)
        };
        for (String s : untouched) {
            assertFalse(s.contains("sale_paused") || s.contains("removed_by"), s);
        }
    }

    @Test
    void pausedIdsForTheMineListAreOwnerScoped() {
        String s = sql("selectSalePausedIdsByMerchant", params());
        assertTrue(s.contains("where merchant_id = ? and status = 1 and sale_paused = 1"), s);
    }
}
