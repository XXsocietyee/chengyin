package com.chengyinhub.web.controller.business;

import com.chengyinhub.business.domain.dto.ChannelVoucherRevokeRequest;
import com.chengyinhub.business.domain.dto.PlatformCodeIssueRequest;
import com.chengyinhub.business.exception.ChannelVoucherException;
import com.chengyinhub.business.service.IPlatformCodeService;
import com.chengyinhub.common.annotation.Log;
import com.chengyinhub.common.core.controller.BaseController;
import com.chengyinhub.common.core.domain.AjaxResult;
import com.chengyinhub.common.enums.BusinessType;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 平台自发兑换码管理端：发码（批次）、列表、撤销。开关 {@code channel.platform-issued.enabled} 默认关闭。
 *
 * <p>沿用渠道码的权限串（issue/list/revoke），默认不授任何角色。发码响应含一次性明文，
 * 操作日志不落响应体（isSaveResponseData=false）。
 */
@RestController
@RequestMapping("/business/marketing/channel/platform-codes")
public class PlatformCodeAdminController extends BaseController {

    private final IPlatformCodeService platformCodeService;

    public PlatformCodeAdminController(IPlatformCodeService platformCodeService) {
        this.platformCodeService = platformCodeService;
    }

    @PreAuthorize("@ss.hasPermi('business:marketing:channel:issue')")
    @Log(title = "平台兑换码发行", businessType = BusinessType.INSERT, isSaveResponseData = false)
    @PostMapping
    public AjaxResult issue(@RequestBody(required = false) PlatformCodeIssueRequest request) {
        return success(platformCodeService.issue(requireOperator(), request));
    }

    @PreAuthorize("@ss.hasPermi('business:marketing:channel:list')")
    @GetMapping
    public AjaxResult list(@RequestParam(required = false) String batchNo,
                           @RequestParam(required = false) Integer status,
                           @RequestParam(required = false, defaultValue = "50") Integer limit) {
        return success(platformCodeService.list(requireOperator(), batchNo, status, limit == null ? 50 : limit));
    }

    @PreAuthorize("@ss.hasPermi('business:marketing:channel:revoke')")
    @Log(title = "平台兑换码撤销", businessType = BusinessType.UPDATE)
    @PostMapping("/{voucherId}/revoke")
    public AjaxResult revoke(@PathVariable Long voucherId,
                             @RequestBody(required = false) ChannelVoucherRevokeRequest request) {
        return success(platformCodeService.revoke(requireOperator(), voucherId, request));
    }

    @ExceptionHandler(ChannelVoucherException.class)
    public AjaxResult handleRejection(ChannelVoucherException rejection) {
        AjaxResult result = AjaxResult.error(rejection.getHttpStatus(), rejection.getMessage());
        result.put("reasonCode", rejection.getReasonCode());
        return result;
    }

    private long requireOperator() {
        Long userId = getUserId();
        if (userId == null || userId <= 0) {
            throw ChannelVoucherException.unauthorized("LOGIN_REQUIRED", "请先登录管理端");
        }
        return userId;
    }
}
