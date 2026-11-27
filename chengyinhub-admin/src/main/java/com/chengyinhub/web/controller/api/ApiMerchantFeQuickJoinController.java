package com.chengyinhub.web.controller.api;

import com.chengyinhub.business.access.merchant.IMerchantAccessService;
import com.chengyinhub.business.access.merchant.MerchantAccessContext;
import com.chengyinhub.business.access.merchant.MerchantPermission;
import com.chengyinhub.business.domain.dto.MerchantFeQuickJoinDTO;
import com.chengyinhub.business.service.IMerchantFeQuickJoinService;
import com.chengyinhub.business.service.IUmsMemberService;
import com.chengyinhub.business.service.IWxContentSecurityService;
import com.chengyinhub.common.core.controller.BaseController;
import com.chengyinhub.common.core.domain.AjaxResult;
import com.chengyinhub.common.exception.ServiceException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * §4.3 商家 5 分钟 4 字段快速加入自由探索接口。
 *
 * <p>严格执行登录态、商家权限（COOP_MANAGE + PROJECT_MANAGE）、Owner 归属与内容机审校验。
 */
@RestController
@Tag(name = "自由探索商家快速加入")
@RequestMapping("/api/merchant/fe")
public class ApiMerchantFeQuickJoinController extends BaseController {

    @Autowired
    private IMerchantAccessService merchantAccessService;

    @Autowired
    private IMerchantFeQuickJoinService quickJoinService;

    @Autowired(required = false)
    private IWxContentSecurityService wxContentSecurityService;

    @Autowired(required = false)
    private IUmsMemberService umsMemberService;

    @Operation(summary = "商家 4 字段白话快速加入自由探索章节")
    @PostMapping("/quick-join")
    public AjaxResult quickJoin(@RequestBody(required = false) MerchantFeQuickJoinDTO body) {
        Long principalMemberId = currentMemberId();
        if (principalMemberId == null || principalMemberId <= 0) {
            return error("请先登录");
        }
        if (body == null) {
            return error("参数为空");
        }
        MerchantAccessContext access;
        try {
            access = merchantAccessService.require(principalMemberId, MerchantPermission.COOP_MANAGE);
            merchantAccessService.require(principalMemberId, MerchantPermission.PROJECT_MANAGE);
        } catch (ServiceException e) {
            return new AjaxResult(e.getCode() == null ? 403 : e.getCode(), e.getMessage());
        }
        if (access == null || access.getOwnerMemberId() == null || access.getOwnerMemberId() <= 0) {
            return error("仅认证商家可快速加入");
        }
        String text = IWxContentSecurityService.joinText(body.getPerkDescription(), body.getOffPeakHours());
        if (text != null && !text.trim().isEmpty() && wxContentSecurityService != null) {
            String risk = IWxContentSecurityService.checkTextAsMember(
                    wxContentSecurityService, umsMemberService, principalMemberId, text);
            if (risk != null) {
                return error(risk);
            }
        }
        try {
            return AjaxResult.success("已提交", quickJoinService.quickJoin(access.getOwnerMemberId(), body));
        } catch (IllegalStateException | IllegalArgumentException e) {
            return error(e.getMessage());
        }
    }

    private Long currentMemberId() {
        try {
            return getAppUserId();
        } catch (Exception e) {
            return null;
        }
    }
}
