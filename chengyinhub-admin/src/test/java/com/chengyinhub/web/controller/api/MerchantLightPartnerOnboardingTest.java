package com.chengyinhub.web.controller.api;

import com.chengyinhub.business.domain.EcomSubMerchant;
import com.chengyinhub.business.domain.MmsMerchant;
import com.chengyinhub.business.domain.dto.MerchantRegistrationDTO;
import com.chengyinhub.business.mapper.EcomPayoutMapper;
import com.chengyinhub.business.mapper.MerchantOperatorMapper;
import com.chengyinhub.business.mapper.MmsMerchantMapper;
import com.chengyinhub.business.mapper.UmsMemberMapper;
import com.chengyinhub.business.payout.ApplymentState;
import com.chengyinhub.business.payout.EcommercePayGateway;
import com.chengyinhub.business.payout.EcommerceSubMerchantService;
import com.chengyinhub.business.payout.PayoutSwitches;
import com.chengyinhub.business.service.IMmsMerchantService;
import com.chengyinhub.business.service.impl.MemberIdentityService;
import com.chengyinhub.business.service.support.UgcSubmissionSafety;
import com.chengyinhub.common.core.domain.AjaxResult;
import com.chengyinhub.common.exception.ServiceException;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * §4.3 (2) 分级入驻（4 字段轻量合作档免营业执照/免 18 位实名；开通 l-payout2 直连结算时必须补齐执照与实名）。
 */
class MerchantLightPartnerOnboardingTest {

    private static final long MEMBER = 905L;

    @Test
    void lightPartnerSubmitsFourFieldsWithoutLicenseOrUpfrontKyc() {
        IMmsMerchantService merchants = mock(IMmsMerchantService.class);
        UmsMemberMapper members = mock(UmsMemberMapper.class);
        MemberIdentityService identity = mock(MemberIdentityService.class);
        when(members.lockMemberById(MEMBER)).thenReturn(MEMBER);
        when(merchants.insertMmsMerchant(any())).thenReturn(1);
        // 即使未做 18 位实名登记，轻量合作档也放行。
        when(identity.checkRegistered(MEMBER)).thenReturn("请先完成实名登记");

        ApiMerchantController controller = buildController(merchants, members, identity);
        MerchantRegistrationDTO req = lightRequest();

        AjaxResult res = controller.merchantRegistration(req);
        assertEquals(200, res.get(AjaxResult.CODE_TAG));
        verify(identity, never()).checkRegistered(any());

        ArgumentCaptor<MmsMerchant> saved = ArgumentCaptor.forClass(MmsMerchant.class);
        verify(merchants).insertMmsMerchant(saved.capture());
        assertEquals("巷口咖啡", saved.getValue().getName());
        assertEquals("13800138000", saved.getValue().getPhone());
        assertEquals("https://www.chengyinhub.com/prod-api/profile/shop.jpg", saved.getValue().getCoverImage());
        assertEquals("https://www.chengyinhub.com/prod-api/profile/shop.jpg", saved.getValue().getDerivatives());
        assertEquals(Integer.valueOf(0), saved.getValue().getChargeType());
        assertNull(saved.getValue().getBusinessLicense());
    }

    @Test
    void lightPartnerRejectsMissingRequiredFourFields() {
        IMmsMerchantService merchants = mock(IMmsMerchantService.class);
        UmsMemberMapper members = mock(UmsMemberMapper.class);
        MemberIdentityService identity = mock(MemberIdentityService.class);
        ApiMerchantController controller = buildController(merchants, members, identity);

        MerchantRegistrationDTO noName = lightRequest();
        noName.setName("  ");
        assertNotEquals(200, controller.merchantRegistration(noName).get(AjaxResult.CODE_TAG));

        MerchantRegistrationDTO noCoords = lightRequest();
        noCoords.setLocationLat(null);
        assertNotEquals(200, controller.merchantRegistration(noCoords).get(AjaxResult.CODE_TAG));

        MerchantRegistrationDTO badPhone = lightRequest();
        badPhone.setPhone("12345");
        assertNotEquals(200, controller.merchantRegistration(badPhone).get(AjaxResult.CODE_TAG));

        MerchantRegistrationDTO noPhoto = lightRequest();
        noPhoto.setStorefrontPhoto("");
        assertNotEquals(200, controller.merchantRegistration(noPhoto).get(AjaxResult.CODE_TAG));

        verify(merchants, never()).insertMmsMerchant(any());
    }

    @Test
    void fullTierStillRequiresUpfrontKyc() {
        IMmsMerchantService merchants = mock(IMmsMerchantService.class);
        UmsMemberMapper members = mock(UmsMemberMapper.class);
        MemberIdentityService identity = mock(MemberIdentityService.class);
        when(members.lockMemberById(MEMBER)).thenReturn(MEMBER);
        when(identity.checkRegistered(MEMBER)).thenReturn("请先完成实名登记");

        ApiMerchantController controller = buildController(merchants, members, identity);
        MerchantRegistrationDTO fullReq = lightRequest();
        fullReq.setPartnerTier("FULL");

        AjaxResult res = controller.merchantRegistration(fullReq);
        assertNotEquals(200, res.get(AjaxResult.CODE_TAG));
        assertTrue(String.valueOf(res.get(AjaxResult.MSG_TAG)).contains("实名"));
        verify(merchants, never()).insertMmsMerchant(any());
    }

    @Test
    void directPayoutOnboardingRequiresLicenseAndKycForLightPartner() {
        EcomPayoutMapper payoutMapper = mock(EcomPayoutMapper.class);
        EcommercePayGateway gateway = mock(EcommercePayGateway.class);
        PayoutSwitches switches = mock(PayoutSwitches.class);
        MmsMerchantMapper merchantMapper = mock(MmsMerchantMapper.class);
        MemberIdentityService identityService = mock(MemberIdentityService.class);

        when(switches.ecommerceEnabled()).thenReturn(true);
        when(payoutMapper.selectSellerMemberId("MERCHANT", 55L)).thenReturn(MEMBER);

        EcommerceSubMerchantService svc = new EcommerceSubMerchantService(payoutMapper, gateway, switches);
        ReflectionTestUtils.setField(svc, "mmsMerchantMapper", merchantMapper);
        ReflectionTestUtils.setField(svc, "memberIdentityService", identityService);

        // 1. 缺营业执照 -> 拒绝开通直连结算
        MmsMerchant lightMerchant = new MmsMerchant();
        lightMerchant.setId(55L);
        lightMerchant.setMemberId(MEMBER);
        lightMerchant.setBusinessLicense(null);
        when(merchantMapper.selectMmsMerchantById(55L)).thenReturn(lightMerchant);

        ServiceException noLicense = assertThrows(ServiceException.class,
                () -> svc.register("MERCHANT", 55L, "admin"));
        assertTrue(noLicense.getMessage().contains("营业执照"));

        // 2. 补传营业执照但未完成实名 -> 仍拒绝
        lightMerchant.setBusinessLicense("https://www.chengyinhub.com/prod-api/profile/lic.jpg");
        when(identityService.checkRegistered(MEMBER)).thenReturn("请先登记身份证号");
        ServiceException noKyc = assertThrows(ServiceException.class,
                () -> svc.register("MERCHANT", 55L, "admin"));
        assertTrue(noKyc.getMessage().contains("实名"));

        // submit() 同样执行执照与实名闸
        EcomSubMerchant draft = new EcomSubMerchant();
        draft.setId(7L);
        draft.setOwnerType("MERCHANT");
        draft.setOwnerId(55L);
        draft.setApplymentState(ApplymentState.DRAFT.name());
        when(payoutMapper.selectSubMerchantById(7L)).thenReturn(draft);
        assertThrows(ServiceException.class, () -> svc.submit(7L, Collections.emptyMap()));

        // 3. 补齐执照 + 实名后允许开通
        when(identityService.checkRegistered(MEMBER)).thenReturn(null);
        when(payoutMapper.selectSubMerchant("MERCHANT", 55L)).thenReturn(null, draft);
        assertEquals(draft, svc.register("MERCHANT", 55L, "admin"));
    }

    private ApiMerchantController buildController(IMmsMerchantService merchants, UmsMemberMapper members,
                                                  MemberIdentityService identity) {
        ApiMerchantController controller = new ApiMerchantController() {
            @Override
            public Long getAppUserId() {
                return MEMBER;
            }
        };
        ReflectionTestUtils.setField(controller, "submissionSafety", mock(UgcSubmissionSafety.class));
        ReflectionTestUtils.setField(controller, "mmsMerchantService", merchants);
        ReflectionTestUtils.setField(controller, "umsMemberMapper", members);
        ReflectionTestUtils.setField(controller, "merchantOperatorMapper", mock(MerchantOperatorMapper.class));
        ReflectionTestUtils.setField(controller, "memberIdentityService", identity);
        return controller;
    }

    private MerchantRegistrationDTO lightRequest() {
        MerchantRegistrationDTO req = new MerchantRegistrationDTO();
        req.setPartnerTier("LIGHT");
        req.setName("巷口咖啡");
        req.setAddress("苏州市工业园区星海街 8 号");
        req.setLocationLat(31.30D);
        req.setLocationLng(120.70D);
        req.setPhone("13800138000");
        req.setStorefrontPhoto("https://www.chengyinhub.com/prod-api/profile/shop.jpg");
        return req;
    }
}
