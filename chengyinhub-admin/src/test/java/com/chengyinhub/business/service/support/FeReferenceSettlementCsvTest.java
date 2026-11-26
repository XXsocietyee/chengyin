package com.chengyinhub.business.service.support;

import com.chengyinhub.business.domain.vo.FeReferenceSettlementView;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.Arrays;
import java.util.Collections;
import java.util.Date;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** P1-10:参考结算 CSV —— BOM + 中文表头、RFC 4180 转义、公式注入中和;只格式化,不重算金额。 */
class FeReferenceSettlementCsvTest {

    private static FeReferenceSettlementView.Row row(String chapter, String shop, String voucher) {
        FeReferenceSettlementView.Row row = new FeReferenceSettlementView.Row();
        row.setChapterName(chapter);
        row.setMerchantName(shop);
        row.setBasis("REVSHARE_HEAD");
        row.setQuantity(3);
        row.setUnitAmount(new BigDecimal("5.00"));
        row.setAmount(new BigDecimal("15.00"));
        row.setStatusText("已线下结清");
        row.setVoucherNo(voucher);
        // 2026-11-07 10:30:00 GMT+8
        row.setCreateTime(new Date(1794018600000L));
        return row;
    }

    private static FeReferenceSettlementView view(String title, String payer, FeReferenceSettlementView.Row... rows) {
        FeReferenceSettlementView.Group group = new FeReferenceSettlementView.Group();
        group.setActivityTitle(title);
        group.setPayerName(payer);
        group.setRows(Arrays.asList(rows));
        FeReferenceSettlementView view = new FeReferenceSettlementView();
        view.setGroups(Collections.singletonList(group));
        return view;
    }

    @Test
    void startsWithBomAndChineseHeaderEvenWhenEmpty() {
        String header = "﻿场次,主办方,章节,店铺,口径,人次,参考单价,参考金额,状态,凭证号,记账时间,结清时间\r\n";
        assertEquals(header, FeReferenceSettlementCsv.of(new FeReferenceSettlementView()));
        assertEquals(header, FeReferenceSettlementCsv.of(null));
    }

    @Test
    void writesOneLinePerRowWithAmountsAsGivenAndGmt8Times() {
        String csv = FeReferenceSettlementCsv.of(view("周六场", "示例主办方", row("示例站点", "示例店铺", "V-1")));
        String[] lines = csv.split("\r\n");
        assertEquals(2, lines.length);
        assertEquals("周六场,示例主办方,示例站点,示例店铺,计酬人头,3,5.00,15.00,已线下结清,V-1,2026-11-07 10:30:00,", lines[1]);
    }

    @Test
    void escapesQuotesCommasAndNewlines() {
        assertEquals("\"a,b\"", FeReferenceSettlementCsv.cell("a,b"));
        assertEquals("\"say \"\"hi\"\"\"", FeReferenceSettlementCsv.cell("say \"hi\""));
        assertEquals("\"line1\nline2\"", FeReferenceSettlementCsv.cell("line1\nline2"));
        assertEquals("", FeReferenceSettlementCsv.cell(null));
        assertEquals("普通店名", FeReferenceSettlementCsv.cell("普通店名"));
    }

    @Test
    void neutralisesFormulaCellsBeforeEscaping() {
        assertEquals("'=1+1", FeReferenceSettlementCsv.cell("=1+1"));
        assertEquals("'+86", FeReferenceSettlementCsv.cell("+86"));
        assertEquals("'-5", FeReferenceSettlementCsv.cell("-5"));
        assertEquals("'@SUM(A1)", FeReferenceSettlementCsv.cell("@SUM(A1)"));
        assertEquals("\"'=HYPERLINK(\"\"http://x\"\",\"\"y\"\")\"", FeReferenceSettlementCsv.cell("=HYPERLINK(\"http://x\",\"y\")"));
        String csv = FeReferenceSettlementCsv.of(view("=cmd|' /C calc'!A0", "@主办方", row("+章节", "-店铺", "=V")));
        String line = csv.split("\r\n")[1];
        assertTrue(line.startsWith("'=cmd|' /C calc'!A0,'@主办方,'+章节,'-店铺,"), line);
        assertTrue(line.contains(",'=V,"), line);
    }
}
