package com.chengyinhub.web.controller.api;

import com.chengyinhub.business.domain.MemberCapability;
import com.chengyinhub.business.domain.MmsMerchant;
import com.chengyinhub.business.domain.vo.ClubCoopMerchantCardVO;
import com.chengyinhub.business.service.ICapabilityService;
import com.chengyinhub.business.service.IClubLeaderService;
import com.chengyinhub.business.service.IClubMemberService;
import com.chengyinhub.business.service.IClubService;
import com.chengyinhub.business.service.IMmsMerchantService;
import com.chengyinhub.common.core.domain.AjaxResult;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * POST /api/club/merchants：普通成员 403，成功回包只有商家卡字段。
 */
class ApiClubMerchantsPrivacyTest {

    private static final Long ME = 42L;
    private static final List<String> PRIVATE_KEYS = Arrays.asList(
            "phone", "wechat", "wechatQrcode", "wechat_qrcode", "businessLicense", "business_license",
            "reson", "disableReason", "audit", "license", "idCard", "id_card", "remark");

    private ApiClubController controller;
    private IMmsMerchantService merchants;
    private ICapabilityService capabilityService;
    private IClubLeaderService clubLeaderService;
    private IClubService clubService;
    private IClubMemberService clubMemberService;

    @BeforeEach
    void setUp() {
        controller = spy(new ApiClubController());
        doReturn(ME).when(controller).getAppUserId();
        merchants = mock(IMmsMerchantService.class);
        capabilityService = mock(ICapabilityService.class);
        clubLeaderService = mock(IClubLeaderService.class);
        clubService = mock(IClubService.class);
        clubMemberService = mock(IClubMemberService.class);
        ReflectionTestUtils.setField(controller, "mmsMerchantService", merchants);
        ReflectionTestUtils.setField(controller, "capabilityService", capabilityService);
        ReflectionTestUtils.setField(controller, "clubLeaderService", clubLeaderService);
        ReflectionTestUtils.setField(controller, "clubService", clubService);
        ReflectionTestUtils.setField(controller, "clubMemberService", clubMemberService);
    }

    @Test
    void normal_member_is_rejected() {
        when(capabilityService.hasCapability(ME, MemberCapability.CAP_CLUB_LEADER)).thenReturn(false);
        when(clubLeaderService.selectClubLeaderByMemberId(ME)).thenReturn(null);
        when(clubService.selectClubsByMemberId(ME)).thenReturn(Collections.emptyList());
        when(clubMemberService.selectClubIdsByMember(ME)).thenReturn(Collections.singletonList(7L));
        when(clubMemberService.canGovernClub(anyLong(), eq(ME))).thenReturn(false);

        AjaxResult result = controller.merchants(new MmsMerchant());

        assertEquals(403, result.get(AjaxResult.CODE_TAG));
        assertNull(result.get(AjaxResult.DATA_TAG));
        verify(merchants, never()).selectClubCoopMerchantCards(any());
        verify(merchants, never()).selectMmsMerchantList(any());
    }

    @Test
    void leader_payload_has_card_fields_and_no_contact_or_audit_keys() throws Exception {
        when(capabilityService.hasCapability(ME, MemberCapability.CAP_CLUB_LEADER)).thenReturn(true);
        when(merchants.selectClubCoopMerchantCards(any(MmsMerchant.class)))
                .thenReturn(Collections.singletonList(card()));

        AjaxResult result = controller.merchants(probe());

        assertEquals(200, result.get(AjaxResult.CODE_TAG));
        ArgumentCaptor<MmsMerchant> query = ArgumentCaptor.forClass(MmsMerchant.class);
        verify(merchants).selectClubCoopMerchantCards(query.capture());
        verify(merchants, never()).selectMmsMerchantList(any());
        assertEquals(Integer.valueOf(1), query.getValue().getCoopOpen());
        assertEquals(Long.valueOf(1L), query.getValue().getStatus());
        assertEquals(Integer.valueOf(0), query.getValue().getDelFlag());
        assertNull(query.getValue().getPhone());
        assertNull(query.getValue().getWechat());
        assertNull(query.getValue().getBusinessLicense());

        String json = new ObjectMapper().writeValueAsString(result.get(AjaxResult.DATA_TAG));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> rows = new ObjectMapper().readValue(json, List.class);
        assertEquals(1, rows.size());
        Map<String, Object> row = rows.get(0);
        assertEquals(9, row.get("id"));
        assertEquals("河岸咖啡", row.get("name"));
        assertEquals("logo.png", row.get("logo"));
        assertEquals("cover.png", row.get("coverImage"));
        assertEquals("愚园路 1 号", row.get("address"));
        assertEquals(3, row.get("categoryId"));
        assertEquals(1, row.get("coopOpen"));
        assertEquals(88, row.get("memberId"));
        for (String key : PRIVATE_KEYS) {
            assertFalse(row.containsKey(key), key);
        }
        for (java.lang.reflect.Field field : ClubCoopMerchantCardVO.class.getDeclaredFields()) {
            assertFalse(PRIVATE_KEYS.contains(field.getName()), field.getName());
        }
        String sql = cardQuery(readMapper());
        for (String column : Arrays.asList("phone", "wechat", "wechat_qrcode", "business_license", "reson", "disable_reason")) {
            assertFalse(sql.contains(column), column);
        }
        assertTrue(sql.contains("category_id") && sql.contains("coop_open") && sql.contains("cover_image"));
    }

    @Test
    void club_admin_may_list_cards() {
        when(capabilityService.hasCapability(ME, MemberCapability.CAP_CLUB_LEADER)).thenReturn(false);
        when(clubLeaderService.selectClubLeaderByMemberId(ME)).thenReturn(null);
        when(clubService.selectClubsByMemberId(ME)).thenReturn(Collections.emptyList());
        when(clubMemberService.selectClubIdsByMember(ME)).thenReturn(Collections.singletonList(7L));
        when(clubMemberService.canGovernClub(7L, ME)).thenReturn(true);
        when(merchants.selectClubCoopMerchantCards(any(MmsMerchant.class)))
                .thenReturn(Collections.singletonList(card()));

        AjaxResult result = controller.merchants(null);

        assertEquals(200, result.get(AjaxResult.CODE_TAG));
        verify(merchants).selectClubCoopMerchantCards(any(MmsMerchant.class));
    }

    private static MmsMerchant probe() {
        MmsMerchant query = new MmsMerchant();
        query.setPhone("13800001111");
        query.setWechat("secret-wx");
        query.setBusinessLicense("license.png");
        query.setReson("审核备注");
        return query;
    }

    private static ClubCoopMerchantCardVO card() {
        ClubCoopMerchantCardVO card = new ClubCoopMerchantCardVO();
        card.setId(9L);
        card.setMemberId(88L);
        card.setName("河岸咖啡");
        card.setLogo("logo.png");
        card.setCoverImage("cover.png");
        card.setAddress("愚园路 1 号");
        card.setCategoryId(3);
        card.setCoopOpen(1);
        card.setSuitActivityTypes("城市漫步");
        return card;
    }

    private static String readMapper() throws Exception {
        Path path = Paths.get("..", "chengyinhub-system", "src", "main", "resources",
                "mapper", "business", "MmsMerchantMapper.xml");
        return new String(Files.readAllBytes(path), StandardCharsets.UTF_8).toLowerCase().replaceAll("\\s+", " ");
    }

    private static String cardQuery(String mapper) {
        int start = mapper.indexOf("id=\"selectclubcoopmerchantcards\"");
        assertTrue(start >= 0);
        int end = mapper.indexOf("</select>", start);
        return mapper.substring(start, end);
    }
}
