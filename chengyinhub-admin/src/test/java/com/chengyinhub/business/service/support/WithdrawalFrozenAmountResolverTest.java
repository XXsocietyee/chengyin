package com.chengyinhub.business.service.support;

import com.chengyinhub.business.domain.UmsMemberSettlementDebt;
import com.chengyinhub.business.mapper.MerchantReferralBountyMapper;
import com.chengyinhub.business.mapper.PlayerWithdrawalCooldownMapper;
import com.chengyinhub.business.mapper.UmsMemberSettlementDebtMapper;
import com.chengyinhub.business.service.IPlayerWithdrawalCooldownService;
import com.chengyinhub.business.service.impl.MerchantReferralBountyService;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.test.util.ReflectionTestUtils;

import java.math.BigDecimal;
import java.util.Arrays;
import java.util.Collections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** 未清结算欠款的未抵扣余额要从可提现额里留住；已抵扣或已结清的不能再冻一次。 */
class WithdrawalFrozenAmountResolverTest {

    private static final long MEMBER = 7L;

    @Test
    void openDebtReducesWithdrawableAmountAndClosedOrRepaidDebtDoesNot() {
        MerchantReferralBountyService bounty = mock(MerchantReferralBountyService.class);
        IPlayerWithdrawalCooldownService cooldown = mock(IPlayerWithdrawalCooldownService.class);
        when(bounty.frozenAmount(MEMBER)).thenReturn(new BigDecimal("10.00"));
        when(cooldown.frozenAmount(MEMBER)).thenReturn(BigDecimal.ZERO);
        MerchantReferralBountyMapper bountyMapper = mock(MerchantReferralBountyMapper.class);
        PlayerWithdrawalCooldownMapper cooldownMapper = mock(PlayerWithdrawalCooldownMapper.class);
        UmsMemberSettlementDebtMapper debtMapper = mock(UmsMemberSettlementDebtMapper.class);
        when(bountyMapper.selectFrozenAmountsForUpdate(eq(MEMBER), any()))
                .thenReturn(Collections.singletonList(new BigDecimal("10.00")));
        when(cooldownMapper.selectUnexpiredAmountsForUpdate(MEMBER)).thenReturn(Collections.emptyList());
        when(debtMapper.selectOpenByMemberForUpdate(MEMBER)).thenReturn(Arrays.asList(
                debt(0, "80.00", "30.00"),
                debt(1, "70.00", "0.00"),
                debt(0, "40.00", "40.00")));
        WithdrawalFrozenAmountResolver resolver = resolver(bounty, cooldown, bountyMapper, cooldownMapper, debtMapper);

        WithdrawalFrozenAmountResolver.Frozen preview = resolver.resolve(MEMBER);
        WithdrawalFrozenAmountResolver.Frozen locked = resolver.resolveForWithdrawal(MEMBER);

        assertEquals(new BigDecimal("50.00"), preview.getSettlementDebt());
        assertEquals(new BigDecimal("60.00"), preview.total());
        assertEquals(preview.total(), locked.total());
        assertEquals(new BigDecimal("40.00"), new BigDecimal("100.00").subtract(locked.total()));
        assertEquals(0, preview.getSettlementDebt().compareTo(new BigDecimal("80.00").subtract(new BigDecimal("30.00"))));
        verify(debtMapper, org.mockito.Mockito.times(2)).selectOpenByMemberForUpdate(MEMBER);
        org.mockito.Mockito.clearInvocations(bountyMapper, cooldownMapper, debtMapper);
        resolver.resolveForWithdrawal(MEMBER);
        InOrder order = inOrder(bountyMapper, cooldownMapper, debtMapper);
        order.verify(bountyMapper).selectFrozenAmountsForUpdate(eq(MEMBER), any());
        order.verify(cooldownMapper).selectUnexpiredAmountsForUpdate(MEMBER);
        order.verify(debtMapper).selectOpenByMemberForUpdate(MEMBER);
    }

    @Test
    void missingDebtReadFailsClosedAndNullMemberDoesNotQuery() {
        MerchantReferralBountyService bounty = mock(MerchantReferralBountyService.class);
        IPlayerWithdrawalCooldownService cooldown = mock(IPlayerWithdrawalCooldownService.class);
        MerchantReferralBountyMapper bountyMapper = mock(MerchantReferralBountyMapper.class);
        PlayerWithdrawalCooldownMapper cooldownMapper = mock(PlayerWithdrawalCooldownMapper.class);
        UmsMemberSettlementDebtMapper debtMapper = mock(UmsMemberSettlementDebtMapper.class);
        when(bountyMapper.selectFrozenAmountsForUpdate(eq(MEMBER), any())).thenReturn(Collections.emptyList());
        when(cooldownMapper.selectUnexpiredAmountsForUpdate(MEMBER)).thenReturn(Collections.emptyList());
        when(debtMapper.selectOpenByMemberForUpdate(MEMBER)).thenReturn(null);
        WithdrawalFrozenAmountResolver resolver = resolver(bounty, cooldown, bountyMapper, cooldownMapper, debtMapper);

        assertThrows(IllegalStateException.class, () -> resolver.resolveForWithdrawal(MEMBER));
        assertEquals(BigDecimal.ZERO, resolver.resolve(null).total());
        verify(debtMapper, never()).selectOpenByMemberForUpdate(null);
    }

    private static WithdrawalFrozenAmountResolver resolver(MerchantReferralBountyService bounty,
            IPlayerWithdrawalCooldownService cooldown, MerchantReferralBountyMapper bountyMapper,
            PlayerWithdrawalCooldownMapper cooldownMapper, UmsMemberSettlementDebtMapper debtMapper) {
        WithdrawalFrozenAmountResolver resolver = new WithdrawalFrozenAmountResolver(bounty, cooldown);
        ReflectionTestUtils.setField(resolver, "bountyMapper", bountyMapper);
        ReflectionTestUtils.setField(resolver, "cooldownMapper", cooldownMapper);
        ReflectionTestUtils.setField(resolver, "debtMapper", debtMapper);
        return resolver;
    }

    private static UmsMemberSettlementDebt debt(int status, String amount, String repaid) {
        UmsMemberSettlementDebt debt = new UmsMemberSettlementDebt();
        debt.setStatus(status);
        debt.setAmount(new BigDecimal(amount));
        debt.setRepaidAmount(new BigDecimal(repaid));
        return debt;
    }
}
