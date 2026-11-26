package com.chengyinhub.web.controller.api;

import com.chengyinhub.business.access.merchant.IMerchantAccessService;
import com.chengyinhub.business.access.merchant.MerchantAccessContext;
import com.chengyinhub.business.access.merchant.MerchantPermission;
import com.chengyinhub.business.access.merchant.MerchantRoleCode;
import com.chengyinhub.business.domain.MerchantChapterOffer;
import com.chengyinhub.business.service.IMerchantOfferService;
import com.chengyinhub.common.core.domain.AjaxResult;
import com.chengyinhub.common.exception.ServiceException;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** /api/coop/offer/display-terms 的门店条款入参:没带 = 不覆写;带了就按类型收,格式不对直接拒。 */
class ApiCoopOfferShopTermsTest {

    @Test
    void legacyBodyWithoutShopTermsKeysMeansDoNotTouch() {
        Map<String, Object> body = new HashMap<>();
        body.put("offerId", 9);
        body.put("included", true);
        assertNull(ApiCoopController.shopTermsOf(body));
        assertNull(ApiCoopController.shopTermsOf(null));
    }

    @Test
    void shopTermsAreParsedByType() {
        Map<String, Object> body = new HashMap<>();
        body.put("dailyCapacity", 20);
        body.put("validStart", "2026-12-01");
        body.put("soldOutRuleText", "售罄换同价饮品");
        body.put("storefrontImg", "/profile/upload/a.jpg");
        MerchantChapterOffer terms = ApiCoopController.shopTermsOf(body);
        assertEquals(20, terms.getDailyCapacity());
        assertEquals(java.sql.Date.valueOf("2026-12-01"), terms.getValidStart());
        assertEquals("售罄换同价饮品", terms.getSoldOutRuleText());
        assertEquals("/profile/upload/a.jpg", terms.getStorefrontImg());

        Map<String, Object> cleared = new HashMap<>();
        cleared.put("dailyCapacity", null);
        cleared.put("validStart", "");
        MerchantChapterOffer empty = ApiCoopController.shopTermsOf(cleared);
        assertNull(empty.getDailyCapacity());
        assertNull(empty.getValidStart());
    }

    @Test
    void malformedValuesAreRefused() {
        assertThrows(IllegalArgumentException.class, () -> ApiCoopController.shopTermsOf(Map.of("dailyCapacity", "很多")));
        assertThrows(IllegalArgumentException.class, () -> ApiCoopController.shopTermsOf(Map.of("dailyCapacity", 1.5)));
        assertThrows(IllegalArgumentException.class, () -> ApiCoopController.shopTermsOf(Map.of("validStart", "12/01")));
        assertThrows(IllegalArgumentException.class, () -> ApiCoopController.shopTermsOf(Map.of("storefrontImg", 7)));
        assertThrows(IllegalArgumentException.class, () -> ApiCoopController.shopTermsOf(Map.of("soldOutRuleText", 7)));
    }

    private static final Long PRINCIPAL = 7002L, OWNER = 9001L, OFFER = 77L;

    private static ApiCoopController controller(IMerchantAccessService access, IMerchantOfferService offers) {
        ApiCoopController controller = new ApiCoopController() {
            @Override public Long getAppUserId() { return PRINCIPAL; }
        };
        ReflectionTestUtils.setField(controller, "merchantAccessService", access);
        ReflectionTestUtils.setField(controller, "merchantOfferService", offers);
        return controller;
    }

    private static IMerchantAccessService allowed() {
        IMerchantAccessService access = mock(IMerchantAccessService.class);
        when(access.require(PRINCIPAL, MerchantPermission.COOP_MANAGE))
                .thenReturn(new MerchantAccessContext(PRINCIPAL, 11L, OWNER, MerchantRoleCode.MERCHANT_MANAGER));
        return access;
    }

    /** 保存:店主身份只从登录态换出(不信 body 里的 merchantId);门店条款随同一次调用落到 service。 */
    @Test
    void saveUsesTheOwnerResolvedFromTheSessionAndForwardsShopTerms() {
        IMerchantOfferService offers = mock(IMerchantOfferService.class);
        Map<String, Object> body = new HashMap<>();
        body.put("offerId", OFFER);
        body.put("merchantId", 1L);
        body.put("included", 0);
        body.put("extraSpendText", "饮品另付");
        body.put("reserveRequired", 1);
        body.put("dailyCapacity", 20);
        body.put("storefrontImg", "/profile/upload/a.jpg");

        AjaxResult result = controller(allowed(), offers).offerDisplayTerms(body);

        assertEquals(200, result.get("code"));
        ArgumentCaptor<MerchantChapterOffer> terms = ArgumentCaptor.forClass(MerchantChapterOffer.class);
        verify(offers).setDisplayTerms(eq(OFFER), eq(OWNER), eq(0), eq("饮品另付"), eq(1), terms.capture());
        assertEquals(20, terms.getValue().getDailyCapacity());
        assertEquals("/profile/upload/a.jpg", terms.getValue().getStorefrontImg());
    }

    @Test
    void legacySaveWithoutShopTermsPassesNullSoTheyAreNotCleared() {
        IMerchantOfferService offers = mock(IMerchantOfferService.class);
        Map<String, Object> body = new HashMap<>();
        body.put("offerId", OFFER);
        body.put("included", true);
        controller(allowed(), offers).offerDisplayTerms(body);
        verify(offers).setDisplayTerms(eq(OFFER), eq(OWNER), eq(1), isNull(), isNull(), isNull());
    }

    /** 读回:只下发展示字段,且只读登录态店主自己的供给;无权限或不属于本店都到不了数据。 */
    @Test
    void viewReturnsOnlyDisplayFieldsOfTheSessionOwnersOffer() {
        IMerchantOfferService offers = mock(IMerchantOfferService.class);
        MerchantChapterOffer row = new MerchantChapterOffer();
        row.setId(OFFER);
        row.setMerchantId(OWNER);
        row.setPerkName("手冲一杯");
        row.setIncluded(1);
        row.setReserveRequired(1);
        row.setDailyCapacity(20);
        row.setValidStart(java.sql.Date.valueOf("2026-12-01"));
        row.setSoldOutRuleText("售罄换同价饮品");
        row.setStorefrontImg("/profile/upload/a.jpg");
        row.setQuotaTotal(50);
        when(offers.displayTerms(OFFER, OWNER)).thenReturn(row);

        AjaxResult result = controller(allowed(), offers).offerDisplayTermsView(OFFER);

        assertEquals(200, result.get("code"));
        Map<?, ?> data = (Map<?, ?>) result.get("data");
        assertEquals(OFFER, data.get("offerId"));
        assertEquals("手冲一杯", data.get("perkName"));
        assertEquals(Boolean.TRUE, data.get("included"));
        assertEquals(Boolean.TRUE, data.get("reserveRequired"));
        assertEquals(20, data.get("dailyCapacity"));
        assertEquals("2026-12-01", data.get("validStart"));
        assertEquals("售罄换同价饮品", data.get("soldOutRuleText"));
        assertEquals("/profile/upload/a.jpg", data.get("storefrontImg"));
        assertEquals(false, data.containsKey("quotaTotal"));
        assertEquals(false, data.containsKey("merchantId"));
    }

    @Test
    void viewWithoutPermissionOrForForeignOfferIsRefused() {
        IMerchantOfferService offers = mock(IMerchantOfferService.class);
        IMerchantAccessService denied = mock(IMerchantAccessService.class);
        when(denied.require(PRINCIPAL, MerchantPermission.COOP_MANAGE)).thenThrow(new ServiceException("无权限", 403));
        assertEquals(403, controller(denied, offers).offerDisplayTermsView(OFFER).get("code"));
        verifyNoInteractions(offers);

        when(offers.displayTerms(OFFER, OWNER)).thenThrow(new IllegalStateException("供给不存在或不属于当前商家"));
        AjaxResult foreign = controller(allowed(), offers).offerDisplayTermsView(OFFER);
        assertEquals(500, foreign.get("code"));
        assertEquals("供给不存在或不属于当前商家", foreign.get("msg"));
        assertEquals(500, controller(allowed(), offers).offerDisplayTermsView(null).get("code"));
    }
}
