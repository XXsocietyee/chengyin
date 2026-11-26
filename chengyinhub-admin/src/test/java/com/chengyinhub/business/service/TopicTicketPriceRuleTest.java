package com.chengyinhub.business.service;

import com.chengyinhub.business.domain.OmsTicket;
import com.chengyinhub.business.domain.dto.ActivityTicketRequest;
import com.chengyinhub.business.mapper.OmsTicketMapper;
import com.chengyinhub.business.service.impl.CmsTopicServiceImpl;
import com.chengyinhub.business.support.OmsTicketWriteValidator;
import com.chengyinhub.common.exception.ServiceException;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.math.BigDecimal;
import java.util.Collections;
import java.util.Date;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * L03-058 / L03-050(业主 2026-11-24 默认 A):主题票价规则由服务端把关 ——
 * 不能为负、最多两位小数、不超过 99999.99;不替作者四舍五入,超位直接拒收。
 * 草稿和发布两条写票路径、以及自玩票价格都走同一条规则。
 */
class TopicTicketPriceRuleTest {

    @Test
    void validatorAcceptsTwoDecimalsZeroAndTheCap() {
        assertDoesNotThrow(() -> OmsTicketWriteValidator.validateTopicPrice(null, "票价"));
        assertDoesNotThrow(() -> OmsTicketWriteValidator.validateTopicPrice(BigDecimal.ZERO, "票价"));
        assertDoesNotThrow(() -> OmsTicketWriteValidator.validateTopicPrice(new BigDecimal("12.50"), "票价"));
        assertDoesNotThrow(() -> OmsTicketWriteValidator.validateTopicPrice(new BigDecimal("12.5000"), "票价"));
        assertDoesNotThrow(() -> OmsTicketWriteValidator.validateTopicPrice(new BigDecimal("99999.99"), "票价"));
    }

    @Test
    void validatorRejectsThirdDecimalNegativeAndOverCapWithoutRounding() {
        ServiceException scale = assertThrows(ServiceException.class,
                () -> OmsTicketWriteValidator.validateTopicPrice(new BigDecimal("12.345"), "票价"));
        assertEquals("票价最多两位小数", scale.getMessage());
        assertEquals(400, scale.getCode());
        ServiceException cap = assertThrows(ServiceException.class,
                () -> OmsTicketWriteValidator.validateTopicPrice(new BigDecimal("100000"), "票价"));
        assertEquals("票价不能超过 99999.99", cap.getMessage());
        ServiceException negative = assertThrows(ServiceException.class,
                () -> OmsTicketWriteValidator.validateTopicPrice(new BigDecimal("-0.01"), "自玩票价格"));
        assertEquals("自玩票价格不能为负数", negative.getMessage());
    }

    @Test
    void topicDraftSaveRejectsThreeDecimalPriceBeforeWritingTicket() {
        OmsTicketMapper ticketMapper = mock(OmsTicketMapper.class);
        CmsTopicServiceImpl service = new CmsTopicServiceImpl();
        ReflectionTestUtils.setField(service, "omsTicketMapper", ticketMapper);
        ActivityTicketRequest ticket = validTicket();
        ticket.setPrice(new BigDecimal("12.345"));

        ServiceException ex = assertThrows(ServiceException.class, () -> ReflectionTestUtils.invokeMethod(
                service, "saveTickets", Collections.singletonList(ticket), 801L, 88L, "creator", 1, true));

        assertEquals("票价最多两位小数", ex.getMessage());
        verify(ticketMapper, never()).insertOmsTicket(any());
    }

    @Test
    void topicPublishRejectsOverCapPriceBeforeWritingTicket() {
        OmsTicketMapper ticketMapper = mock(OmsTicketMapper.class);
        CmsTopicServiceImpl service = new CmsTopicServiceImpl();
        ReflectionTestUtils.setField(service, "omsTicketMapper", ticketMapper);
        ActivityTicketRequest ticket = validTicket();
        ticket.setPrice(new BigDecimal("100000.00"));

        ServiceException ex = assertThrows(ServiceException.class, () -> ReflectionTestUtils.invokeMethod(
                service, "saveTickets", Collections.singletonList(ticket), 802L, 88L, "creator", 1, false));

        assertEquals(400, ex.getCode());
        verify(ticketMapper, never()).insertOmsTicket(any());
    }

    @Test
    void topicPublishKeepsTwoDecimalPriceExactly() {
        OmsTicketMapper ticketMapper = mock(OmsTicketMapper.class);
        CmsTopicServiceImpl service = new CmsTopicServiceImpl();
        ReflectionTestUtils.setField(service, "omsTicketMapper", ticketMapper);
        ActivityTicketRequest ticket = validTicket();
        ticket.setPrice(new BigDecimal("39.90"));

        ReflectionTestUtils.invokeMethod(
                service, "saveTickets", Collections.singletonList(ticket), 803L, 88L, "creator", 1, false);

        ArgumentCaptor<OmsTicket> written = ArgumentCaptor.forClass(OmsTicket.class);
        verify(ticketMapper).insertOmsTicket(written.capture());
        assertEquals(new BigDecimal("39.90"), written.getValue().getPrice());
    }

    private static ActivityTicketRequest validTicket() {
        ActivityTicketRequest ticket = new ActivityTicketRequest();
        ticket.setName("标准票");
        ticket.setPrice(BigDecimal.TEN);
        ticket.setTotalStock(10);
        ticket.setStartTime(new Date(1_800_000_000_000L));
        ticket.setEndTime(new Date(1_800_003_600_000L));
        return ticket;
    }
}
