package com.chengyinhub.business.service;

import com.chengyinhub.business.domain.CmsActivity;
import com.chengyinhub.business.domain.CmsRegistration;
import com.chengyinhub.business.domain.GiftPlayFact;
import com.chengyinhub.business.domain.RegistrationSeatInvitation;
import com.chengyinhub.business.domain.RegistrationSeatInvitationRequestRecord;
import com.chengyinhub.business.domain.dto.SeatInvitationActionRequest;
import com.chengyinhub.business.domain.dto.SeatInvitationClaimRequest;
import com.chengyinhub.business.domain.dto.SeatInvitationCreateRequest;
import com.chengyinhub.business.domain.dto.SeatPhoneTransferRequest;
import com.chengyinhub.business.domain.UmsMember;
import com.chengyinhub.business.mapper.UmsMemberMapper;
import com.chengyinhub.business.service.support.SeatPhoneTransferCodec;
import com.chengyinhub.business.domain.vo.SeatInvitationOwnerViewVO;
import com.chengyinhub.business.domain.vo.SeatInvitationVO;
import com.chengyinhub.business.mapper.CmsActivityMapper;
import com.chengyinhub.business.mapper.CmsRegistrationMapper;
import com.chengyinhub.business.mapper.CmsTopicMapper;
import com.chengyinhub.business.mapper.RegistrationSeatInvitationMapper;
import com.chengyinhub.business.mapper.RegistrationSeatInvitationRequestMapper;
import com.chengyinhub.business.service.impl.RegistrationSeatInvitationServiceImpl;
import com.chengyinhub.business.service.support.SeatInvitationTokenCodec;
import com.chengyinhub.common.exception.ServiceException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Date;
import com.chengyinhub.business.mapper.RegistrationSeatMapper;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * DEC-F12 B 按手机号转赠席位:只有购票人可写、号码只存盲索引与脱敏号、领取只认账号已验证手机号、
 * 一席只能被领一次、购票人不能领自己的转赠、原单退款后待领取与已领取一起失效(沿用整单退款口径)。
 * 纯 mock 验证调用方决策;真实唯一键/CAS 与新增 SQL 在 RegistrationSeatInvitationMySqlIT。
 */
class SeatPhoneTransferServiceTest {

    private UmsMemberMapper members;
    private final Map<Long, String> phones = new LinkedHashMap<>();

    private RegistrationSeatInvitationServiceImpl service;
    private CmsRegistrationMapper registrations;
    private CmsActivityMapper activities;
    private CmsTopicMapper topics;
    private RegistrationSeatMapper seatFacts;
    private RegistrationSeatInvitationMapper invitations;
    private RegistrationSeatInvitationRequestMapper requestRecords;
    private IMarketingGiftPlayEligibility gift;

    private final Map<Long, RegistrationSeatInvitation> rows = new LinkedHashMap<>();
    private final Map<String, RegistrationSeatInvitationRequestRecord> byRequest =
            java.util.Collections.synchronizedMap(new LinkedHashMap<>());
    private final Set<Long> used = new LinkedHashSet<>();
    private final AtomicLong ids = new AtomicLong(500);
    private CmsRegistration order;
    private CmsActivity activity;

    @BeforeEach
    void setup() {
        topics = mock(CmsTopicMapper.class);
        seatFacts = mock(RegistrationSeatMapper.class);
        registrations = mock(CmsRegistrationMapper.class);
        activities = mock(CmsActivityMapper.class);
        topics = mock(CmsTopicMapper.class);
        invitations = mock(RegistrationSeatInvitationMapper.class);
        requestRecords = mock(RegistrationSeatInvitationRequestMapper.class);
        gift = mock(IMarketingGiftPlayEligibility.class);

        order = new CmsRegistration();
        order.setId(31L); order.setOwnerType(2L); order.setOwnerId(61L); order.setMemberId(51L);
        order.setOrderNum(3L); order.setRegistrationStatus(2); order.setPaymentStatus(2);
        order.setPurchaseKind(1);
        activity = new CmsActivity();
        activity.setId(61L); activity.setTopicId(41L); activity.setDelFlag(0);
        activity.setEndDate(new Date(System.currentTimeMillis() + 86_400_000L));

        when(registrations.selectCmsRegistrationById(31L)).thenReturn(order);
        when(registrations.selectCmsRegistrationByIdForUpdate(31L)).thenReturn(order);
        when(registrations.hasActiveManualRefundCaseForUpdate(31L)).thenReturn(false);
        when(activities.selectCmsActivityByIdForUpdate(61L)).thenReturn(activity);
        when(activities.selectCmsActivityById(61L)).thenReturn(activity);
        when(gift.playFacts(anyLong(), anyLong(), anyLong())).thenReturn(List.of());
        when(invitations.hasOriginalUseFacts(anyLong(), anyLong(), anyLong()))
                .thenAnswer(call -> used.contains(call.getArgument(0, Long.class)));

        when(requestRecords.selectByRequestId(anyLong(), anyString()))
                .thenAnswer(call -> byRequest.get(ledgerKey(
                        call.getArgument(0, Long.class), call.getArgument(1, String.class))));
        when(requestRecords.selectByRequestIdForUpdate(anyLong(), anyString()))
                .thenAnswer(call -> byRequest.get(ledgerKey(
                        call.getArgument(0, Long.class), call.getArgument(1, String.class))));
        doAnswer(call -> {
            RegistrationSeatInvitationRequestRecord record = call.getArgument(0);
            byRequest.put(ledgerKey(record.getMemberId(), record.getRequestId()), record);
            return 1;
        }).when(requestRecords).insert(any());
        when(invitations.countClaimedByRecipient(anyLong(), anyLong())).thenAnswer(call -> {
            long registrationId = call.getArgument(0, Long.class);
            long memberId = call.getArgument(1, Long.class);
            int count = 0;
            for (RegistrationSeatInvitation row : rows.values()) {
                if (row.getRegistrationId() != null && row.getRegistrationId() == registrationId
                        && Integer.valueOf(RegistrationSeatInvitation.STATUS_CLAIMED).equals(row.getStatus())
                        && row.getInviteeMemberId() != null && row.getInviteeMemberId() == memberId) {
                    count++;
                }
            }
            return count;
        });

        when(invitations.insert(any())).thenAnswer(call -> {
            RegistrationSeatInvitation row = call.getArgument(0);
            row.setId(ids.incrementAndGet());
            rows.put(row.getId(), row);
            return 1;
        });
        when(invitations.selectById(anyLong()))
                .thenAnswer(call -> rows.get(call.getArgument(0, Long.class)));
        when(invitations.selectByIdForUpdate(anyLong()))
                .thenAnswer(call -> rows.get(call.getArgument(0, Long.class)));
        when(invitations.selectByTokenHash(anyString())).thenAnswer(call -> {
            String hash = call.getArgument(0, String.class);
            for (RegistrationSeatInvitation row : rows.values()) {
                if (hash.equals(row.getTokenHash())) return row;
            }
            return null;
        });
        when(invitations.selectByRegistration(anyLong()))
                .thenAnswer(call -> new ArrayList<>(rows.values()));
        when(invitations.selectActiveByRegistrationForUpdate(anyLong())).thenAnswer(call -> {
            List<RegistrationSeatInvitation> active = new ArrayList<>();
            for (RegistrationSeatInvitation row : rows.values()) if (row.active()) active.add(row);
            return active;
        });
        when(invitations.maxGeneration(anyLong(), anyInt())).thenAnswer(call -> {
            long registrationId = call.getArgument(0, Long.class);
            int seatNo = call.getArgument(1, Integer.class);
            int max = 0;
            for (RegistrationSeatInvitation row : rows.values()) {
                if (row.getRegistrationId() != null && row.getRegistrationId() == registrationId
                        && row.getSeatNo() != null && row.getSeatNo() == seatNo) {
                    max = Math.max(max, row.getGeneration() == null ? 0 : row.getGeneration());
                }
            }
            return max;
        });
        when(invitations.claim(anyLong(), anyLong(), any())).thenAnswer(call -> {
            RegistrationSeatInvitation row = rows.get(call.getArgument(0, Long.class));
            Date now = call.getArgument(2, Date.class);
            if (row == null || !row.pending() || row.getExpiresAt() == null || !row.getExpiresAt().after(now)) return 0;
            row.setStatus(RegistrationSeatInvitation.STATUS_CLAIMED);
            row.setInviteeMemberId(call.getArgument(1, Long.class));
            row.setClaimedAt(now);
            return 1;
        });
        when(invitations.transition(anyLong(), anyInt(), anyInt(), any())).thenAnswer(call -> {
            RegistrationSeatInvitation row = rows.get(call.getArgument(0, Long.class));
            int from = call.getArgument(1, Integer.class);
            if (row == null || row.getStatus() == null || row.getStatus() != from) return 0;
            row.setStatus(call.getArgument(2, Integer.class));
            row.setUpdateTime(call.getArgument(3, Date.class));
            return 1;
        });
        when(invitations.expirePending(anyLong(), any())).thenAnswer(call -> {
            Date now = call.getArgument(1, Date.class);
            int changed = 0;
            for (RegistrationSeatInvitation row : rows.values()) {
                if (row.pending() && row.getExpiresAt() != null && !row.getExpiresAt().after(now)) {
                    row.setStatus(RegistrationSeatInvitation.STATUS_EXPIRED);
                    changed++;
                }
            }
            return changed;
        });
        when(invitations.selectPendingByPhoneHash(anyString(), any())).thenAnswer(call -> {
            String hash = call.getArgument(0, String.class);
            Date now = call.getArgument(1, Date.class);
            List<RegistrationSeatInvitation> out = new ArrayList<>();
            for (RegistrationSeatInvitation row : rows.values()) {
                if (hash.equals(row.getRecipientPhoneHash()) && row.pending() && row.getExpiresAt().after(now)) out.add(row);
            }
            return out;
        });
        when(invitations.selectClaimedByRecipient(anyLong())).thenAnswer(call -> {
            long member = call.getArgument(0, Long.class);
            List<RegistrationSeatInvitation> out = new ArrayList<>();
            if (!Integer.valueOf(2).equals(order.getPaymentStatus())) return out; // 与 SQL 同口径:原单退款即消失
            for (RegistrationSeatInvitation row : rows.values()) {
                if (row.claimed() && row.getInviteeMemberId() != null && row.getInviteeMemberId() == member) out.add(row);
            }
            return out;
        });
        members = mock(UmsMemberMapper.class);
        when(members.selectUmsMemberById(anyLong())).thenAnswer(call -> {
            Long id = call.getArgument(0, Long.class);
            UmsMember m = new UmsMember();
            m.setId(id);
            m.setPhone(phones.get(id));
            return m;
        });
        phones.put(51L, "13900000051");
        service = new RegistrationSeatInvitationServiceImpl(registrations, activities, topics,
                seatFacts, invitations, requestRecords, gift, "test-secret", 24L);
        service.setMembers(members);
    }


    private String ledgerKey(Long memberId, String requestId) {
        return memberId + "|" + requestId;
    }

    @Test
    void buyerAssignsFreeSeatByPhoneAndOnlyHashAndMaskAreStored() {
        SeatInvitationVO v = service.transferByPhone(51L, transfer(null, "小王", "+86 138-0013-8000", "t-1"));
        assertEquals(Integer.valueOf(2), v.getSeatNo());
        assertEquals("PENDING", v.getStatusLabel());
        assertEquals("PHONE", v.getChannel());
        assertEquals("小王", v.getRecipientName());
        assertEquals("138****8000", v.getRecipientPhoneMasked());
        assertNull(v.getToken(), "转赠不发链接码");
        RegistrationSeatInvitation stored = rows.get(v.getInvitationId());
        assertEquals(SeatPhoneTransferCodec.hash("13800138000", "test-secret"), stored.getRecipientPhoneHash());
        assertEquals("138****8000", stored.getRecipientPhoneMasked());
        for (Object field : new Object[]{stored.getRecipientName(), stored.getRecipientPhoneHash(),
                stored.getRecipientPhoneMasked(), stored.getTokenHash()}) {
            assertNotEquals("13800138000", field);
        }
        assertFalse(transfer(2, "小王", "13800138000", "x").toString().contains("13800138000"), "请求 toString 不带手机号");

        SeatInvitationOwnerViewVO owner = service.ownerView(51L, 31L);
        assertEquals("138****8000", owner.getInvitations().get(0).getRecipientPhoneMasked());
        assertEquals("小王", owner.getInvitations().get(0).getRecipientName());
    }

    @Test
    void onlyOrderOwnerMayAssignOrRevoke() {
        ServiceException denied = assertThrows(ServiceException.class,
                () -> service.transferByPhone(99L, transfer(null, "小王", "13800138000", "t-x")));
        assertEquals(Integer.valueOf(403), denied.getCode());
        assertTrue(rows.isEmpty());

        SeatInvitationVO v = service.transferByPhone(51L, transfer(null, "小王", "13800138000", "t-2"));
        ServiceException revokeDenied = assertThrows(ServiceException.class,
                () -> service.cancel(99L, action(v.getInvitationId(), "c-x")));
        assertEquals(Integer.valueOf(403), revokeDenied.getCode());
        assertTrue(rows.get(v.getInvitationId()).pending());
        ServiceException readDenied = assertThrows(ServiceException.class, () -> service.ownerView(99L, 31L));
        assertEquals(Integer.valueOf(403), readDenied.getCode());
        // 受让人/他人按 id 查状态拿不到号码
        phones.put(99L, "13800138000");
        service.claimByVerifiedPhone(99L);
        SeatInvitationVO asInvitee = service.status(99L, v.getInvitationId());
        assertNull(asInvitee.getRecipientPhoneMasked());
        assertNull(asInvitee.getRecipientName());
    }

    @Test
    void invalidInputIsRejectedBeforeAnyWrite() {
        for (String bad : new String[]{"", "12345", "12800138000", "1380013800", "abc13800138000"}) {
            ServiceException e = assertThrows(ServiceException.class,
                    () -> service.transferByPhone(51L, transfer(null, "小王", bad, "t-bad")));
            assertEquals(Integer.valueOf(400), e.getCode());
        }
        assertEquals(Integer.valueOf(400), assertThrows(ServiceException.class,
                () -> service.transferByPhone(51L, transfer(null, " ", "13800138000", "t-noname"))).getCode());
        assertEquals(Integer.valueOf(400), assertThrows(ServiceException.class,
                () -> service.transferByPhone(51L, transfer(null, "一二三四五六七八九十一二三四五六七八九十一", "13800138000", "t-long"))).getCode());
        assertEquals(Integer.valueOf(409), assertThrows(ServiceException.class,
                () -> service.transferByPhone(51L, transfer(1, "我", "13800138000", "t-seat1"))).getCode(), "第 1 席不可转赠");
        assertEquals(Integer.valueOf(409), assertThrows(ServiceException.class,
                () -> service.transferByPhone(51L, transfer(null, "我", "13900000051", "t-self"))).getCode(), "不能转给购票人自己的号");
        assertTrue(rows.isEmpty());
    }

    @Test
    void onePendingPerSeatRevokeThenChangeAndCapacityHolds() {
        SeatInvitationVO a = service.transferByPhone(51L, transfer(2, "小王", "13800138000", "t-a"));
        assertEquals(Integer.valueOf(409), assertThrows(ServiceException.class,
                () -> service.transferByPhone(51L, transfer(2, "小李", "13800138001", "t-b"))).getCode(), "同席只能一个待领取");
        assertEquals(Integer.valueOf(409), assertThrows(ServiceException.class,
                () -> service.transferByPhone(51L, transfer(3, "小王", "13800138000", "t-dup"))).getCode(), "同一号码本单只占一席");
        service.transferByPhone(51L, transfer(3, "小李", "13800138001", "t-c"));
        assertEquals(Integer.valueOf(409), assertThrows(ServiceException.class,
                () -> service.transferByPhone(51L, transfer(null, "小张", "13800138002", "t-full"))).getCode(), "不超过席位数");
        service.cancel(51L, action(a.getInvitationId(), "c-a"));
        SeatInvitationVO changed = service.transferByPhone(51L, transfer(2, "小张", "13800138002", "t-d"));
        assertEquals(Integer.valueOf(2), changed.getSeatNo());
        assertEquals(Integer.valueOf(2), changed.getGeneration());
        phones.put(99L, "13800138000");
        assertTrue(service.claimByVerifiedPhone(99L).isEmpty(), "撤回后原号码领不到");
    }

    @Test
    void verifiedPhoneClaimsOnceIdempotentlyAndMissingPhoneIsIgnored() {
        SeatInvitationVO v = service.transferByPhone(51L, transfer(null, "小王", "13800138000", "t-e"));
        assertTrue(service.claimByVerifiedPhone(99L).isEmpty(), "账号没有已验证手机号:不领取");
        phones.put(99L, "13800138000");
        List<SeatInvitationVO> got = service.claimByVerifiedPhone(99L);
        assertEquals(1, got.size());
        assertEquals("CLAIMED", got.get(0).getStatusLabel());
        assertNull(got.get(0).getRecipientPhoneMasked(), "受让人视图不带号码");
        assertEquals(Long.valueOf(99L), rows.get(v.getInvitationId()).getInviteeMemberId());
        assertTrue(service.claimByVerifiedPhone(99L).isEmpty(), "再登录不重复领取");
        phones.put(100L, "13800138000");
        assertTrue(service.claimByVerifiedPhone(100L).isEmpty(), "一席不能被领两次");
        assertEquals(Long.valueOf(99L), rows.get(v.getInvitationId()).getInviteeMemberId());
        List<SeatInvitationVO> wallet = service.recipientSeats(99L);
        assertEquals(1, wallet.size());
        assertEquals(Long.valueOf(41L), wallet.get(0).getTopicId());
        assertEquals(Long.valueOf(61L), wallet.get(0).getOwnerId());
        assertNull(wallet.get(0).getRecipientPhoneMasked());
        assertNull(wallet.get(0).getRecipientName());
        assertTrue(service.recipientSeats(100L).isEmpty());
        ServiceException noRevoke = assertThrows(ServiceException.class,
                () -> service.cancel(51L, action(v.getInvitationId(), "c-claimed")));
        assertEquals(Integer.valueOf(409), noRevoke.getCode(), "已领取不能撤回");
    }

    @Test
    void buyerCannotClaimOwnTransferEvenIfPhoneMatches() {
        SeatInvitationVO v = service.transferByPhone(51L, transfer(null, "小王", "13800138000", "t-f"));
        phones.put(51L, "13800138000");
        assertTrue(service.claimByVerifiedPhone(51L).isEmpty());
        assertTrue(rows.get(v.getInvitationId()).pending());
    }

    @Test
    void recipientCannotTakeTwoSeatsOfSameOrder() {
        service.transferByPhone(51L, transfer(2, "小王", "13800138000", "t-g"));
        SeatInvitationVO link = service.invite(51L, create(3, "r-link"));
        service.claim(99L, claim(link.getToken(), "c-link"));
        phones.put(99L, "13800138000");
        assertTrue(service.claimByVerifiedPhone(99L).isEmpty(), "同单一人一席");
    }

    @Test
    void refundVoidsPendingAndClaimedExactlyAsWholeOrderRefund() {
        SeatInvitationVO pending = service.transferByPhone(51L, transfer(2, "小王", "13800138000", "t-h"));
        service.transferByPhone(51L, transfer(3, "小李", "13800138001", "t-i"));
        phones.put(100L, "13800138001");
        assertEquals(1, service.claimByVerifiedPhone(100L).size());
        assertEquals(1, service.recipientSeats(100L).size());
        order.setPaymentStatus(4);
        phones.put(99L, "13800138000");
        assertTrue(service.claimByVerifiedPhone(99L).isEmpty(), "退款后待领取不能再领");
        assertTrue(rows.get(pending.getInvitationId()).pending());
        assertTrue(service.recipientSeats(100L).isEmpty(), "退款后已领取席位从受让人的票里消失");
        assertEquals(Integer.valueOf(409), assertThrows(ServiceException.class,
                () -> service.transferByPhone(51L, transfer(null, "小张", "13800138002", "t-j"))).getCode());
    }

    @Test
    void sameRequestIdReplaysWithoutSecondRow() {
        SeatInvitationVO a = service.transferByPhone(51L, transfer(null, "小王", "13800138000", "t-k"));
        SeatInvitationVO b = service.transferByPhone(51L, transfer(null, "小王", "13800138000", "t-k"));
        assertEquals(a.getInvitationId(), b.getInvitationId());
        assertTrue(b.getReplayed());
        assertEquals(1, rows.size());
        assertEquals(Integer.valueOf(409), assertThrows(ServiceException.class,
                () -> service.transferByPhone(51L, transfer(null, "小王", "13800138009", "t-k"))).getCode());
    }

    @Test
    void codecNormalisesMasksAndHashesWithDomainSeparation() {
        assertEquals("13800138000", SeatPhoneTransferCodec.normalize(" 138 0013 8000 "));
        assertEquals("13800138000", SeatPhoneTransferCodec.normalize("0086-13800138000"));
        assertEquals("13800138000", SeatPhoneTransferCodec.normalize("8613800138000"));
        assertNull(SeatPhoneTransferCodec.normalize("02012345678"));
        assertEquals("138****8000", SeatPhoneTransferCodec.mask("13800138000"));
        String h = SeatPhoneTransferCodec.hash("13800138000", "k");
        assertEquals(64, h.length());
        assertNotEquals(h, SeatPhoneTransferCodec.hash("13800138000", "k2"));
        assertNotEquals(h, SeatInvitationTokenCodec.sha256Hex("13800138000"));
    }

    private SeatPhoneTransferRequest transfer(Integer seatNo, String name, String phone, String requestId) {
        SeatPhoneTransferRequest r = new SeatPhoneTransferRequest();
        r.setRegistrationId(31L); r.setSeatNo(seatNo); r.setName(name); r.setPhone(phone); r.setRequestId(requestId);
        return r;
    }

    private SeatInvitationCreateRequest create(Integer seatNo, String requestId) {
        SeatInvitationCreateRequest request = new SeatInvitationCreateRequest();
        request.setRegistrationId(31L); request.setSeatNo(seatNo); request.setRequestId(requestId);
        return request;
    }

    private SeatInvitationClaimRequest claim(String token, String requestId) {
        SeatInvitationClaimRequest request = new SeatInvitationClaimRequest();
        request.setToken(token); request.setRequestId(requestId);
        return request;
    }

    private SeatInvitationActionRequest action(Long invitationId, String requestId) {
        SeatInvitationActionRequest request = new SeatInvitationActionRequest();
        request.setInvitationId(invitationId); request.setRequestId(requestId);
        return request;
    }
}
