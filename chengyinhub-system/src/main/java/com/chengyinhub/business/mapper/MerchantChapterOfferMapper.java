package com.chengyinhub.business.mapper;

import java.util.List;
import org.apache.ibatis.annotations.Param;
import com.chengyinhub.business.domain.MerchantChapterOffer;

/**
 * 商家×章节生效供给 Mapper 接口(施工图 §3.2 · 执行层)
 */
public interface MerchantChapterOfferMapper {

    /**
     * [P0-50] 某主题**全部必选章**的计酬成本上界:Σ over 必选章 of max(该章 REVSHARE offer 的 per_head_fee)。
     *
     * <p><b>为什么是「每章取 max 再求和」而不是「全部求和」</b>:一张票每章**只核销一次**
     * ({@code redemption.active_key} = registration+chapter),玩家在一章里只会去一家店 ⇒
     * 该章最多付一份人头费。全部求和会把同章的多个商家重复计入,把成本高估到离谱。
     *
     * <p><b>为什么是 max 而不是 avg/min</b>:玩家去哪家由他自己定,平台控制不了 ⇒
     * 只有最贵的那家才是**上界**。用 avg 算出来的闸拦不住最坏情况。
     *
     * <p><b>为什么只数必选章</b>:可选章玩家可以不去 ⇒ 不构成「全通关必付」的成本。
     *
     * <p>⚠️「生效」是两条轴:{@code status=1 AND (valid_end IS NULL OR valid_end > NOW())}。
     * valid_end 到期**不会**自动翻 status,漏了它会把过期供给算进来。
     *
     * @return 上界;无 REVSHARE 供给时返回 null(调用方按 0 处理)
     */
    java.math.BigDecimal sumMaxPerHeadFeeByRequiredChapters(@Param("topicId") Long topicId);

    /** ③ 锁价前检查:没有任何生效供给的必选章数量;大于 0 即禁止开卖。 */
    int countRequiredChaptersWithoutLiveOffer(@Param("topicId") Long topicId);

    /** F10:主题必选章(商家位置)总数,与 countRequiredChaptersWithoutLiveOffer 同口径。 */
    int countRequiredChapters(@Param("topicId") Long topicId);

    public int insertMerchantChapterOffer(MerchantChapterOffer o);

    public MerchantChapterOffer selectById(@Param("id") Long id);

    MerchantChapterOffer selectByIdForUpdate(@Param("id") Long id);

    /** 复上检查使用当前读；调用者已持主题锁，不反向加章节锁。 */
    List<MerchantChapterOffer> selectByTopicIncludingInactiveForUpdate(@Param("topicId") Long topicId);

    MerchantChapterOffer selectReplacementForUpdate(@Param("originalOfferId") Long originalOfferId);

    /** 只停用本人仍生效的供给，不改条款、已用份数及核销引用。 */
    int withdrawOwned(@Param("id") Long id, @Param("merchantId") Long merchantId,
                      @Param("reason") String reason, @Param("required") boolean required);

    /** P1-7:主办方移除本主题的生效供给;where 带 topic_id 与 status=1,并记下操作人。 */
    int removeByOrganizer(@Param("id") Long id, @Param("topicId") Long topicId,
                          @Param("reason") String reason, @Param("required") boolean required,
                          @Param("operatorId") Long operatorId);

    /** P1-7:承接方调自己生效供给的名额;where 带 merchant_id、status=1 与 quota_used &lt;= 新额度,0 行由调用方拒。 */
    int updateOwnQuota(@Param("id") Long id, @Param("merchantId") Long merchantId,
                       @Param("quotaTotal") Integer quotaTotal);

    /** P1-7:承接方暂停 / 恢复自己生效供给的新售;where 带 merchant_id 与 status=1。 */
    int updateOwnSalePaused(@Param("id") Long id, @Param("merchantId") Long merchantId,
                            @Param("paused") int paused);

    /** P1-7:本章「暂停新售」的生效供给剩余份数合计;只供可售容量扣减,核销与供给口径不读它。 */
    Integer sumPausedRemainingQuotaByChapter(@Param("chapterId") Long chapterId);

    /** 同上,当前读(FOR SHARE);只在购票事务里用,理由见 sumRemainingQuotaByChapterForUpdate。 */
    Integer sumPausedRemainingQuotaByChapterForUpdate(@Param("chapterId") Long chapterId);

    /** P1-7:本商家已暂停新售的生效供给 id,供「我的申请」列表回显。 */
    List<Long> selectSalePausedIdsByMerchant(@Param("merchantId") Long merchantId);

    /** 后台审核台队列:连 cms_topic/cms_topic_chapter/ums_member/coop_perk 的展示查询;两个入参均可空 */
    public List<MerchantChapterOffer> selectAdminQueue(@Param("topicId") Long topicId, @Param("status") Integer status);

    /**
     * 后台定档定参专用:条款列**全列覆写**(刻意无 &lt;if&gt; —— 换档必须能把 perk_id/per_head_fee/valid_end
     * 写回 NULL;形状由应用层 assertTermsShape 与 DDL ck_offer_terms 双层兜住)
     */
    public int updateTerms(MerchantChapterOffer o);

    /** F12:承接方本人设置是否接受亲子票与儿童份说明;where 带 merchant_id 与 status=1,0 行由调用方拒。 */
    public int updateFamilyAcceptance(MerchantChapterOffer o);

    /** FE-G5:生效供给的玩家可见卡片(店名、权益名、含/另付、预约)。只读展示。 */
    List<MerchantChapterOffer> selectLiveDisplayByChapterIds(@Param("chapterIds") List<Long> chapterIds);

    /** FE-G5:承接方改自己生效供给的展示条款(where 带 merchant_id 与 status=1)。 */
    int updateDisplayTerms(MerchantChapterOffer o);

    /**
     * 核销事务专用:锁住这一行供给(FOR UPDATE,当前读)并读回每日名额、开始日期与今天已核销份数。
     * 键 dailyCapacity / validStart(yyyy-MM-dd) / usedToday;NULL 列不出现在 map 里。today = Asia/Shanghai 自然日 yyyy-MM-dd。
     */
    java.util.Map<String, Object> selectRedeemLimitsForUpdate(@Param("id") Long id, @Param("today") String today);

    /** 核销成立:今天的已核销份数 +1(日期不是今天则从 1 重新计)。调用方须已持有该行的锁。 */
    int addDailyUsed(@Param("id") Long id, @Param("today") String today);

    /** 撤销今天的核销:今天的已核销份数 -1;日期不是今天或已为 0 则 0 行。 */
    int releaseDailyUsed(@Param("id") Long id, @Param("today") String today);

    /** 玩家端展示:这些供给今天已核销的份数,每行 offerId / usedToday;只读、普通读。 */
    List<java.util.Map<String, Object>> selectDailyUsedByOfferIds(@Param("offerIds") List<Long> offerIds,
                                                                  @Param("today") String today);

    /** 承接方读回自己生效供给的展示条款;不是本商家的生效供给 = null。 */
    MerchantChapterOffer selectDisplayTermsOwned(@Param("id") Long id, @Param("merchantId") Long merchantId);

    /** 承接方改自己生效供给的门店条款(每日容量 / 开始日期 / 售罄或替代规则 / 门店照片);归属在 where 里。 */
    int updateShopTerms(MerchantChapterOffer patch);

    /**
     * P1-9:这些章节里「已退出(status=0 且有退出原因)」的供给,每行 chapterId / merchantId / replacing
     * (1 = 已有进行中的补位:待确认的补位供给,或待接受 / 已通过的补位申请)。只用存量列,只读。
     */
    List<java.util.Map<String, Object>> selectWithdrawnByChapterIds(@Param("chapterIds") List<Long> chapterIds);

    int approveReplacement(@Param("id") Long id, @Param("merchantId") Long merchantId);

    /** 某章节当前在供给的 offer(只返 status=1;失效的留在表里供流水追溯,不该进供给池) */
    public List<MerchantChapterOffer> selectByChapter(@Param("chapterId") Long chapterId);

    /**
     * 批量版 {@link #selectByChapter}:列表页一次取回多章的生效供给,避免逐章查询。
     *
     * <p>⚠️ 复用同一个 {@code liveOffer} sql 片段(status=1 且 valid_end 未过期),
     * 不另写一份条件 —— 这两处一旦分叉,列表页与详情页的名额就会对不上,
     * 而「漏了 valid_end 把过期供给算成占用」正是这张表上最容易犯的错。
     */
    public List<MerchantChapterOffer> selectLiveByChapterIds(@Param("chapterIds") List<Long> chapterIds);

    /** 章节删除前的引用保护：失效 offer 也仍可能被历史核销流水引用，不能只数生效行。 */
    int countAllByChapter(@Param("chapterId") Long chapterId);

    /** 某主题当前在供给的 offer(只返 status=1) */
    public List<MerchantChapterOffer> selectByTopic(@Param("topicId") Long topicId);

    /** M-04:本商家(merchant_id = 店主 memberId)有生效供给的主题,供工作台「即将到店」读取。 */
    public List<Long> selectLiveTopicIdsByMerchant(@Param("merchantId") Long merchantId);

    /**
     * 核销时原子扣减配额,返回影响行数,0 = 配额已用尽或 offer 已失效。
     * ⚠️ **防超发的唯一防线**:必须是「够扣才扣」的条件 update,不能先 select 判断再 update ——
     * 读判之间没有行锁,并发核销会双双通过判断然后各自 +1,发出去的份数超过 quota_total。
     * 调用方只认返回值:!=1 就不许放行核销。
     */
    public int consumeQuota(@Param("id") Long id);

    /** 撤销核销时回补配额;where quota_used &gt; 0 防重复撤销把已用份数扣成负数 */
    public int releaseQuota(@Param("id") Long id);

    /** 商家退出:标 status=0 而非删行 —— redemption.offer_id 引用它,删了历史流水就断链 */
    public int deactivate(@Param("id") Long id);

    /** 某章节剩余可核销份数合计(只算 status=1);无生效 offer→0,供开卖前置的容量校验用 */
    public Integer sumRemainingQuotaByChapter(@Param("chapterId") Long chapterId);

    /**
     * 同上,但走**当前读**(FOR SHARE)—— 购票容量校验专用。
     *
     * ⚠️ 为什么必须另开一个方法而不是给上面那条加 FOR SHARE:
     * RR 隔离级别下普通读走 read view(快照),而 read view 在事务里**第一次普通读**时就建好了 ——
     * reserveEntitlements 一进来的 selectRequiredByTopic 就把它建了,之后再 FOR UPDATE 锁章节行也没用:
     * 锁能等到对手提交,但锁后的普通聚合读**看不见**对手刚提交的 entitlement ⇒ 两边算出同样的容量
     * ⇒ 双双插入 ⇒ 超卖。真库实测:供给 1 座 2 并发买家 → sold=2;压测 8 买家 3 座 → 8 人全买进、零告警。
     * 当前读不吃 read view,总是读最新已提交 ⇒ 这才是防超卖的真防线,行锁只负责串行化与防 ABBA。
     *
     * ⚠️ 只在购票事务里用。只读展示路径(topicSellableCapacity / chapterCoverageRatio)不能用它,
     * 否则每次浏览都上 S 锁。
     */
    public Integer sumRemainingQuotaByChapterForUpdate(@Param("chapterId") Long chapterId);
    int countAllByChapterAndMerchant(@Param("chapterId") Long chapterId, @Param("merchantId") Long merchantId);
}
