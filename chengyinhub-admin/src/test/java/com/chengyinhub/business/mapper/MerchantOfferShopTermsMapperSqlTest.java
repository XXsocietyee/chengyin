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
 * P1-2 / P1-9 / 门店照片的 SQL 归属与隔离(解析真 XML):门店条款的读写 where 带本商家归属与 status=1;
 * 新列只出现在展示专用语句与核销的每日名额闸(selectRedeemLimitsForUpdate,见 MerchantOfferRedeemLimitsMapperSqlTest)里,
 * 不进扣配额、供给求和与通用列清单;退出状态查询只用存量列。
 */
class MerchantOfferShopTermsMapperSqlTest {
    private static final String OFFER = "mapper/business/MerchantChapterOfferMapper.xml";
    private static final String NS = "com.chengyinhub.business.mapper.MerchantChapterOfferMapper.";
    private static final List<String> NEW_COLUMNS = List.of(
            "daily_capacity", "valid_start", "sold_out_rule_text", "storefront_img", "terms_agreed_at");
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
        p.put("id", 1L); p.put("merchantId", 2L); p.put("chapterId", 6L);
        p.put("chapterIds", List.of(6L, 7L));
        return p;
    }

    @Test
    void shopTermsWriteIsOwnerScopedAndLiveOnly() {
        MerchantChapterOffer patch = new MerchantChapterOffer();
        patch.setId(1L);
        patch.setMerchantId(2L);
        String s = sql("updateShopTerms", patch);
        assertTrue(s.contains("daily_capacity = ?") && s.contains("valid_start = ?")
                && s.contains("sold_out_rule_text = ?") && s.contains("storefront_img = ?"), s);
        assertTrue(s.contains("where id = ? and merchant_id = ? and status = 1"), s);
        assertFalse(s.contains("quota") || s.contains("terms_agreed_at") || s.contains("sale_paused"), s);
    }

    @Test
    void displayTermsReadBackIsOwnerScopedAndLiveOnly() {
        String s = sql("selectDisplayTermsOwned", params());
        assertTrue(s.contains("where o.id = ? and o.merchant_id = ? and o.status = 1"), s);
        assertFalse(s.contains("quota_total") || s.contains("per_head_fee"), "结算面的数不随展示条款读回: " + s);
    }

    @Test
    void withdrawnSupplyQueryUsesOnlyLegacyColumns() {
        String s = sql("selectWithdrawnByChapterIds", params());
        assertTrue(s.contains("o.status = 0 and nullif(trim(o.withdraw_reason), '') is not null"), s);
        assertTrue(s.contains("r.replacement_of_offer_id = o.id"), s);
        assertTrue(s.contains("a.replacement_of_offer_id = o.id") && s.contains("a.status in (0, 1)")
                && s.contains("a.del_flag = 0"), s);
        for (String column : NEW_COLUMNS) assertFalse(s.contains(column), column);
        assertFalse(s.contains("sale_paused") || s.contains("removed_by"), s);
    }

    @Test
    void newColumnsStayOutOfRedemptionCapacityAndGenericReads() {
        for (String statement : List.of("selectById", "selectByIdForUpdate", "selectByChapter", "selectByTopic",
                "selectLiveByChapterIds", "sumRemainingQuotaByChapter", "sumRemainingQuotaByChapterForUpdate",
                "consumeQuota", "releaseQuota")) {
            String s = sql(statement, params());
            for (String column : NEW_COLUMNS) assertFalse(s.contains(column), statement + " 不得读 " + column);
        }
    }

    @Test
    void enrollInsertOnlyWritesShopTermsThatWereProvided() {
        MerchantChapterOffer bare = new MerchantChapterOffer();
        bare.setChapterId(6L);
        String without = sql("insertMerchantChapterOffer", bare);
        for (String column : NEW_COLUMNS) assertFalse(without.contains(column), column);

        MerchantChapterOffer full = new MerchantChapterOffer();
        full.setChapterId(6L);
        full.setDailyCapacity(20);
        full.setValidStart(new java.util.Date());
        full.setSoldOutRuleText("售罄换同价饮品");
        full.setStorefrontImg("/profile/upload/a.jpg");
        full.setTermsAgreedAt(new java.util.Date());
        String with = sql("insertMerchantChapterOffer", full);
        for (String column : NEW_COLUMNS) assertTrue(with.contains(column), column);
        assertFalse(with.contains("sale_paused") || with.contains("removed_by"), "暂停 / 移除标记不随入驻写入");
    }
}
