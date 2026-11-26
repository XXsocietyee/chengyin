package com.chengyinhub.business.service.support;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 以物换物(barter):背包 + 若干一次性换物报价,玩家在客户端预演整条换法,只在「就这样换」时交一次。
 *
 * <p>配置契约(与 iOS 线同名,不改名):
 * <pre>
 * barter: {enabled, title<=40, items[2..10]{id,name<=8,icon?}, start[1..6 item ids, 可重复],
 *          goals[1..3]{id,label<=10,need|keep item id}, offers[2..6]{id,key<=2,give,get,fb?<=60},
 *          maxTries>=0 (0=不限), xp>=0}
 * </pre>
 *
 * <p>★ 除每条报价的 {@code fb}(答错后的提示)外全部公开:换法本身就是题面,玩家要的是
 * 规划。fb 只在一次答错提交后作为反馈回给玩家,不进任何投影。
 *
 * <p>判定只在服务端:从 {@code start} 起按玩家提交的顺序逐步重放,每一步背包里必须有 give
 * (没有就是非法换法 → 400,不记次数),拿走一件 give、放进一件 get;走完后每个目标
 * 都满足(need = 背包里有;keep = 背包里还在)才算通过。
 */
public final class BarterGameplay {

    public static final String SECTION = "barter";
    public static final String STATE_KEY = "barter";

    static final int MAX_TITLE = 40;
    static final int MIN_ITEMS = 2;
    static final int MAX_ITEMS = 10;
    static final int MAX_ITEM_NAME = 8;
    static final int MIN_START = 1;
    static final int MAX_START = 6;
    static final int MIN_GOALS = 1;
    static final int MAX_GOALS = 3;
    static final int MAX_GOAL_LABEL = 10;
    static final int MIN_OFFERS = 2;
    static final int MAX_OFFERS = 6;
    static final int MAX_OFFER_KEY = 2;
    static final int MAX_FEEDBACK = 60;
    static final int MAX_ORDER = 6;
    static final int MAX_XP = 1000;

    /** 客户端只认这几种线条图标;不在表里的一律拒,免得端上画成空白。 */
    public static final Set<String> ICONS = Collections.unmodifiableSet(new LinkedHashSet<>(Arrays.asList(
            "clip", "coaster", "labels", "strap", "parcel", "tape", "book", "key", "ticket", "bag", "cup", "letter")));

    private static final Pattern ID = Pattern.compile("[A-Za-z0-9_-]{1,32}");
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private BarterGameplay() {
    }

    static boolean enabled(JsonNode section) {
        return section != null && section.isObject() && section.path("enabled").asBoolean(false);
    }

    /* ==================== 保存期校验 ==================== */

    public static void validate(JsonNode barter) {
        if (!enabled(barter)) return;
        text(barter, "title", MAX_TITLE, "换物题标题不能为空", "换物题标题不能超过 " + MAX_TITLE + " 字");

        JsonNode items = barter.get("items");
        if (items == null || !items.isArray() || items.size() < MIN_ITEMS || items.size() > MAX_ITEMS) {
            throw new IllegalArgumentException("换物题须配置 " + MIN_ITEMS + " 至 " + MAX_ITEMS + " 件物品");
        }
        Set<String> itemIds = new HashSet<>();
        for (JsonNode item : items) {
            object(item, "换物题物品格式不正确");
            if (!itemIds.add(id(item, "换物题物品 id 不能为空"))) throw new IllegalArgumentException("换物题物品 id 不能重复");
            text(item, "name", MAX_ITEM_NAME, "换物题物品名称不能为空", "换物题物品名称不能超过 " + MAX_ITEM_NAME + " 字");
            if (item.has("icon") && !item.get("icon").isNull()) {
                if (!item.get("icon").isTextual() || !ICONS.contains(item.get("icon").asText())) {
                    throw new IllegalArgumentException("换物题物品图标不在可选范围内");
                }
            }
        }

        JsonNode start = barter.get("start");
        if (start == null || !start.isArray() || start.size() < MIN_START || start.size() > MAX_START) {
            throw new IllegalArgumentException("换物题背包初始须放 " + MIN_START + " 至 " + MAX_START + " 件物品");
        }
        for (JsonNode one : start) {
            if (!one.isTextual() || !itemIds.contains(one.asText())) {
                throw new IllegalArgumentException("换物题背包引用了不存在的物品");
            }
        }

        JsonNode goals = barter.get("goals");
        if (goals == null || !goals.isArray() || goals.size() < MIN_GOALS || goals.size() > MAX_GOALS) {
            throw new IllegalArgumentException("换物题须配置 " + MIN_GOALS + " 至 " + MAX_GOALS + " 个目标");
        }
        Set<String> goalIds = new HashSet<>();
        for (JsonNode goal : goals) {
            object(goal, "换物题目标格式不正确");
            if (!goalIds.add(id(goal, "换物题目标 id 不能为空"))) throw new IllegalArgumentException("换物题目标 id 不能重复");
            text(goal, "label", MAX_GOAL_LABEL, "换物题目标名称不能为空", "换物题目标名称不能超过 " + MAX_GOAL_LABEL + " 字");
            boolean need = goal.has("need") && !goal.get("need").isNull();
            boolean keep = goal.has("keep") && !goal.get("keep").isNull();
            if (need == keep) throw new IllegalArgumentException("换物题每个目标须且仅须写 need 或 keep 之一");
            JsonNode ref = goal.get(need ? "need" : "keep");
            if (!ref.isTextual() || !itemIds.contains(ref.asText())) {
                throw new IllegalArgumentException("换物题目标引用了不存在的物品");
            }
        }

        JsonNode offers = barter.get("offers");
        if (offers == null || !offers.isArray() || offers.size() < MIN_OFFERS || offers.size() > MAX_OFFERS) {
            throw new IllegalArgumentException("换物题须配置 " + MIN_OFFERS + " 至 " + MAX_OFFERS + " 条换物");
        }
        Set<String> offerIds = new HashSet<>();
        for (JsonNode offer : offers) {
            object(offer, "换物题换物格式不正确");
            if (!offerIds.add(id(offer, "换物题换物 id 不能为空"))) throw new IllegalArgumentException("换物题换物 id 不能重复");
            text(offer, "key", MAX_OFFER_KEY, "换物题换物标记不能为空", "换物题换物标记不能超过 " + MAX_OFFER_KEY + " 字");
            for (String side : new String[] { "give", "get" }) {
                JsonNode ref = offer.get(side);
                if (ref == null || !ref.isTextual() || !itemIds.contains(ref.asText())) {
                    throw new IllegalArgumentException("换物题换物引用了不存在的物品");
                }
            }
            if (offer.has("fb") && !offer.get("fb").isNull()) {
                if (!offer.get("fb").isTextual()) throw new IllegalArgumentException("换物题提示格式不正确");
                if (offer.get("fb").asText().length() > MAX_FEEDBACK) {
                    throw new IllegalArgumentException("换物题提示不能超过 " + MAX_FEEDBACK + " 字");
                }
            }
        }

        JsonNode maxTries = barter.get("maxTries");
        if (maxTries != null && !maxTries.isNull() && (!maxTries.canConvertToInt() || !maxTries.isIntegralNumber() || maxTries.asInt() < 0)) {
            throw new IllegalArgumentException("换物题可以交几次须为不小于 0 的整数,0 表示不限");
        }
        JsonNode xp = barter.get("xp");
        if (xp != null && !xp.isNull() && (!xp.isIntegralNumber() || xp.asInt() < 0 || xp.asInt() > MAX_XP)) {
            throw new IllegalArgumentException("换物题奖励分须为 0 至 " + MAX_XP);
        }
    }

    /* ==================== 公开投影 ==================== */

    /** 公开面:除每条换物的 fb 之外全部下发。白名单逐字段 copy —— 以后加字段默认不下发。 */
    public static ObjectNode safeConfig(JsonNode source) {
        ObjectNode value = MAPPER.createObjectNode();
        boolean on = enabled(source);
        value.put("enabled", on);
        if (!on) return value;
        value.put("title", source.path("title").asText(""));
        ArrayNode items = value.putArray("items");
        for (JsonNode item : source.path("items")) {
            ObjectNode one = items.addObject();
            one.put("id", item.path("id").asText(""));
            one.put("name", item.path("name").asText(""));
            if (item.path("icon").isTextual()) one.put("icon", item.path("icon").asText());
        }
        ArrayNode start = value.putArray("start");
        for (JsonNode one : source.path("start")) start.add(one.asText(""));
        ArrayNode goals = value.putArray("goals");
        for (JsonNode goal : source.path("goals")) {
            ObjectNode one = goals.addObject();
            one.put("id", goal.path("id").asText(""));
            one.put("label", goal.path("label").asText(""));
            if (goal.path("need").isTextual()) one.put("need", goal.path("need").asText());
            if (goal.path("keep").isTextual()) one.put("keep", goal.path("keep").asText());
        }
        ArrayNode offers = value.putArray("offers");
        for (JsonNode offer : source.path("offers")) {
            ObjectNode one = offers.addObject();
            one.put("id", offer.path("id").asText(""));
            one.put("key", offer.path("key").asText(""));
            one.put("give", offer.path("give").asText(""));
            one.put("get", offer.path("get").asText(""));
            // ★ fb 不下发:它只在答错之后作为反馈出现
        }
        value.put("maxTries", source.path("maxTries").asInt(0));
        value.put("xp", source.path("xp").asInt(0));
        return value;
    }

    /** 运行期视图:公开面 + 本局状态(lastFeedback 是答错后才写进状态的那一条 fb)。 */
    public static ObjectNode runtimeView(JsonNode source, JsonNode kitState) {
        ObjectNode value = safeConfig(source);
        value.remove("enabled");
        JsonNode st = kitState == null ? MAPPER.createObjectNode() : kitState;
        value.put("attempts", st.path("attempts").asInt(0));
        value.put("finished", st.path("finished").asBoolean(false));
        value.put("passed", st.path("passed").asBoolean(false));
        value.put("lastCorrect", st.path("lastCorrect").asBoolean(false));
        ArrayNode lastOrder = value.putArray("lastOrder");
        for (JsonNode one : st.path("lastOrder")) lastOrder.add(one.asText(""));
        value.put("lastFeedback", st.path("lastFeedback").asText(""));
        ArrayNode failedGoals = value.putArray("failedGoals");
        for (JsonNode one : st.path("failedGoals")) failedGoals.add(one.asText(""));
        return value;
    }

    /* ==================== 判定 ==================== */

    /**
     * 判一次「就这样换」。
     *
     * @param cfg     冻结的 barter 段
     * @param kit     本局 barter 状态(就地改写)
     * @param rawOrder 玩家提交的换物 id 序列
     * @return 这一次是否通过
     * @throws IllegalArgumentException 提交形状不合法或某一步背包里没有要换出去的东西(不记次数)
     * @throws IllegalStateException    这一局已经结束
     */
    public static boolean judge(JsonNode cfg, ObjectNode kit, Object rawOrder) {
        if (!enabled(cfg)) throw new IllegalArgumentException("该玩法未开启换物题");
        if (kit.path("finished").asBoolean(false)) throw new IllegalStateException("这一局换物已经结束了");
        if (!(rawOrder instanceof List)) throw new IllegalArgumentException("请提交换物顺序");
        List<?> submitted = (List<?>) rawOrder;
        if (submitted.isEmpty()) throw new IllegalArgumentException("请至少换一次再提交");
        if (submitted.size() > MAX_ORDER) throw new IllegalArgumentException("一次最多换 " + MAX_ORDER + " 步");

        Map<String, JsonNode> offers = new HashMap<>();
        for (JsonNode offer : cfg.path("offers")) offers.put(offer.path("id").asText(""), offer);
        Map<String, String> names = new HashMap<>();
        for (JsonNode item : cfg.path("items")) names.put(item.path("id").asText(""), item.path("name").asText(""));

        List<String> order = new ArrayList<>();
        for (Object one : submitted) {
            String id = one == null ? "" : String.valueOf(one).trim();
            if (!offers.containsKey(id)) throw new IllegalArgumentException("换物顺序里有不存在的换物");
            if (order.contains(id)) throw new IllegalArgumentException("每条换物只能用一次");
            order.add(id);
        }

        List<String> bag = new ArrayList<>();
        for (JsonNode one : cfg.path("start")) bag.add(one.asText(""));
        for (int i = 0; i < order.size(); i++) {
            JsonNode offer = offers.get(order.get(i));
            String give = offer.path("give").asText("");
            if (!bag.remove(give)) {
                throw new IllegalArgumentException("第 " + (i + 1) + " 步换不了：背包里没有"
                        + names.getOrDefault(give, "要换出去的东西"));
            }
            bag.add(offer.path("get").asText(""));
        }

        List<String> failed = unmetGoals(cfg, bag);
        boolean correct = failed.isEmpty();

        int attempts = kit.path("attempts").asInt(0) + 1;
        kit.put("attempts", attempts);
        kit.put("lastCorrect", correct);
        ArrayNode lastOrder = kit.putArray("lastOrder");
        for (String id : order) lastOrder.add(id);
        ArrayNode failedGoals = kit.putArray("failedGoals");
        for (String id : failed) failedGoals.add(id);
        if (correct) {
            kit.put("lastFeedback", "");
            kit.put("finished", true);
            kit.put("passed", true);
            return true;
        }
        String feedback = "";
        for (String id : order) {
            String fb = offers.get(id).path("fb").asText("").trim();
            if (!fb.isEmpty()) { feedback = fb; break; }
        }
        kit.put("lastFeedback", feedback);
        int allowed = cfg.path("maxTries").asInt(0);
        if (allowed > 0 && attempts >= allowed) {
            kit.put("finished", true);
            kit.put("passed", false);
        }
        return false;
    }

    /** 背包走完后没满足的目标 id(need 与 keep 都是「这件还在背包里」)。 */
    static List<String> unmetGoals(JsonNode cfg, List<String> bag) {
        List<String> failed = new ArrayList<>();
        for (JsonNode goal : cfg.path("goals")) {
            String want = goal.path("need").isTextual() ? goal.path("need").asText() : goal.path("keep").asText("");
            if (!bag.contains(want)) failed.add(goal.path("id").asText(""));
        }
        return failed;
    }

    /* ==================== 小工具 ==================== */

    private static void object(JsonNode node, String message) {
        if (node == null || !node.isObject()) throw new IllegalArgumentException(message);
    }

    private static String id(JsonNode node, String blank) {
        String value = node.path("id").asText("").trim();
        if (value.isEmpty()) throw new IllegalArgumentException(blank);
        if (!ID.matcher(value).matches()) throw new IllegalArgumentException("id 只能使用 1 至 32 位字母、数字、下划线或短横线");
        return value;
    }

    private static void text(JsonNode node, String field, int max, String blank, String tooLong) {
        JsonNode value = node.get(field);
        if (value == null || !value.isTextual() || value.asText().trim().isEmpty()) throw new IllegalArgumentException(blank);
        if (value.asText().trim().length() > max) throw new IllegalArgumentException(tooLong);
    }
}
