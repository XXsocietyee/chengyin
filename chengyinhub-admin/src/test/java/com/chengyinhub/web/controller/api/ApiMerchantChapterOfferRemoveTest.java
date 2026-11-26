package com.chengyinhub.web.controller.api;

import com.chengyinhub.business.access.merchant.IMerchantAccessService;
import com.chengyinhub.business.access.merchant.MerchantAccessContext;
import com.chengyinhub.business.access.merchant.MerchantPermission;
import com.chengyinhub.business.access.merchant.MerchantRoleCode;
import com.chengyinhub.business.service.IMerchantChapterApplicationService;
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
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** P1-7:主办方移除供给的操作人只来自登录态(scope=MERCHANT 时换成店主),不信 body 里的身份。 */
class ApiMerchantChapterOfferRemoveTest {
    private static final Long PRINCIPAL = 2001L, OWNER = 2000L, OFFER = 77L;
    private IMerchantAccessService accessService;
    private IMerchantOfferService offerService;
    private ApiMerchantChapterApplicationController controller;

    @BeforeEach
    void setUp() {
        accessService = mock(IMerchantAccessService.class);
        offerService = mock(IMerchantOfferService.class);
        controller = controllerFor(PRINCIPAL);
    }

    private ApiMerchantChapterApplicationController controllerFor(Long memberId) {
        ApiMerchantChapterApplicationController result = new ApiMerchantChapterApplicationController() {
            @Override public Long getAppUserId() { return memberId; }
        };
        ReflectionTestUtils.setField(result, "merchantChapterApplicationService",
                mock(IMerchantChapterApplicationService.class));
        ReflectionTestUtils.setField(result, "merchantAccessService", accessService);
        ReflectionTestUtils.setField(result, "merchantOfferService", offerService);
        ReflectionTestUtils.setField(result, "wxContentSecurityService",
                mock(com.chengyinhub.business.service.IWxContentSecurityService.class));
        ReflectionTestUtils.setField(result, "umsMemberService",
                mock(com.chengyinhub.business.service.IUmsMemberService.class));
        return result;
    }

    private Map<String, Object> request() {
        Map<String, Object> body = new HashMap<>();
        body.put("offerId", OFFER);
        body.put("reason", "  多次爽约  ");
        body.put("operatorMemberId", 9999L);
        return body;
    }

    @Test
    void routeSitsNextToTheOtherOrganizerEndpoints() throws Exception {
        assertArrayEquals(new String[]{"/offer/remove"}, ApiMerchantChapterApplicationController.class
                .getMethod("removeOffer", Map.class).getAnnotation(PostMapping.class).value());
    }

    @Test
    void personalScopeUsesTheLoggedInMemberAsOperator() {
        when(offerService.removeChapterOfferAsOrganizer(OFFER, PRINCIPAL, "多次爽约")).thenReturn(true);
        AjaxResult result = controller.removeOffer(request());
        assertEquals(200, result.get("code"));
        assertEquals(Boolean.TRUE, ((Map<?, ?>) result.get("data")).get("enrollmentPaused"));
        verify(offerService).removeChapterOfferAsOrganizer(OFFER, PRINCIPAL, "多次爽约");
        verifyNoInteractions(accessService);
    }

    @Test
    void merchantScopeRequiresProjectManageAndActsAsTheOwner() {
        when(accessService.require(PRINCIPAL, MerchantPermission.PROJECT_MANAGE)).thenReturn(
                new MerchantAccessContext(PRINCIPAL, 77L, OWNER, MerchantRoleCode.MERCHANT_MANAGER));
        Map<String, Object> body = request();
        body.put("scope", "MERCHANT");
        assertEquals(200, controller.removeOffer(body).get("code"));
        verify(offerService).removeChapterOfferAsOrganizer(OFFER, OWNER, "多次爽约");
    }

    @Test
    void merchantScopeWithoutPermissionNeverReachesTheService() {
        when(accessService.require(PRINCIPAL, MerchantPermission.PROJECT_MANAGE))
                .thenThrow(new ServiceException("无权限", 403));
        Map<String, Object> body = request();
        body.put("scope", "MERCHANT");
        assertEquals(403, controller.removeOffer(body).get("code"));
        verifyNoInteractions(offerService);
    }

    @Test
    void serviceRefusalIsReturnedAsTheErrorMessage() {
        when(offerService.removeChapterOfferAsOrganizer(OFFER, PRINCIPAL, "多次爽约"))
                .thenThrow(new IllegalStateException("仅主题发布者可以移除商家供给"));
        AjaxResult result = controller.removeOffer(request());
        assertEquals(500, result.get("code"));
        assertEquals("仅主题发布者可以移除商家供给", result.get("msg"));
    }

    @Test
    void anonymousMissingOfferAndNonTextReasonAreRefusedBeforeTheService() {
        assertEquals(500, controllerFor(null).removeOffer(request()).get("code"));
        assertEquals(500, controller.removeOffer(null).get("code"));
        Map<String, Object> body = request();
        body.put("reason", 123);
        assertEquals(500, controller.removeOffer(body).get("code"));
        verifyNoInteractions(offerService);
    }
}
