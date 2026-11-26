package com.chengyinhub.web.controller.api;

import com.chengyinhub.business.access.merchant.IMerchantAccessService;
import com.chengyinhub.business.access.merchant.MerchantAccessContext;
import com.chengyinhub.business.access.merchant.MerchantPermission;
import com.chengyinhub.business.access.merchant.MerchantRoleCode;
import com.chengyinhub.business.service.IMerchantOfferService;
import com.chengyinhub.common.core.domain.AjaxResult;
import com.chengyinhub.common.exception.ServiceException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.bind.annotation.PostMapping;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** P1-7:调名额 / 暂停新售只按登录态换出的店主身份操作,不信 body 里的身份。 */
class ApiCoopOfferQuotaPauseTest {
    private static final Long PRINCIPAL = 7002L, OWNER = 9001L, OFFER = 77L;
    private IMerchantAccessService accessService;
    private IMerchantOfferService offerService;
    private ApiCoopController controller;

    @BeforeEach
    void setUp() {
        accessService = mock(IMerchantAccessService.class);
        offerService = mock(IMerchantOfferService.class);
        controller = new ApiCoopController() {
            @Override public Long getAppUserId() { return PRINCIPAL; }
        };
        ReflectionTestUtils.setField(controller, "merchantAccessService", accessService);
        ReflectionTestUtils.setField(controller, "merchantOfferService", offerService);
    }

    private void allowMerchant() {
        when(accessService.require(PRINCIPAL, MerchantPermission.COOP_MANAGE))
                .thenReturn(new MerchantAccessContext(PRINCIPAL, 11L, OWNER, MerchantRoleCode.MERCHANT_MANAGER));
    }

    private Map<String, Object> body(String key, Object value) {
        Map<String, Object> body = new HashMap<>();
        body.put("offerId", OFFER);
        body.put("merchantId", 1L);
        body.put(key, value);
        return body;
    }

    @Test
    void routesAreStable() throws Exception {
        assertArrayEquals(new String[]{"/offer/quota"}, ApiCoopController.class
                .getMethod("offerQuota", Map.class).getAnnotation(PostMapping.class).value());
        assertArrayEquals(new String[]{"/offer/sale-pause"}, ApiCoopController.class
                .getMethod("offerSalePause", Map.class).getAnnotation(PostMapping.class).value());
    }

    @Test
    void quotaUsesTheOwnerResolvedFromTheSession() {
        allowMerchant();
        AjaxResult result = controller.offerQuota(body("quotaTotal", 30));
        assertEquals(200, result.get("code"));
        verify(offerService).setOwnQuota(OFFER, OWNER, 30);
    }

    @Test
    void quotaWithoutCoopPermissionNeverReachesTheService() {
        when(accessService.require(PRINCIPAL, MerchantPermission.COOP_MANAGE))
                .thenThrow(new ServiceException("无权限", 403));
        assertEquals(403, controller.offerQuota(body("quotaTotal", 30)).get("code"));
        assertEquals(403, controller.offerSalePause(body("paused", true)).get("code"));
        verifyNoInteractions(offerService);
    }

    @Test
    void quotaMustBeAWholeNumber() {
        allowMerchant();
        assertEquals(500, controller.offerQuota(body("quotaTotal", "30")).get("code"));
        assertEquals(500, controller.offerQuota(body("quotaTotal", 3.5)).get("code"));
        assertEquals(500, controller.offerQuota(body("quotaTotal", null)).get("code"));
        verifyNoInteractions(offerService);
    }

    @Test
    void serviceRefusalIsReturnedAsTheErrorMessage() {
        allowMerchant();
        doThrow(new IllegalStateException("已售出的份数超过新额度"))
                .when(offerService).setOwnQuota(OFFER, OWNER, 3);
        AjaxResult result = controller.offerQuota(body("quotaTotal", 3));
        assertEquals(500, result.get("code"));
        assertEquals("已售出的份数超过新额度", result.get("msg"));
    }

    @Test
    void pauseAndResumeReturnTheNewState() {
        allowMerchant();
        when(offerService.setOwnSalePaused(OFFER, OWNER, true)).thenReturn(true);
        when(offerService.setOwnSalePaused(OFFER, OWNER, false)).thenReturn(false);
        AjaxResult paused = controller.offerSalePause(body("paused", true));
        assertEquals(200, paused.get("code"));
        assertEquals(Boolean.TRUE, ((Map<?, ?>) paused.get("data")).get("salePaused"));
        AjaxResult resumed = controller.offerSalePause(body("paused", 0));
        assertEquals(Boolean.FALSE, ((Map<?, ?>) resumed.get("data")).get("salePaused"));
    }

    @Test
    void pauseNeedsAnExplicitChoiceAndAnOffer() {
        allowMerchant();
        assertEquals(500, controller.offerSalePause(body("paused", null)).get("code"));
        assertEquals(500, controller.offerSalePause(body("paused", 2)).get("code"));
        Map<String, Object> noOffer = new HashMap<>();
        noOffer.put("paused", true);
        assertEquals(500, controller.offerSalePause(noOffer).get("code"));
        assertEquals(500, controller.offerQuota(null).get("code"));
        verifyNoInteractions(offerService);
    }
}
