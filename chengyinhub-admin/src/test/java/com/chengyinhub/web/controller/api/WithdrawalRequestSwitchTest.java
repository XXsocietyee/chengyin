package com.chengyinhub.web.controller.api;

import com.chengyinhub.business.domain.dto.WithdrawalDTO;
import com.chengyinhub.business.service.IBankWithdrawalCommandService;
import com.chengyinhub.business.service.IRoleService;
import com.chengyinhub.business.service.IUmsMemberService;
import com.chengyinhub.business.service.IUmsMemberWithdrawalService;
import com.chengyinhub.common.core.domain.AjaxResult;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.config.YamlPropertiesFactoryBean;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.core.io.ClassPathResource;
import org.springframework.test.util.ReflectionTestUtils;

import java.lang.reflect.Field;
import java.util.HashMap;
import java.util.Map;
import java.util.Properties;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * 审计 1122 BE1：{@code withdrawal.request.enabled} 默认关闭。关闭时新提现申请在进入任何资金服务前被拒，
 * 且提示明确；已有提现的撤回不受开关影响。
 */
class WithdrawalRequestSwitchTest {

    private static final String KEY = "withdrawal.request.enabled";

    private static String expression() throws Exception {
        Field f = ApiWithdrawalController.class.getDeclaredField("requestEnabled");
        return f.getAnnotation(Value.class).value();
    }

    private static boolean resolvedDefault() throws Exception {
        return Boolean.parseBoolean(new StandardEnvironment().resolvePlaceholders(expression()));
    }

    @Test
    void defaultsToOffWithNoConfigAndPackagedYamlDoesNotTurnItOn() throws Exception {
        assertEquals("${" + KEY + ":false}", expression());
        assertFalse(resolvedDefault());

        YamlPropertiesFactoryBean yaml = new YamlPropertiesFactoryBean();
        yaml.setResources(new ClassPathResource("application.yml"));
        Properties props = yaml.getObject();
        assertFalse(props.containsKey(KEY), "打包的 application.yml 不得配置 " + KEY);
        StandardEnvironment env = new StandardEnvironment();
        Map<String, Object> map = new HashMap<>();
        props.forEach((k, v) -> map.put(String.valueOf(k), v));
        env.getPropertySources().addFirst(new MapPropertySource("packaged", map));
        assertEquals("false", env.resolvePlaceholders(expression()));
    }

    @Test
    void newRequestIsRefusedWithClearMessageBeforeAnyServiceAtTheDefault() throws Exception {
        ApiWithdrawalController c = new ApiWithdrawalController();
        IBankWithdrawalCommandService command = mock(IBankWithdrawalCommandService.class);
        IUmsMemberService members = mock(IUmsMemberService.class);
        IRoleService roles = mock(IRoleService.class);
        ReflectionTestUtils.setField(c, "bankWithdrawalCommandService", command);
        ReflectionTestUtils.setField(c, "umsMemberService", members);
        ReflectionTestUtils.setField(c, "roleService", roles);
        ReflectionTestUtils.setField(c, "requestEnabled", resolvedDefault());

        AjaxResult r = c.request(new WithdrawalDTO());

        assertNotEquals(200, r.get("code"));
        assertEquals(ApiWithdrawalController.REQUESTS_CLOSED_MESSAGE, r.get("msg"));
        verifyNoInteractions(command, members, roles);
    }

    @Test
    void enabledSwitchDoesNotShortCircuitTheExistingFlow() {
        ApiWithdrawalController c = new ApiWithdrawalController();
        IBankWithdrawalCommandService command = mock(IBankWithdrawalCommandService.class);
        ReflectionTestUtils.setField(c, "bankWithdrawalCommandService", command);
        ReflectionTestUtils.setField(c, "requestEnabled", true);

        // 无登录上下文：开关打开时照旧走原有的登录校验，而不是开关提示。
        AjaxResult r = c.request(new WithdrawalDTO());

        assertNotEquals(ApiWithdrawalController.REQUESTS_CLOSED_MESSAGE, r.get("msg"));
        verify(command, never()).submit(any(), anyLong(), anyString());
    }

    @Test
    void withdrawingAnExistingPendingRequestIsNotGatedBySwitch() {
        ApiWithdrawalController c = new ApiWithdrawalController();
        IUmsMemberWithdrawalService withdrawals = mock(IUmsMemberWithdrawalService.class);
        when(withdrawals.withdrawPendingByMember(anyLong(), anyLong())).thenReturn(1);
        ReflectionTestUtils.setField(c, "umsMemberWithdrawalService", withdrawals);
        ReflectionTestUtils.setField(c, "requestEnabled", false);

        // 未登录时撤回仍按原逻辑提示登录，从不出现开关提示。
        AjaxResult r = c.withdrawalDelete("5");
        assertNotEquals(ApiWithdrawalController.REQUESTS_CLOSED_MESSAGE, r.get("msg"));
    }
}
