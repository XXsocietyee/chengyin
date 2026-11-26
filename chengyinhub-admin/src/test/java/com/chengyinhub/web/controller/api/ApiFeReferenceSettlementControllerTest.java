package com.chengyinhub.web.controller.api;

import com.chengyinhub.business.access.merchant.IMerchantAccessService;
import com.chengyinhub.business.access.merchant.MerchantAccessContext;
import com.chengyinhub.business.access.merchant.MerchantPermission;
import com.chengyinhub.business.access.merchant.MerchantRoleCode;
import com.chengyinhub.business.domain.vo.FeReferenceSettlementView;
import com.chengyinhub.business.service.IFeReferenceSettlementService;
import com.chengyinhub.common.core.domain.AjaxResult;
import com.chengyinhub.common.exception.ServiceException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.Collections;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

/** P1-10:日期范围与 CSV 导出沿用列表端点的归属 —— 店铺只读本店(FINANCE_READ 派生店主),收款人只读本人场次。 */
class ApiFeReferenceSettlementControllerTest {

    private static final long STAFF = 501L, OWNER = 900L;

    private IFeReferenceSettlementService service;
    private IMerchantAccessService access;
    private ApiFeReferenceSettlementController controller;

    @BeforeEach
    void setUp() {
        service = mock(IFeReferenceSettlementService.class);
        access = mock(IMerchantAccessService.class);
        controller = spy(new ApiFeReferenceSettlementController(service, access));
        doReturn(STAFF).when(controller).getAppUserId();
        when(access.require(STAFF, MerchantPermission.FINANCE_READ))
                .thenReturn(new MerchantAccessContext(STAFF, 11L, OWNER, MerchantRoleCode.MERCHANT_OWNER));
    }

    private static FeReferenceSettlementView oneRow() {
        FeReferenceSettlementView.Row row = new FeReferenceSettlementView.Row();
        row.setId(1L);
        row.setChapterName("示例站点");
        row.setMerchantName("示例店铺");
        row.setBasis("PERK_REDEEMED");
        row.setQuantity(1);
        row.setUnitAmount(new BigDecimal("12.50"));
        row.setAmount(new BigDecimal("12.50"));
        row.setStatusText("待线下结款");
        FeReferenceSettlementView.Group group = new FeReferenceSettlementView.Group();
        group.setActivityTitle("周六场");
        group.setPayerName("示例主办方");
        group.setRows(Collections.singletonList(row));
        FeReferenceSettlementView view = new FeReferenceSettlementView();
        view.setGroups(Collections.singletonList(group));
        return view;
    }

    @Test
    void merchantListPassesTheDateRangeUnderTheResolvedShopOwner() {
        FeReferenceSettlementView view = oneRow();
        when(service.listForMerchant(OWNER, "OPEN", "2026-11-01", "2026-11-07")).thenReturn(view);
        AjaxResult result = controller.merchant("OPEN", "2026-11-01", "2026-11-07");
        assertEquals(200, result.get(AjaxResult.CODE_TAG));
        assertSame(view, result.get(AjaxResult.DATA_TAG));
    }

    @Test
    void payerListPassesTheDateRangeUnderTheLoggedInMemberOnly() {
        controller.payer(71L, "2026-11-01", null);
        verify(service).listForPayer(STAFF, 71L, "2026-11-01", null);
        verifyNoInteractions(access);
    }

    @Test
    void merchantExportReusesTheScopedListAndReturnsCsvText() {
        when(service.listForMerchant(OWNER, null, "2026-11-01", "2026-11-07")).thenReturn(oneRow());
        AjaxResult result = controller.merchantExport(null, "2026-11-01", "2026-11-07");
        assertEquals(200, result.get(AjaxResult.CODE_TAG));
        Map<?, ?> data = (Map<?, ?>) result.get(AjaxResult.DATA_TAG);
        assertEquals("fe-reference-settlement-2026-11-01-2026-11-07.csv", data.get("fileName"));
        String csv = (String) data.get("content");
        assertTrue(csv.startsWith("﻿场次,主办方,章节,店铺,"));
        assertTrue(csv.contains("周六场,示例主办方,示例站点,示例店铺,权益核销,1,12.50,12.50,待线下结款,"));
        verify(access).require(STAFF, MerchantPermission.FINANCE_READ);
        verify(service).listForMerchant(OWNER, null, "2026-11-01", "2026-11-07");
        verifyNoMoreInteractions(service);
    }

    @Test
    void merchantExportWithoutFinanceReadNeverReachesTheService() {
        when(access.require(anyLong(), anyString())).thenThrow(new ServiceException("商家身份无效或权限不足", 403));
        AjaxResult result = controller.merchantExport(null, null, null);
        assertEquals(403, result.get(AjaxResult.CODE_TAG));
        verifyNoInteractions(service);
    }

    @Test
    void payerExportReadsOnlyTheLoggedInPayersRowsAndSurfacesScopeRefusal() {
        when(service.listForPayer(STAFF, null, null, null)).thenReturn(oneRow());
        Map<?, ?> data = (Map<?, ?>) controller.payerExport(null, null, null).get(AjaxResult.DATA_TAG);
        assertEquals("fe-reference-settlement.csv", data.get("fileName"));
        verify(service).listForPayer(STAFF, null, null, null);
        verifyNoInteractions(access);

        when(service.listForPayer(STAFF, 71L, null, null)).thenThrow(new ServiceException("无该场次结算查看范围"));
        AjaxResult refused = controller.payerExport(71L, null, null);
        assertEquals(500, refused.get(AjaxResult.CODE_TAG));
        assertEquals("无该场次结算查看范围", refused.get(AjaxResult.MSG_TAG));
    }

    @Test
    void badDatesAreRefusedByTheServiceAndNeverBecomeAFile() {
        when(service.listForMerchant(OWNER, null, "2026/11/01", null)).thenThrow(new ServiceException("日期格式无效"));
        AjaxResult result = controller.merchantExport(null, "2026/11/01", null);
        assertEquals("日期格式无效", result.get(AjaxResult.MSG_TAG));
        assertEquals(null, result.get(AjaxResult.DATA_TAG));
    }
}
