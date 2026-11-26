package com.chengyinhub.business.service.support;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.util.HashSet;
import java.util.Set;

/**
 * 选项问答的证据表(2026-11-24 主人批准的原型:答题屏上同时摆出记录表与规则,玩家逐行划掉,最后选一行)。
 *
 * <p>只是原 {@code qa} PICK 单选的一层呈现扩展,判定一个字都不改:
 * <ul>
 *   <li>{@code qa.table = {columns[2..5], rows[2..12]{id, cells[]}}} 与 {@code qa.rules[0..6]{k, t}} 是题面,公开下发;</li>
 *   <li>有表时 {@code qa.options} 与表行一一对应(id 同序),仍走 SUBMIT_QA {optionId};</li>
 *   <li>选项上的 {@code rule}(规则序号,从 1 起)与 {@code correct}/{@code fb} 一样只留服务端,
 *       答错时写进本局状态 {@code lastRule},客户端据此把那枚规则标红。</li>
 * </ul>
 * 没有 {@code table} 的老配置不经过本类的任何分支,行为不变。
 */
public final class QaEvidenceTableSupport {

    /** 客户端能力键:不认识证据表的旧客户端开局前就 409,不让玩家看到半截屏。 */
    public static final String CAPABILITY = "qa.table";

    static final int MIN_COLUMNS = 2;
    static final int MAX_COLUMNS = 5;
    static final int MAX_COLUMN_CHARS = 12;
    static final int MIN_ROWS = 2;
    static final int MAX_ROWS = 12;
    static final int MAX_CELL_CHARS = 24;
    static final int MAX_RULES = 6;
    static final int MAX_RULE_KEY_CHARS = 3;
    static final int MAX_RULE_TEXT_CHARS = 30;

    private QaEvidenceTableSupport() {
    }

    /** 这一段选项问答带证据表(已启用 + PICK + table 是对象)。 */
    public static boolean present(JsonNode qa) {
        return qa != null && qa.isObject() && qa.path("enabled").asBoolean(false)
                && "PICK".equals(qa.path("mode").asText("")) && qa.path("table").isObject();
    }

    /** 有表时选项数的上限跟着表行走(2..12);没表仍是原来的 2..4。 */
    public static boolean declared(JsonNode qa) {
        JsonNode table = qa == null ? null : qa.get("table");
        return table != null && !table.isNull();
    }

    /**
     * 保存期校验。只在启用的问答上调用;没带 table / rules 时什么都不做(老配置不受影响)。
     *
     * @throws IllegalArgumentException 任何一条量程或对应关系不对
     */
    public static void validate(JsonNode qa) {
        JsonNode rulesNode = qa.get("rules");
        boolean hasRules = rulesNode != null && !rulesNode.isNull();
        if (!declared(qa)) {
            if (hasRules) throw new IllegalArgumentException("规则只能和证据表一起使用");
            return;
        }
        if (!"PICK".equals(qa.path("mode").asText(""))) {
            throw new IllegalArgumentException("证据表只能用于选项问答");
        }
        JsonNode table = qa.get("table");
        if (!table.isObject()) throw new IllegalArgumentException("证据表格式不正确");
        if (qa.path("multi").asBoolean(false)) throw new IllegalArgumentException("带证据表的问答只能单选");

        JsonNode columns = table.get("columns");
        if (columns == null || !columns.isArray() || columns.size() < MIN_COLUMNS || columns.size() > MAX_COLUMNS) {
            throw new IllegalArgumentException("证据表须为 2 至 5 列");
        }
        for (JsonNode column : columns) {
            String name = nonBlank(column, "证据表列名不能为空");
            if (chars(name) > MAX_COLUMN_CHARS) throw new IllegalArgumentException("证据表列名不能超过 12 字");
        }

        JsonNode rows = table.get("rows");
        if (rows == null || !rows.isArray() || rows.size() < MIN_ROWS || rows.size() > MAX_ROWS) {
            throw new IllegalArgumentException("证据表须为 2 至 12 行");
        }
        Set<String> rowIds = new HashSet<>();
        for (JsonNode row : rows) {
            if (!row.isObject()) throw new IllegalArgumentException("证据表行格式不正确");
            String id = nonBlank(row.get("id"), "证据表行 id 不能为空");
            if (!rowIds.add(id)) throw new IllegalArgumentException("证据表行 id 不能重复");
            JsonNode cells = row.get("cells");
            if (cells == null || !cells.isArray() || cells.size() != columns.size()) {
                throw new IllegalArgumentException("证据表每行的格数必须与列数相同");
            }
            for (JsonNode cell : cells) {
                if (cell == null || !cell.isTextual()) throw new IllegalArgumentException("证据表格子只能是文字");
                if (chars(cell.asText()) > MAX_CELL_CHARS) throw new IllegalArgumentException("证据表格子不能超过 24 字");
            }
        }

        int ruleCount = 0;
        if (hasRules) {
            if (!rulesNode.isArray() || rulesNode.size() > MAX_RULES) {
                throw new IllegalArgumentException("规则最多 6 条");
            }
            for (JsonNode rule : rulesNode) {
                if (!rule.isObject()) throw new IllegalArgumentException("规则格式不正确");
                String key = nonBlank(rule.get("k"), "规则编号不能为空");
                if (chars(key) > MAX_RULE_KEY_CHARS) throw new IllegalArgumentException("规则编号不能超过 3 字");
                String text = nonBlank(rule.get("t"), "规则内容不能为空");
                if (chars(text) > MAX_RULE_TEXT_CHARS) throw new IllegalArgumentException("规则内容不能超过 30 字");
            }
            ruleCount = rulesNode.size();
        }

        JsonNode options = qa.get("options");
        if (options == null || !options.isArray() || options.size() != rows.size()) {
            throw new IllegalArgumentException("带证据表的问答必须每行一个选项");
        }
        for (int i = 0; i < rows.size(); i++) {
            String rowId = rows.get(i).path("id").asText("").trim();
            JsonNode option = options.get(i);
            if (!rowId.equals(option.path("id").asText("").trim())) {
                throw new IllegalArgumentException("证据表选项 id 必须与表行 id 一致且顺序相同");
            }
            JsonNode rule = option.get("rule");
            if (rule == null || rule.isNull()) continue;
            if (!rule.isIntegralNumber() || rule.asInt() < 1 || rule.asInt() > ruleCount) {
                throw new IllegalArgumentException("选项 " + rowId + " 对应的规则序号不存在");
            }
        }
    }

    /** 公开面:逐字段 copy 表与规则(以后往里加字段默认不下发)。选项的 rule 不在这里,永远不下发。 */
    public static void copyPublic(ObjectNode target, JsonNode qa) {
        if (!present(qa)) return;
        JsonNode source = qa.path("table");
        ObjectNode table = target.putObject("table");
        ArrayNode columns = table.putArray("columns");
        for (JsonNode column : source.path("columns")) columns.add(column.asText(""));
        ArrayNode rows = table.putArray("rows");
        for (JsonNode row : source.path("rows")) {
            ObjectNode safeRow = rows.addObject();
            safeRow.put("id", row.path("id").asText(""));
            ArrayNode cells = safeRow.putArray("cells");
            for (JsonNode cell : row.path("cells")) cells.add(cell.asText(""));
        }
        ArrayNode rules = target.putArray("rules");
        for (JsonNode rule : qa.path("rules")) {
            rules.addObject().put("k", rule.path("k").asText("")).put("t", rule.path("t").asText(""));
        }
    }

    /**
     * 判定后写状态:答错且所选选项挂了规则 → {@code lastRule};答对或没挂规则 → 摘掉旧值。
     * 不带表的问答不碰状态,老局的状态形状一字不变。
     */
    public static void recordPick(JsonNode qa, ObjectNode kitState, JsonNode picked, boolean correct) {
        if (!present(qa)) return;
        int rule = picked == null ? 0 : picked.path("rule").asInt(0);
        if (!correct && rule > 0) kitState.put("lastRule", rule);
        else kitState.remove("lastRule");
    }

    private static String nonBlank(JsonNode node, String message) {
        if (node == null || !node.isTextual() || node.asText().trim().isEmpty()) {
            throw new IllegalArgumentException(message);
        }
        return node.asText().trim();
    }

    private static int chars(String value) {
        return value.codePointCount(0, value.length());
    }
}
