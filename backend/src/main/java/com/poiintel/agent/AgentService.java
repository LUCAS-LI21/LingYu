package com.poiintel.agent;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import lombok.RequiredArgsConstructor;

/**
 * 数据接入 Agent 的 P0：单实体单字段补全。
 *
 * 流程（对应 docs/design/数据接入Agent.md 第 3 节）：
 *   搜索 → 抽取（LLM）→ 复核（LLM 独立上下文）→ 规则校验（代码）→ 出建议（不写库）
 *
 * 设计原则：LLM 只负责"读页面、写 JSON"，判定由代码做；最终仍要管理员点采纳。
 */
@Service
@RequiredArgsConstructor
public class AgentService {

    private static final Logger log = LoggerFactory.getLogger(AgentService.class);

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;
    private final DeepSeekClient deepSeek;

    private static final Map<String, String> FIELD_LABEL = Map.of(
            "address", "详细地址",
            "phone", "联系电话",
            "openingHours", "营业时间");

    public Map<String, Object> propose(String entityType, String entityId, String field) {
        String table = "bank".equals(entityType) ? "poi_bank" : "poi_community";
        String column = switch (field) {
            case "address" -> "address";
            case "phone" -> "phone";
            case "openingHours" -> "opening_hours";
            default -> throw new IllegalArgumentException("不支持的字段：" + field);
        };

        Map<String, Object> entity;
        try {
            entity = jdbcTemplate.queryForMap("SELECT * FROM " + table + " WHERE id = ?", entityId);
        } catch (Exception ex) {
            throw new IllegalArgumentException("实体不存在：" + entityId);
        }

        String name = String.valueOf(entity.get("name"));
        String current = entity.get(column) == null ? "" : String.valueOf(entity.get(column)).trim();
        String district = String.valueOf(entity.getOrDefault("district", ""));

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("entityType", entityType);
        result.put("entityId", entityId);
        result.put("name", name);
        result.put("field", field);

        if (!current.isEmpty()) {
            result.put("status", "skipped");
            result.put("reason", "该字段已有值，无需补全：" + current);
            return result;
        }
        if (!deepSeek.enabled()) {
            result.put("status", "disabled");
            result.put("reason", "未配置 DEEPSEEK_API_KEY");
            return result;
        }

        long runId = startRun(entityType, entityId, field);
        List<Map<String, Object>> steps = new ArrayList<>();
        try {
            // ① 搜索
            String query = name + " " + district + " 深圳 " + FIELD_LABEL.getOrDefault(field, field);
            List<DeepSeekClient.SearchHit> hits = deepSeek.search(query, 5);
            steps.add(step("search", Map.of("query", query, "hits", hits.size())));

            // ② 抽取
            DeepSeekClient.ChatResult extract = deepSeek.chatJson(EXTRACT_SYSTEM, buildExtractPrompt(name, district, field, hits), 600);
            JsonNode proposal = parseJson(extract.content());
            steps.add(step("extract", Map.of(
                    "value", proposal.path("value").asText(""),
                    "confidence", proposal.path("confidence").asDouble(0),
                    "tokens", extract.promptTokens() + extract.completionTokens(),
                    "latencyMs", extract.latencyMs())));

            String value = proposal.path("value").asText("").trim();
            String evidence = proposal.path("evidence").asText("").trim();
            String sourceUrl = proposal.path("sourceUrl").asText("").trim();
            double confidence = proposal.path("confidence").asDouble(0);

            if (value.isEmpty()) {
                finishRun(runId, "rejected", "抽取结果为空", extract, null);
                result.put("status", "rejected");
                result.put("reason", "未从搜索结果中抽取到有效值");
                return result;
            }

            // ③ 复核（独立上下文，只看值与证据，不给它看抽取过程的推理）
            DeepSeekClient.ChatResult verify = deepSeek.chatJson(VERIFY_SYSTEM,
                    "字段：" + FIELD_LABEL.getOrDefault(field, field) + "\n候选值：" + value
                            + "\n证据原文：" + evidence + "\n来源：" + sourceUrl, 200);
            JsonNode verdict = parseJson(verify.content());
            boolean supported = verdict.path("supported").asBoolean(false);
            steps.add(step("verify", Map.of(
                    "supported", supported,
                    "reason", verdict.path("reason").asText(""),
                    "tokens", verify.promptTokens() + verify.completionTokens())));

            // ④ 规则校验（代码，不依赖模型）
            List<String> problems = new ArrayList<>();
            if (!supported) problems.add("复核未通过：" + verdict.path("reason").asText("证据不足"));
            if (!evidence.contains(value)) problems.add("证据中找不到该值（疑似幻觉）");
            if (value.length() < 4 || value.length() > 120) problems.add("值长度异常：" + value.length());
            if (sourceUrl.isEmpty() || !sourceUrl.startsWith("http")) problems.add("缺少有效来源 URL");
            if ("address".equals(field)) {
                if (!value.contains("深圳")) problems.add("地址不含'深圳'，存疑");
                // 防"张冠李戴"：同名网点可能有多家，地址必须落在实体所属区
                String entityDistrict = String.valueOf(entity.getOrDefault("district", "")).trim();
                if (!entityDistrict.isEmpty() && !value.contains(entityDistrict)) {
                    problems.add("地址与所属区不一致（该点位在" + entityDistrict + "）");
                }
                // 身份校验：实体名若只有品牌（如"交通银行"），无法确认搜到的是不是同一个网点
                if (!BRANCH_LEVEL.matcher(name).find()) {
                    problems.add("名称未含网点级别（支行/分行/营业部等），无法确认与搜索结果是否同一网点");
                }
            }

            String status = problems.isEmpty() ? "ready" : "needs_review";
            if (problems.isEmpty() && confidence < 0.6) {
                status = "needs_review";
                problems.add("置信度偏低：" + confidence);
            }

            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("value", value);
            payload.put("evidence", evidence);
            payload.put("sourceUrl", sourceUrl);
            payload.put("confidence", confidence);
            payload.put("problems", problems);
            finishRun(runId, status, objectMapper.writeValueAsString(payload), extract, verify);

            result.put("status", status);
            result.put("proposal", payload);
            result.put("steps", steps);
            result.put("runId", runId);
            return result;
        } catch (Exception ex) {
            log.warn("[agent] 补全失败：{}", ex.getMessage());
            finishRun(runId, "failed", ex.getMessage(), null, null);
            result.put("status", "failed");
            result.put("reason", ex.getMessage());
            return result;
        }
    }

    /** 管理员采纳：写入主表 + 版本记录，来源记为 agent 与原始 URL */
    public Map<String, Object> apply(long runId, String reviewer) {
        Map<String, Object> run = jdbcTemplate.queryForMap("SELECT * FROM agent_run WHERE id = ?", runId);
        if (!"ready".equals(run.get("status"))) {
            throw new IllegalStateException("只有 ready 状态的建议可以采纳，当前：" + run.get("status"));
        }
        JsonNode payload = parseJson(String.valueOf(run.get("result_json")));
        String value = payload.path("value").asText("");
        String url = payload.path("sourceUrl").asText("");
        String entityType = String.valueOf(run.get("entity_type"));
        String entityId = String.valueOf(run.get("entity_id"));
        String field = String.valueOf(run.get("field"));
        String table = "bank".equals(entityType) ? "poi_bank" : "poi_community";
        String column = "openingHours".equals(field) ? "opening_hours" : field;

        Map<String, Object> before = jdbcTemplate.queryForMap("SELECT * FROM " + table + " WHERE id = ?", entityId);
        jdbcTemplate.update("UPDATE " + table + " SET " + column + " = ?, updated_at = NOW() WHERE id = ?",
                value, entityId);
        Map<String, Object> after = jdbcTemplate.queryForMap("SELECT * FROM " + table + " WHERE id = ?", entityId);
        // operator 列只有 64 字符，记「谁 + 来源域名」，完整 URL 在 agent_run.result_json 里
        String operator = ("agent:" + reviewer + "@" + hostOf(url));
        if (operator.length() > 64) {
            operator = operator.substring(0, 64);
        }
        jdbcTemplate.update("""
                INSERT INTO poi_version (poi_type, poi_id, change_type, before_json, after_json, changed_fields, operator)
                VALUES (?, ?, 'update', ?, ?, ?, ?)
                """, entityType, entityId, toJson(before), toJson(after), column, operator);
        jdbcTemplate.update("UPDATE agent_run SET status = 'applied', reviewed_by = ?, reviewed_at = NOW() WHERE id = ?",
                reviewer, runId);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("runId", runId);
        result.put("status", "applied");
        result.put("field", column);
        result.put("value", value);
        result.put("sourceUrl", url);
        return result;
    }

    public List<Map<String, Object>> recentRuns(int limit) {
        return jdbcTemplate.queryForList("""
                SELECT id, entity_type, entity_id, field, status, result_json, reviewed_by, created_at
                FROM agent_run ORDER BY id DESC LIMIT ?
                """, limit);
    }

    /**
     * 批量补全：挑出缺该字段的实体，逐个跑 propose。
     * 只出建议、不写库；返回各类结果计数，便于判断要不要继续投人审。
     */
    public Map<String, Object> batch(String entityType, String field, int limit, boolean branchOnly) {
        String table = "bank".equals(entityType) ? "poi_bank" : "poi_community";
        String column = switch (field) {
            case "address" -> "address";
            case "phone" -> "phone";
            case "openingHours" -> "opening_hours";
            default -> throw new IllegalArgumentException("不支持的字段：" + field);
        };
        int size = Math.min(Math.max(limit, 1), 20);

        String sql = "SELECT id FROM " + table + " WHERE " + column + " = ''"
                + (branchOnly ? " AND name REGEXP '支行|分行|营业部|分理处|储蓄所|ATM'" : "")
                + " ORDER BY id LIMIT " + size;
        List<String> ids = jdbcTemplate.queryForList(sql, String.class);

        List<Map<String, Object>> items = new ArrayList<>();
        Map<String, Integer> tally = new LinkedHashMap<>();
        for (String id : ids) {
            Map<String, Object> one = propose(entityType, id, field);
            String status = String.valueOf(one.get("status"));
            tally.merge(status, 1, Integer::sum);
            Map<String, Object> brief = new LinkedHashMap<>();
            brief.put("id", id);
            brief.put("name", one.get("name"));
            brief.put("status", status);
            brief.put("runId", one.get("runId"));
            items.add(brief);
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("requested", size);
        result.put("processed", ids.size());
        result.put("tally", tally);
        result.put("items", items);
        return result;
    }

    // ---------- 内部 ----------

    private static final java.util.regex.Pattern BRANCH_LEVEL =
            java.util.regex.Pattern.compile(".*(支行|分行|营业部|分理处|储蓄所|ATM|自助|社区).*");

    private static final String EXTRACT_SYSTEM = """
            你是严谨的数据抽取器。只输出 JSON，不要解释。
            输出格式：{"value":"","evidence":"","sourceUrl":"","confidence":0.0}
            规则：
            1. value 必须是搜索结果原文中明确出现的值，不得推测、不得改写
            2. evidence 必须是包含该值的原文片段（逐字复制）
            3. sourceUrl 必须是提供该证据的链接
            4. 找不到就输出 {"value":"","evidence":"","sourceUrl":"","confidence":0}
            """;

    private static final String VERIFY_SYSTEM = """
            你是核查员。判断"证据原文"是否真的支持"候选值"。只输出 JSON：
            {"supported":true/false,"reason":"一句话理由"}
            只有证据原文里逐字出现该值时才算支持。
            """;

    private String buildExtractPrompt(String name, String district, String field,
            List<DeepSeekClient.SearchHit> hits) {
        StringBuilder sb = new StringBuilder();
        sb.append("实体：").append(name).append("（区：").append(district).append("）\n");
        sb.append("要补的字段：").append(FIELD_LABEL.getOrDefault(field, field)).append("\n");
        sb.append("搜索结果：\n");
        int index = 1;
        for (DeepSeekClient.SearchHit hit : hits) {
            sb.append("[").append(index++).append("] ").append(hit.title()).append("\n");
            sb.append("URL: ").append(hit.url()).append("\n");
            String text = hit.content().isBlank() ? hit.summary() : hit.content();
            sb.append("正文: ").append(text, 0, Math.min(text.length(), 1800)).append("\n\n");
        }
        return sb.toString();
    }

    private Map<String, Object> step(String name, Map<String, Object> detail) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("step", name);
        map.putAll(detail);
        return map;
    }

    private long startRun(String entityType, String entityId, String field) {
        jdbcTemplate.update("""
                INSERT INTO agent_run (entity_type, entity_id, field, status, model)
                VALUES (?, ?, ?, 'running', 'deepseek-flash')
                """, entityType, entityId, field);
        Long id = jdbcTemplate.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        return id == null ? 0L : id;
    }

    private void finishRun(long runId, String status, String resultJson,
            DeepSeekClient.ChatResult extract, DeepSeekClient.ChatResult verify) {
        jdbcTemplate.update("""
                UPDATE agent_run SET status = ?, result_json = ?, prompt_tokens = ?, completion_tokens = ?,
                       latency_ms = ?, finished_at = NOW() WHERE id = ?
                """, status, resultJson,
                (extract == null ? 0 : extract.promptTokens()) + (verify == null ? 0 : verify.promptTokens()),
                (extract == null ? 0 : extract.completionTokens()) + (verify == null ? 0 : verify.completionTokens()),
                (extract == null ? 0 : extract.latencyMs()) + (verify == null ? 0 : verify.latencyMs()),
                runId);
    }

    private String hostOf(String url) {
        try {
            return java.net.URI.create(url).getHost() == null ? "unknown" : java.net.URI.create(url).getHost();
        } catch (Exception ex) {
            return "unknown";
        }
    }

    private JsonNode parseJson(String text) {        try {
            return objectMapper.readTree(text);
        } catch (Exception ex) {
            return objectMapper.createObjectNode();
        }
    }

    private String toJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception ex) {
            return "{}";
        }
    }
}
