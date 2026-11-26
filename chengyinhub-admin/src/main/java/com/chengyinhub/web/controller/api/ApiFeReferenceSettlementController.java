package com.chengyinhub.web.controller.api;

import com.chengyinhub.business.access.merchant.IMerchantAccessService;
import com.chengyinhub.business.access.merchant.MerchantPermission;
import com.chengyinhub.business.domain.vo.FeReferenceSettlementView;
import com.chengyinhub.business.service.IFeReferenceSettlementService;
import com.chengyinhub.business.service.support.FeReferenceSettlementCsv;
import com.chengyinhub.common.core.controller.BaseController;
import com.chengyinhub.common.core.domain.AjaxResult;
import com.chengyinhub.common.exception.ServiceException;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * F11 自由探索店铺参考结算(参考金额,不入余额;店铺与场次收款人线下结款)。
 *
 * <ul>
 *   <li>店铺读 / 提异议:商家身份由 {@link IMerchantAccessService} 解析到店铺 member_id,只看本店;</li>
 *   <li>收款人读 / 标记已线下结清:当前登录人必须是该场次的收款人(与结算入账同一规则)。</li>
 * </ul>
 */
@RestController
@RequestMapping("/api/fe/reference-settlement")
public class ApiFeReferenceSettlementController extends BaseController {

    private final IFeReferenceSettlementService service;
    private final IMerchantAccessService merchantAccess;

    public ApiFeReferenceSettlementController(IFeReferenceSettlementService service,
                                              IMerchantAccessService merchantAccess) {
        this.service = service;
        this.merchantAccess = merchantAccess;
    }

    @GetMapping("/merchant")
    public AjaxResult merchant(@RequestParam(required = false) String status,
                               @RequestParam(required = false) String from,
                               @RequestParam(required = false) String to) {
        try {
            Long owner = merchantAccess.require(getAppUserId(), MerchantPermission.FINANCE_READ).getOwnerMemberId();
            return success(service.listForMerchant(owner, status, from, to));
        } catch (ServiceException e) {
            return failure(e);
        }
    }

    @GetMapping("/payer")
    public AjaxResult payer(@RequestParam(required = false) Long activityId,
                            @RequestParam(required = false) String from,
                            @RequestParam(required = false) String to) {
        try {
            return success(service.listForPayer(getAppUserId(), activityId, from, to));
        } catch (ServiceException e) {
            return failure(e);
        }
    }

    /** 店铺导出本店参考结算 CSV(与 /merchant 同一归属与筛选,同一条查询)。返回 {fileName, content}。 */
    @GetMapping("/merchant/export")
    public AjaxResult merchantExport(@RequestParam(required = false) String status,
                                     @RequestParam(required = false) String from,
                                     @RequestParam(required = false) String to) {
        try {
            Long owner = merchantAccess.require(getAppUserId(), MerchantPermission.FINANCE_READ).getOwnerMemberId();
            return success(csv(service.listForMerchant(owner, status, from, to), from, to));
        } catch (ServiceException e) {
            return failure(e);
        }
    }

    /** 场次收款人导出本人各场参考结算 CSV(与 /payer 同一归属与筛选,同一条查询)。 */
    @GetMapping("/payer/export")
    public AjaxResult payerExport(@RequestParam(required = false) Long activityId,
                                  @RequestParam(required = false) String from,
                                  @RequestParam(required = false) String to) {
        try {
            return success(csv(service.listForPayer(getAppUserId(), activityId, from, to), from, to));
        } catch (ServiceException e) {
            return failure(e);
        }
    }

    private static Map<String, Object> csv(FeReferenceSettlementView view, String from, String to) {
        Map<String, Object> out = new LinkedHashMap<>();
        // from / to 已由 service 校验为 yyyy-MM-dd 或空,可直接进文件名
        String range = (from == null || from.trim().isEmpty() ? "" : "-" + from.trim())
                + (to == null || to.trim().isEmpty() ? "" : "-" + to.trim());
        out.put("fileName", "fe-reference-settlement" + range + ".csv");
        out.put("content", FeReferenceSettlementCsv.of(view));
        return out;
    }

    /** 收款人标记已线下结清 {ids[], voucherNo?, note?}。 */
    @PostMapping("/settle")
    public AjaxResult settle(@RequestBody(required = false) Map<String, Object> body) {
        try {
            Map<String, Object> request = body == null ? Collections.emptyMap() : body;
            int changed = service.settle(getAppUserId(), ids(request.get("ids")),
                    text(request.get("voucherNo")), text(request.get("note")));
            return success(Collections.singletonMap("settledCount", changed));
        } catch (ServiceException e) {
            return failure(e);
        }
    }

    /** 店铺对一行提出异议 {id, note}。 */
    @PostMapping("/dispute")
    public AjaxResult dispute(@RequestBody(required = false) Map<String, Object> body) {
        try {
            Map<String, Object> request = body == null ? Collections.emptyMap() : body;
            Long owner = merchantAccess.require(getAppUserId(), MerchantPermission.FINANCE_READ).getOwnerMemberId();
            service.dispute(owner, id(request.get("id")), text(request.get("note")));
            return success();
        } catch (ServiceException e) {
            return failure(e);
        }
    }

    /** 权益卡表单里的线下结算说明(服务端下发,含主办方名);非自由探索章节返回 text=null。 */
    @GetMapping("/note")
    public AjaxResult note(@RequestParam Long chapterId) {
        try {
            getAppUserId();
            return success(service.chapterFormSettlement(chapterId));
        } catch (ServiceException e) {
            return failure(e);
        }
    }

    private AjaxResult failure(ServiceException e) {
        return e.getCode() == null ? error(e.getMessage()) : new AjaxResult(e.getCode(), e.getMessage());
    }

    private static List<Long> ids(Object raw) {
        if (!(raw instanceof List)) throw new ServiceException("请选择要标记的账目");
        List<Long> ids = new ArrayList<>();
        for (Object value : (List<?>) raw) ids.add(id(value));
        return ids;
    }

    private static Long id(Object value) {
        if (value instanceof Number && ((Number) value).longValue() == ((Number) value).doubleValue()) {
            return ((Number) value).longValue();
        }
        if (value instanceof String && ((String) value).matches("\\d{1,18}")) return Long.valueOf((String) value);
        throw new ServiceException("账目编号无效");
    }

    private static String text(Object value) {
        if (value == null) return null;
        if (!(value instanceof String)) throw new ServiceException("参数格式不正确");
        return (String) value;
    }
}
