package com.chengyinhub.web.controller.api;

import com.chengyinhub.business.service.IAdvancedGameRuntimeService;
import com.chengyinhub.common.core.domain.AjaxResult;
import com.chengyinhub.common.utils.UserSafeMessage;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 审计 1122 C1：通用 catch 不得把内部异常文本（SQL、类名、空消息）直接回给玩家；业务中文短句照旧可见。
 */
class ApiAdvancedPlayInternalErrorMaskingTest {

    private IAdvancedGameRuntimeService runtimeService;
    private ApiAdvancedPlayController controller;

    @BeforeEach
    void setUp() {
        runtimeService = mock(IAdvancedGameRuntimeService.class);
        controller = new ApiAdvancedPlayController() {
            @Override
            public Long getAppUserId() {
                return 7L;
            }
        };
        ReflectionTestUtils.setField(controller, "runtimeService", runtimeService);
    }

    @Test
    void databaseErrorTextIsReplacedWithStableMessage() {
        when(runtimeService.state(anyLong(), anyLong())).thenThrow(new RuntimeException(
                "Error querying database. Cause: java.sql.SQLSyntaxErrorException: Unknown column 'secret_col'"));

        AjaxResult r = controller.state("9");

        assertEquals(UserSafeMessage.GENERIC, r.get("msg"));
        assertFalse(r.toString().contains("secret_col"));
    }

    @Test
    void nullMessageNeverShowsNull() {
        when(runtimeService.state(anyLong(), anyLong())).thenThrow(new NullPointerException());

        AjaxResult r = controller.state("9");

        assertEquals(UserSafeMessage.GENERIC, r.get("msg"));
    }

    @Test
    void businessRefusalTextStaysVisible() {
        when(runtimeService.state(anyLong(), anyLong())).thenThrow(new IllegalStateException("本局已结束"));

        AjaxResult r = controller.state("9");

        assertEquals("本局已结束", r.get("msg"));
    }
}
