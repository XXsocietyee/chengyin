package com.chengyinhub.business.service.impl;

import com.chengyinhub.business.domain.ChannelVoucher;
import com.chengyinhub.business.domain.CmsRegistration;
import com.chengyinhub.business.domain.CmsTopic;
import com.chengyinhub.business.domain.MarketingCodeGrant;
import com.chengyinhub.business.domain.MarketingProduct;
import com.chengyinhub.business.domain.MarketingProductItem;
import com.chengyinhub.business.domain.dto.ChannelGrantTopic;
import com.chengyinhub.business.domain.dto.ChannelRedeemResult;
import com.chengyinhub.business.domain.dto.ChannelVoucherRevokeRequest;
import com.chengyinhub.business.domain.dto.ChannelVoucherView;
import com.chengyinhub.business.domain.dto.PlatformCodeIssueRequest;
import com.chengyinhub.business.exception.ChannelVoucherException;
import com.chengyinhub.business.mapper.ChannelVoucherMapper;
import com.chengyinhub.business.mapper.CmsRegistrationMapper;
import com.chengyinhub.business.mapper.MarketingCodeGrantMapper;
import com.chengyinhub.business.mapper.MarketingProductMapper;
import com.chengyinhub.business.service.ICmsTopicService;
import com.chengyinhub.business.service.IPlatformCodeService;
import com.chengyinhub.business.service.IProductRoleService;
import com.chengyinhub.business.service.support.ChannelGrantPlanner;
import com.chengyinhub.business.service.support.ChannelVoucherCodec;
import com.chengyinhub.business.service.support.ChannelVoucherSnapshot;
import com.chengyinhub.business.service.support.CodeGrantSeatOrder;
import com.chengyinhub.common.constant.PurchaseKind;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

/**
 * 平台自发兑换码：发码、列表、撤销、兑换。默认关闭（{@code channel.platform-issued.enabled=false}）。
 *
 * <p><b>不是付款</b>：本类写 {@code marketing_channel_voucher}（issuer_type=PLATFORM）与
 * {@code marketing_code_grant}；可玩由 {@code CurrentPlayRegistration} 读取授权事实放行（与礼品并列）。
 * 不写任何支付/收入/结算/打款/退款/发票表，不进收入投递队列。
 *
 * <p><b>唯一例外：N 座码的 ¥0 席位锚单</b>（DEC-F17，2026-11-25 业主拍板「建一张 ¥0 已付单」）。
 * 单主题且席位数 N&gt;1 的码（SEAT2-/SEAT4- 多人票等）兑换时，为兑换人恰好落一行 {@code cms_registration}：
 * owner_type=1、order_num=N、purchase_kind=2、全部金额 0.00、payment_status=2、registration_status=2、
 * create_by=platform-code（{@link CodeGrantSeatOrder}，服务端常量，客户端无法写入）。它只是既有席位邀请（{@code RegistrationSeatInvitationServiceImpl}：
 * 席位页、按手机号转赠、分享链接）的锚，席位规则一律沿用原实现。
 * <ul>
 *   <li>幂等：每码最多一张（持码行锁先查 + 既有唯一键 uk_reg_member_request：
 *       一码只归一个兑换人，request_id 恒为 PCG:码:主题）；同人重放/换请求键再兑
 *       只返回原授权，不会第二张；本功能上线前已兑换的 N 座码在本人重放时补建同一张。</li>
 *   <li>不碰钱：锚单金额全 0、无交易号、payment_type 为空；会产生副作用的资金读侧
 *       （自助退款/主办清退/取消主题退款、核销结算认领、主题原始现金冻结、商户推荐奖励计数）按
 *       {@link CodeGrantSeatOrder#isCodeGranted} 排除；本类不调用任何收入投递/权益占用，不建商品单。</li>
 *   <li>撤码：与退款同一失效口径 —— 锚单 2/2 → 3/3，待领取邀请不能再领、已领取席位的可玩事实立即消失；
 *       0 元无钱可退，所以不落「已退款」(4)。到期：锚单 expires_at = 授权 valid_to，与已付通行证同口径停邀请/领取。</li>
 *   <li>多主题合集码与单席位码不建锚单（席位锚在每主题一行，合集一码多行不满足「恰好一张」），仍只有授权事实。</li>
 * </ul>
 *
 * <p>范围 v1：只支持授予路线自玩的商品（单条路线、城市合集，fulfillment_route=SELF_PLAY_GRANT），
 * 且全部作品为平台自营。30 日通行证（platform_pass）不在范围内。
 */
@Service
public class PlatformCodeServiceImpl implements IPlatformCodeService {

    static final int MAX_BATCH_SIZE = 500;
    static final int MAX_QUANTITY = 50;
    static final long DEFAULT_VALID_DAYS = 30L;
    static final long MAX_VALID_DAYS = 180L;
    private static final int DEFAULT_LIST_LIMIT = 50;
    private static final int MAX_LIST_LIMIT = 500;

    private final ChannelVoucherMapper voucherMapper;
    private final MarketingCodeGrantMapper grantMapper;
    private final MarketingProductMapper productMapper;
    private final IProductRoleService productRoleService;
    private final ICmsTopicService topicService;
    private final CmsRegistrationMapper registrationMapper;
    private final boolean enabled;

    public PlatformCodeServiceImpl(ChannelVoucherMapper voucherMapper,
                                   MarketingCodeGrantMapper grantMapper,
                                   MarketingProductMapper productMapper,
                                   IProductRoleService productRoleService,
                                   ICmsTopicService topicService,
                                   CmsRegistrationMapper registrationMapper,
                                   @Value("${channel.platform-issued.enabled:false}") boolean enabled) {
        this.voucherMapper = voucherMapper;
        this.grantMapper = grantMapper;
        this.productMapper = productMapper;
        this.productRoleService = productRoleService;
        this.topicService = topicService;
        this.registrationMapper = registrationMapper;
        this.enabled = enabled;
    }

    @Override
    public boolean enabled() {
        return enabled;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public List<ChannelVoucherView> issue(long operatorUserId, PlatformCodeIssueRequest request) {
        requireOperator(operatorUserId);
        requireEnabledForAdmin();
        if (request == null) {
            throw ChannelVoucherException.badRequest("REQUEST_REQUIRED", "缺少发码参数");
        }
        String requestId = requireText(request.getRequestId(), 64, "REQUEST_ID_REQUIRED");
        if (request.getProductId() == null || request.getProductId() <= 0) {
            throw ChannelVoucherException.badRequest("PRODUCT_REQUIRED", "缺少商品");
        }
        int batchSize = request.getBatchSize() == null ? 1 : request.getBatchSize();
        if (batchSize <= 0 || batchSize > MAX_BATCH_SIZE) {
            throw ChannelVoucherException.badRequest("BATCH_SIZE_INVALID", "批次数量须在 1-" + MAX_BATCH_SIZE + " 之间");
        }
        int quantity = request.getQuantity() == null ? 1 : request.getQuantity();
        if (quantity <= 0 || quantity > MAX_QUANTITY) {
            throw ChannelVoucherException.badRequest("QUANTITY_INVALID", "每码数量须在 1-" + MAX_QUANTITY + " 之间");
        }
        String note = request.getNote() == null ? null : request.getNote().trim();
        if (note != null && note.length() > 200) {
            throw ChannelVoucherException.badRequest("NOTE_TOO_LONG", "备注不能超过 200 字");
        }
        if (note != null && note.isEmpty()) note = null;
        Long boundMemberId = request.getBoundMemberId();
        if (boundMemberId != null && (boundMemberId <= 0 || batchSize != 1)) {
            throw ChannelVoucherException.badRequest("BOUND_MEMBER_INVALID", "只有单码可以绑定会员");
        }
        Date now = new Date();
        Date expiresAt = request.getExpiresAt() == null
                ? new Date(now.getTime() + TimeUnit.DAYS.toMillis(DEFAULT_VALID_DAYS))
                : request.getExpiresAt();
        if (!expiresAt.after(now)) {
            throw ChannelVoucherException.badRequest("EXPIRES_AT_INVALID", "兑换码有效期必须晚于当前时间");
        }
        if (expiresAt.getTime() > now.getTime() + TimeUnit.DAYS.toMillis(MAX_VALID_DAYS)) {
            throw ChannelVoucherException.badRequest("EXPIRES_AT_INVALID", "兑换码有效期不能超过 " + MAX_VALID_DAYS + " 天");
        }
        String fingerprint = ChannelVoucherCodec.sha256Hex("PLATFORM|" + request.getProductId() + "|" + batchSize
                + "|" + quantity + "|" + (request.getExpiresAt() == null ? "DEFAULT" : request.getExpiresAt().getTime())
                + "|" + (note == null ? "" : note) + "|" + (boundMemberId == null ? "" : boundMemberId));
        List<ChannelVoucher> previous = voucherMapper.selectPlatformByRequest(requestId);
        if (previous != null && !previous.isEmpty()) {
            if (!fingerprint.equals(previous.get(0).getRequestFingerprint())) {
                throw ChannelVoucherException.conflict("REQUEST_CONFLICT", "同一发码请求对应了不同参数");
            }
            // 重放不再返回明文：明文只在首次发行响应里出现一次。
            List<ChannelVoucherView> replay = new ArrayList<>();
            for (ChannelVoucher row : previous) {
                ChannelVoucherView view = toView(row);
                view.setReplayed(Boolean.TRUE);
                replay.add(view);
            }
            return replay;
        }
        MarketingProduct product = requireGrantableProduct(request.getProductId());
        List<MarketingProductItem> items = productMapper.selectItems(product.getId());
        requirePlatformOwned(items);
        String snapshot = ChannelVoucherSnapshot.capturePlatform(product, items, topicService);
        int seatCount = seatCount(product, quantity);
        String batchNo = newBatchNo(now);
        List<ChannelVoucherView> views = new ArrayList<>();
        for (int seq = 1; seq <= batchSize; seq++) {
            ChannelVoucher voucher = new ChannelVoucher();
            voucher.setIssuerType(ChannelVoucher.ISSUER_PLATFORM);
            voucher.setBatchNo(batchNo);
            voucher.setBatchSeq(seq);
            voucher.setAdminNote(note);
            voucher.setPublicId(ChannelVoucherCodec.newPublicId());
            String code = ChannelVoucherCodec.issue(voucher.getPublicId());
            voucher.setCodeHash(ChannelVoucherCodec.sha256Hex(code));
            voucher.setProductId(product.getId());
            voucher.setProductRevision(product.getRevision() == null ? 1L : product.getRevision());
            voucher.setGrantSnapshotJson(snapshot);
            voucher.setQuantity(quantity);
            voucher.setSeatCount(seatCount);
            voucher.setSubjectMode(boundMemberId == null ? ChannelVoucher.SUBJECT_OPEN : ChannelVoucher.SUBJECT_BOUND_MEMBER);
            voucher.setBoundMemberId(boundMemberId);
            voucher.setInventoryState(ChannelVoucher.INVENTORY_NONE);
            voucher.setStatus(ChannelVoucher.STATUS_ACTIVE);
            voucher.setIssuedAt(now);
            voucher.setExpiresAt(expiresAt);
            voucher.setIssuedBy(operatorUserId);
            voucher.setRequestId(requestId);
            voucher.setRequestFingerprint(fingerprint);
            voucher.setCreateTime(now);
            voucher.setUpdateTime(now);
            try {
                voucherMapper.insertPlatform(voucher);
            } catch (DuplicateKeyException duplicate) {
                throw ChannelVoucherException.conflict("VOUCHER_CONFLICT", "发码并发冲突，请用同一请求重试");
            }
            ChannelVoucherView view = toView(voucher);
            view.setCode(code);
            view.setCodeAvailable(Boolean.TRUE);
            view.setReplayed(Boolean.FALSE);
            views.add(view);
        }
        return views;
    }

    @Override
    public List<ChannelVoucherView> list(long operatorUserId, String batchNo, Integer status, int limit) {
        requireOperator(operatorUserId);
        int bounded = limit <= 0 ? DEFAULT_LIST_LIMIT : Math.min(limit, MAX_LIST_LIMIT);
        List<ChannelVoucher> rows = voucherMapper.selectPlatformList(
                batchNo == null || batchNo.trim().isEmpty() ? null : batchNo.trim(), status, bounded);
        List<ChannelVoucherView> views = new ArrayList<>();
        if (rows != null) for (ChannelVoucher row : rows) views.add(toView(row));
        return views;
    }

    /**
     * 撤销：未兑换 ⇒ 码作废；已兑换 ⇒ 码作废 + 授权事实 ACTIVE→REVOKED（只停后续可玩）
     * + N 座码的 ¥0 锚单作废（与退款同一失效口径，待领取/已领取席位随之失效）。
     * 不回滚已完成/已核销内容、不复活任何东西；不涉及退款（平台码没有钱）。幂等：已撤销原样返回。
     */
    @Override
    @Transactional(rollbackFor = Exception.class)
    public ChannelVoucherView revoke(long operatorUserId, Long voucherId, ChannelVoucherRevokeRequest request) {
        requireOperator(operatorUserId);
        if (voucherId == null || voucherId <= 0) {
            throw ChannelVoucherException.badRequest("VOUCHER_ID_REQUIRED", "缺少兑换码 id");
        }
        String reason = requireText(request == null ? null : request.getReason(), 120, "REVOKE_REASON_REQUIRED");
        ChannelVoucher voucher = voucherMapper.selectByIdForUpdate(voucherId);
        if (voucher == null || !voucher.platformIssued()) {
            throw ChannelVoucherException.notFound("VOUCHER_NOT_FOUND", "兑换码不存在");
        }
        Date now = new Date();
        if (Integer.valueOf(ChannelVoucher.STATUS_REVOKED).equals(voucher.getStatus())) {
            return toView(voucher);
        }
        if (Integer.valueOf(ChannelVoucher.STATUS_REDEEMED).equals(voucher.getStatus())) {
            List<MarketingCodeGrant> redeemed = grantMapper.selectByVoucherForUpdate(voucher.getId());
            grantMapper.revokeByVoucher(voucher.getId(), reason, now);
            voidSeatOrder(voucher, redeemed, now);
        }
        if (voucherMapper.markRevoked(voucher.getId(), "OPERATOR", now) == 0) {
            ChannelVoucher current = voucherMapper.selectById(voucher.getId());
            if (current == null) {
                throw ChannelVoucherException.conflict("VOUCHER_CONFLICT", "兑换码状态冲突");
            }
            return toView(current);
        }
        voucher.setStatus(ChannelVoucher.STATUS_REVOKED);
        voucher.setRevokeSource("OPERATOR");
        voucher.setUpdateTime(now);
        return toView(voucher);
    }

    /**
     * 兑换：码行加锁后判定；同人重放返回原授权（replayed=true），他人已用/过期/撤销一律拒绝且不泄露兑换人。
     * 每个作品落一行授权事实，席位 = 商品席位 × 数量（发码时冻结在码上）。
     */
    @Override
    @Transactional(rollbackFor = Exception.class)
    public ChannelRedeemResult redeem(long memberId, Long voucherId, String requestId, String requestFingerprint) {
        if (memberId <= 0) {
            throw ChannelVoucherException.unauthorized("LOGIN_REQUIRED", "请先登录");
        }
        if (!enabled) {
            throw ChannelVoucherException.unavailable("CODE_UNAVAILABLE", "兑换码暂不可用");
        }
        List<MarketingCodeGrant> byRequest = grantMapper.selectByMemberRequest(memberId, requestId);
        if (byRequest != null && !byRequest.isEmpty()) {
            MarketingCodeGrant first = byRequest.get(0);
            if (!first.getVoucherId().equals(voucherId) || !requestFingerprint.equals(first.getRequestFingerprint())) {
                throw ChannelVoucherException.conflict("REQUEST_CONFLICT", "同一请求键对应了不同兑换码");
            }
        }
        ChannelVoucher voucher = voucherMapper.selectByIdForUpdate(voucherId);
        if (voucher == null || !voucher.platformIssued()) {
            throw ChannelVoucherException.notFound("INVALID_CODE", "兑换码无效");
        }
        Date now = new Date();
        if (Integer.valueOf(ChannelVoucher.STATUS_REVOKED).equals(voucher.getStatus())) {
            throw ChannelVoucherException.conflict("CODE_UNAVAILABLE", "兑换码暂不可用");
        }
        if (Integer.valueOf(ChannelVoucher.STATUS_REDEEMED).equals(voucher.getStatus())) {
            List<MarketingCodeGrant> existing = grantMapper.selectByVoucherForUpdate(voucher.getId());
            if (existing != null && !existing.isEmpty() && Long.valueOf(memberId).equals(existing.get(0).getMemberId())) {
                ensureSeatOrder(voucher, existing, memberId, now);
                return result(voucher, existing, true);
            }
            throw ChannelVoucherException.conflict("ALREADY_REDEEMED_BY_OTHER", "兑换码已被使用");
        }
        if (Integer.valueOf(ChannelVoucher.STATUS_EXPIRED).equals(voucher.getStatus())
                || (voucher.getExpiresAt() != null && !voucher.getExpiresAt().after(now))) {
            throw ChannelVoucherException.conflict("CODE_EXPIRED", "兑换码已过期");
        }
        if (Integer.valueOf(ChannelVoucher.SUBJECT_BOUND_MEMBER).equals(voucher.getSubjectMode())
                && (voucher.getBoundMemberId() == null || voucher.getBoundMemberId() != memberId)) {
            throw ChannelVoucherException.forbidden("SUBJECT_MISMATCH", "该兑换码不属于当前账号");
        }
        MarketingProduct product = ChannelVoucherSnapshot.product(voucher);
        if (Integer.valueOf(MarketingProduct.VALIDITY_FIXED_WINDOW).equals(product.getValidityKind())
                && (product.getFixedValidTo() == null || !product.getFixedValidTo().after(now))) {
            throw ChannelVoucherException.conflict("CODE_UNAVAILABLE", "兑换码暂不可用");
        }
        ChannelGrantPlanner.requireSupportedValidity(product);
        List<ChannelGrantTopic> topics = ChannelVoucherSnapshot.topics(voucher);
        for (ChannelGrantTopic topic : topics) {
            if (topic.getTopicId() == null || !productRoleService.isPlatformOwned(topic.getTopicId())) {
                throw ChannelVoucherException.conflict("CODE_UNAVAILABLE", "兑换码暂不可用");
            }
        }
        if (voucherMapper.markRedeemed(voucher.getId(), now) == 0) {
            throw ChannelVoucherException.conflict("ALREADY_REDEEMED_BY_OTHER", "兑换码已被使用");
        }
        Date validFrom = validFrom(product, now);
        Date validTo = validTo(product, now);
        List<MarketingCodeGrant> grants = new ArrayList<>();
        for (ChannelGrantTopic topic : topics) {
            MarketingCodeGrant grant = new MarketingCodeGrant();
            grant.setVoucherId(voucher.getId());
            grant.setMemberId(memberId);
            grant.setProductId(voucher.getProductId());
            grant.setProductRevision(voucher.getProductRevision());
            grant.setTopicId(topic.getTopicId());
            grant.setContentRevision(topic.getContentRevision());
            grant.setQuantity(voucher.getQuantity());
            grant.setSeatCount(voucher.getSeatCount());
            grant.setStatus(MarketingCodeGrant.STATUS_ACTIVE);
            grant.setValidFrom(validFrom);
            grant.setValidTo(validTo);
            grant.setGrantedAt(now);
            grant.setRequestId(requestId);
            grant.setRequestFingerprint(requestFingerprint);
            grant.setIdempotencyKey(MarketingCodeGrant.idempotencyKeyOf(voucher.getId(), topic.getTopicId()));
            grant.setCreateTime(now);
            grant.setUpdateTime(now);
            try {
                grantMapper.insert(grant);
            } catch (DuplicateKeyException duplicate) {
                throw ChannelVoucherException.conflict("ALREADY_REDEEMED_BY_OTHER", "兑换码已被使用");
            }
            grants.add(grant);
        }
        ensureSeatOrder(voucher, grants, memberId, now);
        voucher.setStatus(ChannelVoucher.STATUS_REDEEMED);
        return result(voucher, grants, false);
    }

    /**
     * N 座码的 ¥0 席位锚单（DEC-F17）。调用方已持码行锁；只在授权仍 ACTIVE、单主题、N&gt;1 时落，且每码最多一张。
     * 行字段只来自服务端冻结事实（码 / 授权 / 主题），member_id 只取已登录兑换人。
     */
    private void ensureSeatOrder(ChannelVoucher voucher, List<MarketingCodeGrant> grants, long memberId, Date now) {
        if (!seatOrderEligible(voucher, grants, memberId)) return;
        MarketingCodeGrant grant = grants.get(0);
        // 已过有效期的授权(上线前兑换、重放补建时)不再补一张已到期的锚单。
        if (grant.getValidTo() != null && !grant.getValidTo().after(now)) return;
        String requestId = CodeGrantSeatOrder.requestIdOf(voucher.getId(), grant.getTopicId());
        if (existingSeatOrder(memberId, requestId) != null) return;
        CmsTopic topic = topicService.selectCmsTopicById(grant.getTopicId());
        CmsRegistration row = new CmsRegistration();
        row.setRegistrationNo(seatOrderNo(now));
        row.setOwnerType(1L);
        row.setOwnerId(grant.getTopicId());
        row.setTopicId(grant.getTopicId());
        row.setActivityTitle(topic == null ? null : topic.getName());
        row.setMemberId(memberId);
        row.setOrderNum(voucher.getSeatCount().longValue());
        row.setPurchaseKind(PurchaseKind.SELF_PLAY_PASS);
        row.setExpiresAt(grant.getValidTo());
        row.setFeePlatformRate(topic == null ? null : topic.getFeePlatformRate());
        row.setRequestId(requestId);
        row.setPaymentTime(now);
        try {
            if (registrationMapper.insertCodeGrantSeatOrder(row) != 1) {
                throw ChannelVoucherException.conflict("SEAT_ORDER_FAILED", "席位单保存失败，请重试");
            }
        } catch (DuplicateKeyException duplicate) {
            // 既有唯一键 uk_reg_member_request 兜底:同码已建同一张即视为成功。
            if (existingSeatOrder(memberId, requestId) == null) {
                throw ChannelVoucherException.conflict("SEAT_ORDER_FAILED", "席位单保存失败，请重试");
            }
        }
    }

    /** 当前读锚单;同键却不是码授予行(不该出现)一律拒绝,不把别的订单当锚单。 */
    private CmsRegistration existingSeatOrder(long memberId, String requestId) {
        CmsRegistration existing = registrationMapper.selectCodeGrantSeatOrderForUpdate(memberId, requestId);
        if (existing != null && !CodeGrantSeatOrder.isCodeGranted(existing)) {
            throw ChannelVoucherException.conflict("SEAT_ORDER_CONFLICT", "席位单与已有订单冲突");
        }
        return existing;
    }

    /** 撤码:锚单 2/2 → 3/3(与退款同一失效口径)。只认本码兑换人、本码键;无锚单即 0 行。 */
    private void voidSeatOrder(ChannelVoucher voucher, List<MarketingCodeGrant> grants, Date now) {
        if (grants == null) return;
        for (MarketingCodeGrant grant : grants) {
            if (grant == null || grant.getMemberId() == null || grant.getTopicId() == null) continue;
            registrationMapper.voidCodeGrantSeatOrder(grant.getMemberId(),
                    CodeGrantSeatOrder.requestIdOf(voucher.getId(), grant.getTopicId()), now);
        }
    }

    static boolean seatOrderEligible(ChannelVoucher voucher, List<MarketingCodeGrant> grants, long memberId) {
        if (voucher == null || voucher.getId() == null || voucher.getSeatCount() == null
                || voucher.getSeatCount() <= 1 || grants == null || grants.size() != 1) return false;
        MarketingCodeGrant grant = grants.get(0);
        return grant != null && grant.getTopicId() != null
                && Long.valueOf(memberId).equals(grant.getMemberId())
                && Integer.valueOf(MarketingCodeGrant.STATUS_ACTIVE).equals(grant.getStatus());
    }

    private static String seatOrderNo(Date now) {
        return "C" + new java.text.SimpleDateFormat("yyyyMMdd").format(now)
                + UUID.randomUUID().toString().replace("-", "").substring(0, 12).toUpperCase();
    }

    private MarketingProduct requireGrantableProduct(Long productId) {
        MarketingProduct product = productMapper.selectById(productId);
        if (product == null || Integer.valueOf(MarketingProduct.STATUS_DRAFT).equals(product.getStatus())) {
            throw ChannelVoucherException.conflict("PRODUCT_UNAVAILABLE", "商品不存在或未发布");
        }
        Integer kind = product.getProductKind();
        boolean routeProduct = Integer.valueOf(MarketingProduct.KIND_SINGLE_QUEST).equals(kind)
                || Integer.valueOf(MarketingProduct.KIND_CITY_BUNDLE).equals(kind);
        if (!routeProduct || !Integer.valueOf(MarketingProduct.ROUTE_SELF_PLAY_GRANT).equals(product.getFulfillmentRoute())) {
            throw ChannelVoucherException.conflict("PRODUCT_UNSUPPORTED", "平台码只支持授予路线自玩的商品（单条路线或合集）");
        }
        ChannelGrantPlanner.requireSupportedValidity(product);
        return product;
    }

    private void requirePlatformOwned(List<MarketingProductItem> items) {
        if (items == null || items.isEmpty()) {
            throw ChannelVoucherException.conflict("PRODUCT_UNAVAILABLE", "商品未绑定任何作品，不能发码");
        }
        for (MarketingProductItem item : items) {
            if (item.getTopicId() == null || !productRoleService.isPlatformOwned(item.getTopicId())) {
                throw ChannelVoucherException.conflict("PRODUCT_UNAVAILABLE", "平台码只允许平台自营内容");
            }
        }
    }

    static int seatCount(MarketingProduct product, int quantity) {
        int base = product.getSeatCount() == null || product.getSeatCount() <= 0 ? 1 : product.getSeatCount();
        long total = (long) base * (long) quantity;
        if (total <= 0 || total > Integer.MAX_VALUE) {
            throw ChannelVoucherException.badRequest("SEAT_COUNT_INVALID", "席位数量超出范围");
        }
        return (int) total;
    }

    private Date validFrom(MarketingProduct product, Date now) {
        if (Integer.valueOf(MarketingProduct.VALIDITY_FIXED_WINDOW).equals(product.getValidityKind())) {
            return product.getFixedValidFrom();
        }
        return now;
    }

    private Date validTo(MarketingProduct product, Date now) {
        if (Integer.valueOf(MarketingProduct.VALIDITY_FIXED_WINDOW).equals(product.getValidityKind())) {
            return product.getFixedValidTo();
        }
        if (Integer.valueOf(MarketingProduct.VALIDITY_RELATIVE_DAYS).equals(product.getValidityKind())
                && product.getValidDays() != null && product.getValidDays() > 0) {
            return new Date(now.getTime() + TimeUnit.DAYS.toMillis(product.getValidDays()));
        }
        return null;
    }

    private ChannelRedeemResult result(ChannelVoucher voucher, List<MarketingCodeGrant> grants, boolean replayed) {
        MarketingProduct product = productMapper.selectById(voucher.getProductId());
        MarketingCodeGrant first = grants.get(0);
        ChannelRedeemResult result = new ChannelRedeemResult();
        result.setIssuerType("PLATFORM");
        result.setReceiptNo("PCG-" + voucher.getPublicId());
        result.setStatus(Integer.valueOf(MarketingCodeGrant.STATUS_REVOKED).equals(first.getStatus()) ? 1 : 0);
        result.setVoucherId(voucher.getId());
        result.setVoucherPublicId(voucher.getPublicId());
        result.setProductId(voucher.getProductId());
        result.setProductName(product == null ? null : product.getProductName());
        result.setQuantity(voucher.getQuantity());
        result.setSeatCount(first.getSeatCount());
        List<Long> topicIds = new ArrayList<>();
        for (MarketingCodeGrant grant : grants) topicIds.add(grant.getTopicId());
        result.setTopicIds(topicIds);
        result.setValidFrom(first.getValidFrom());
        result.setValidTo(first.getValidTo());
        result.setRedeemedAt(first.getGrantedAt());
        result.setRevokedAt(first.getRevokedAt());
        result.setReplayed(replayed);
        return result;
    }

    private ChannelVoucherView toView(ChannelVoucher voucher) {
        ChannelVoucherView view = new ChannelVoucherView();
        view.setId(voucher.getId());
        view.setIssuerType(voucher.getIssuerType());
        view.setBatchNo(voucher.getBatchNo());
        view.setBatchSeq(voucher.getBatchSeq());
        view.setAdminNote(voucher.getAdminNote());
        view.setPublicId(voucher.getPublicId());
        view.setCodeAvailable(Boolean.FALSE);
        view.setProductId(voucher.getProductId());
        view.setProductRevision(voucher.getProductRevision());
        view.setQuantity(voucher.getQuantity());
        view.setSeatCount(voucher.getSeatCount());
        view.setSubjectMode(voucher.getSubjectMode());
        view.setBoundMemberId(voucher.getBoundMemberId());
        view.setStatus(voucher.getStatus());
        view.setIssuedAt(voucher.getIssuedAt());
        view.setExpiresAt(voucher.getExpiresAt());
        return view;
    }

    private void requireEnabledForAdmin() {
        if (!enabled) {
            throw ChannelVoucherException.unavailable("PLATFORM_CODE_DISABLED", "平台自发码未开启（channel.platform-issued.enabled）");
        }
    }

    private void requireOperator(long operatorUserId) {
        if (operatorUserId <= 0) {
            throw ChannelVoucherException.unauthorized("LOGIN_REQUIRED", "请先登录管理端");
        }
    }

    private static String newBatchNo(Date now) {
        return "PB" + new java.text.SimpleDateFormat("yyyyMMddHHmmss").format(now)
                + UUID.randomUUID().toString().replace("-", "").substring(0, 8).toUpperCase();
    }

    private String requireText(String value, int maxLength, String reasonCode) {
        if (value == null || value.trim().isEmpty()) {
            throw ChannelVoucherException.badRequest(reasonCode, "缺少必填参数");
        }
        String trimmed = value.trim();
        if (trimmed.length() > maxLength) {
            throw ChannelVoucherException.badRequest(reasonCode, "参数长度超限");
        }
        return trimmed;
    }
}
