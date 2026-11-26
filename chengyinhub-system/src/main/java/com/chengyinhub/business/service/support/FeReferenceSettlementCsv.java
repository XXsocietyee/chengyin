package com.chengyinhub.business.service.support;

import com.chengyinhub.business.domain.vo.FeReferenceSettlementView;

import java.math.BigDecimal;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.TimeZone;

/**
 * F11 参考结算导出:把列表视图(与页面同一份、已按归属过滤)写成 CSV 文本,供店铺与主办方线下对账。
 * 只做格式化,不查库、不重算金额。UTF-8 BOM 开头(Excel 直接打开不乱码);
 * 单元格内的引号 / 逗号 / 换行按 RFC 4180 转义;以 = + - @ 或制表 / 回车开头的单元格前加 ' 防公式注入。
 */
public final class FeReferenceSettlementCsv {

    public static final String BOM = "﻿";
    static final String HEADER = "场次,主办方,章节,店铺,口径,人次,参考单价,参考金额,状态,凭证号,记账时间,结清时间";

    private FeReferenceSettlementCsv() {
    }

    public static String of(FeReferenceSettlementView view) {
        StringBuilder out = new StringBuilder(BOM).append(HEADER).append("\r\n");
        if (view == null || view.getGroups() == null) return out.toString();
        for (FeReferenceSettlementView.Group group : view.getGroups()) {
            if (group == null || group.getRows() == null) continue;
            for (FeReferenceSettlementView.Row row : group.getRows()) {
                if (row == null) continue;
                String[] cells = {
                        group.getActivityTitle(), group.getPayerName(), row.getChapterName(), row.getMerchantName(),
                        basisText(row.getBasis()), row.getQuantity() == null ? "" : String.valueOf(row.getQuantity()),
                        money(row.getUnitAmount()), money(row.getAmount()), row.getStatusText(), row.getVoucherNo(),
                        time(row.getCreateTime()), time(row.getSettledAt())};
                for (int i = 0; i < cells.length; i++) {
                    if (i > 0) out.append(',');
                    out.append(cell(cells[i]));
                }
                out.append("\r\n");
            }
        }
        return out.toString();
    }

    static String cell(String raw) {
        String value = raw == null ? "" : raw;
        if (!value.isEmpty() && "=+-@\t\r".indexOf(value.charAt(0)) >= 0) value = "'" + value;
        if (value.indexOf('"') >= 0 || value.indexOf(',') >= 0 || value.indexOf('\n') >= 0 || value.indexOf('\r') >= 0) {
            return '"' + value.replace("\"", "\"\"") + '"';
        }
        return value;
    }

    private static String basisText(String basis) {
        if ("PERK_REDEEMED".equals(basis)) return "权益核销";
        if ("REVSHARE_HEAD".equals(basis)) return "计酬人头";
        if ("TRAFFIC".equals(basis)) return "引流";
        if ("DISTRIBUTION".equals(basis)) return "分销";
        return basis;
    }

    private static String money(BigDecimal amount) {
        return amount == null ? "" : amount.toPlainString();
    }

    private static String time(Date at) {
        if (at == null) return "";
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss");
        format.setTimeZone(TimeZone.getTimeZone("GMT+8"));
        return format.format(at);
    }
}
