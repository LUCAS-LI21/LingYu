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
 * 数据接入 Agent：搜索 → LLM 抽取 → LLM 独立复核 → 规则校验 → 出建议（不写库）。
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

    /** 表名/列名白名单，禁止拼接外部字符串 */
    private static final Map<String, String> TABLE_BY_TYPE = Map.of(
            "bank", "poi_bank",
            "community", "poi_community");
    private static final Map<String, String> COLUMN_BY_FIELD = Map.of(
            "address", "address",
            "phone", "phone",
            "openingHours", "opening_hours");

    /** 两次 propose 最小间隔 1.2s */
    private static final long MIN_INTERVAL_MS = 1200;
    private static long lastProposeAt = 0;

    private static String normalize(String text) {
        if (text == null) return "";
        String nfkc;
        try {
            nfkc = java.text.Normalizer.normalize(text, java.text.Normalizer.Form.NFKC);
        } catch (Exception ex) {
            nfkc = text;
        }
        return nfkc.replaceAll("[\\s\\u00a0\\u3000]", "");
    }

    public Map<String, Object> propose(String entityType, String entityId, String field) {
        String table = TABLE_BY_TYPE.get(entityType);
        String column = COLUMN_BY_FIELD.get(field);
        if (table == null || column == null) {
            throw new IllegalArgumentException("非法实体类型或字段：" + entityType + "/" + field);
        }
        throttle();
        // 同一实体同一字段已有进行中运行时直接返回
        Integer running = jdbcTemplate.queryForObject("""
                SELECT COUNT(*) FROM agent_run
                WHERE entity_type = ? AND entity_id = ? AND field = ? AND status = 'running'
                  AND created_at > DATE_SUB(NOW(), INTERVAL 10 MINUTE)
                """, Integer.class, entityType, entityId, field);
        if (running != null && running > 0) {
            Map<String, Object> busy = new LinkedHashMap<>();
            busy.put("status", "busy");
            busy.put("reason", "该实体字段已有进行中的补全，请稍后再试");
            return busy;
        }

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

            // 域名白名单闸门：非 L1 来源直接拒绝，不进入复核
            if (!com.poiintel.common.SourcePolicy.allowed(sourceUrl)) {
                String reason = com.poiintel.common.SourcePolicy.rejectReason(sourceUrl);
                finishRun(runId, "rejected", reason, extract, null);
                result.put("status", "rejected");
                result.put("reason", reason);
                return result;
            }

            if (value.isEmpty()) {
                finishRun(runId, "rejected", "抽取结果为空", extract, null);
                result.put("status", "rejected");
                result.put("reason", "未从搜索结果中抽取到有效值");
                return result;
            }

            // ③ 复核：独立上下文，仅传入值与证据
            DeepSeekClient.ChatResult verify = deepSeek.chatJson(VERIFY_SYSTEM,
                    "字段：" + FIELD_LABEL.getOrDefault(field, field) + "\n候选值：" + value
                            + "\n证据原文：" + evidence + "\n来源：" + sourceUrl, 200);
            JsonNode verdict = parseJson(verify.content());
            boolean supported = verdict.path("supported").asBoolean(false);
            steps.add(step("verify", Map.of(
                    "supported", supported,
                    "reason", verdict.path("reason").asText(""),
                    "tokens", verify.promptTokens() + verify.completionTokens())));

            // ④ 规则校验（不依赖模型）
            List<String> problems = new ArrayList<>();
            if (!supported) problems.add("复核未通过：" + verdict.path("reason").asText("证据不足"));
            // 不信任模型给出的 evidence，回到原始搜索结果复现
            if (!normalize(evidence).contains(normalize(value))) {
                problems.add("证据中找不到该值（疑似幻觉）");
            }
            if (!evidenceInHits(hits, sourceUrl, value)) {
                problems.add("证据未能在原始搜索结果中复现（来源 URL 或正文不匹配）");
            }
            if (value.length() < 4 || value.length() > 120) problems.add("值长度异常：" + value.length());
            if (sourceUrl.isEmpty() || !sourceUrl.startsWith("https://")) problems.add("来源 URL 非法（必须是 https）");
            if ("phone".equals(field) && !value.matches("^[0-9+()\\-\\s]{5,32}$")) {
                problems.add("电话格式异常");
            }
            if ("address".equals(field)) {
                if (!value.contains("深圳")) problems.add("地址不含'深圳'，存疑");
                // 地址须落在实体所属区，避免同名网点误配
                String entityDistrict = String.valueOf(entity.getOrDefault("district", "")).trim();
                if (!entityDistrict.isEmpty() && !value.contains(entityDistrict)) {
                    problems.add("地址与所属区不一致（该点位在" + entityDistrict + "）");
                }
                // 名称须含网点级别，否则无法确认与搜索结果同一网点
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

    /**
     * 管理员采纳：写主表 + 版本记录（同一事务）；仅允许写空字段，期间被人工改过则拒绝。
     */
    @org.springframework.transaction.annotation.Transactional
    public Map<String, Object> apply(long runId, String reviewer) {
        Map<String, Object> run = jdbcTemplate.queryForMap(
                "SELECT * FROM agent_run WHERE id = ? FOR UPDATE", runId);
        if (!"ready".equals(run.get("status"))) {
            throw new IllegalStateException("只有 ready 状态的建议可以采纳，当前：" + run.get("status"));
        }
        String entityType = String.valueOf(run.get("entity_type"));
        String field = String.valueOf(run.get("field"));
        // 白名单：不信任库中字符串
        String table = TABLE_BY_TYPE.get(entityType);
        String column = COLUMN_BY_FIELD.get(field);
        if (table == null || column == null) {
            throw new IllegalArgumentException("非法实体类型或字段：" + entityType + "/" + field);
        }

        JsonNode payload = parseJson(String.valueOf(run.get("result_json")));
        String value = payload.path("value").asText("").trim();
        String url = payload.path("sourceUrl").asText("");
        String entityId = String.valueOf(run.get("entity_id"));
        if (value.isEmpty()) {
            throw new IllegalStateException("建议内容为空，无法采纳");
        }

        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT * FROM " + table + " WHERE id = ? FOR UPDATE", entityId);
        if (rows.isEmpty()) {
            // 实体已不存在，标记建议为 stale，避免反复重试
            jdbcTemplate.update("UPDATE agent_run SET status = 'stale' WHERE id = ?", runId);
            throw new IllegalStateException("实体已不存在（可能被去重合并），建议作废");
        }
        Map<String, Object> before = rows.get(0);
        Object current = before.get(column);
        String currentText = current == null ? "" : String.valueOf(current).trim();
        if (!currentText.isEmpty()) {
            // 起草时为空、采纳时已有值，视为期间被人工修改，拒绝覆盖
            throw new IllegalStateException("该字段已有人填写（" + currentText + "），请重新生成建议");
        }

        // 仅当字段仍为空时写入，防止并发互相覆盖
        int changed = jdbcTemplate.update(
                "UPDATE " + table + " SET " + column + " = ?, updated_at = NOW() WHERE id = ? AND (" + column + " = '' OR " + column + " IS NULL)",
                value, entityId);
        if (changed == 0) {
            throw new IllegalStateException("字段已被其他操作修改，本次采纳放弃");
        }

        Map<String, Object> after = jdbcTemplate.queryForMap("SELECT * FROM " + table + " WHERE id = ?", entityId);
        // operator 列长 64，记「谁@来源域名」；完整 URL 存 agent_run.result_json
        String operator = ("agent:" + reviewer + "@" + hostOf(url));
        if (operator.length() > 64) {
            operator = operator.substring(0, 64);
        }
        jdbcTemplate.update("""
                INSERT INTO poi_version (poi_type, poi_id, change_type, before_json, after_json, changed_fields, operator)
                VALUES (?, ?, 'update', ?, ?, ?, ?)
                """, entityType, entityId, toJson(before), toJson(after), column, operator);
        // 字段级来源：Agent 写入的字段需可追到具体 URL
        jdbcTemplate.update("""
                INSERT INTO poi_field_source (poi_type, poi_id, field, source, source_url)
                VALUES (?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE source = VALUES(source), source_url = VALUES(source_url), updated_at = NOW()
                """, entityType, entityId, column, "Agent(DeepSeek)", url);
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

    /** 数据质量巡检（规则版，不调模型）：扫描楼栋编号、纯数字等异常名称。 */
    public Map<String, Object> quality() {
        List<Map<String, Object>> flagged = jdbcTemplate.queryForList("""
                SELECT id, name, district, source,
                       CASE
                         WHEN name REGEXP '^[0-9]{1,4}[[:space:]]*(栋|号楼|单元|座|号|小区)$' THEN '楼栋编号'
                         WHEN name REGEXP '^[0-9]+$' THEN '纯数字'
                         ELSE '可疑'
                       END AS reason
                FROM poi_community
                WHERE status <> 'closed'
                  AND (name REGEXP '^[0-9]{1,4}[[:space:]]*(栋|号楼|单元|座|号|小区)$'
                       OR name REGEXP '^[0-9]+$')
                ORDER BY id
                LIMIT 50
                """);
        Map<String, Object> result = new java.util.LinkedHashMap<>();
        result.put("checked", jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM poi_community WHERE status <> 'closed'", Integer.class));
        result.put("flagged", flagged.size());
        result.put("items", flagged);
        return result;
    }

    /** 批量补全：挑出缺该字段的实体逐个 propose，只出建议不写库。 */
    public Map<String, Object> batch(String entityType, String field, int limit, boolean branchOnly) {
        String table = "bank".equals(entityType) ? "poi_bank" : "poi_community";
        String column = switch (field) {
            case "address" -> "address";
            case "phone" -> "phone";
            case "openingHours" -> "opening_hours";
            default -> throw new IllegalArgumentException("不支持的字段：" + field);
        };
        int size = Math.min(Math.max(limit, 1), 20);

        String sql = "SELECT id FROM " + table + " p WHERE " + column + " = ''"
                + (branchOnly ? " AND name REGEXP '支行|分行|营业部|分理处|储蓄所|ATM'" : "")
                // 跳过已有待处理建议或近 7 天已判定无结果的点位
                + " AND NOT EXISTS (SELECT 1 FROM agent_run r WHERE r.entity_type = ? AND r.entity_id = p.id"
                + "   AND r.field = ? AND (r.status IN ('running','ready')"
                + "   OR (r.status = 'rejected' AND r.created_at > DATE_SUB(NOW(), INTERVAL 7 DAY))))"
                + " ORDER BY id LIMIT " + size;
        List<String> ids = jdbcTemplate.queryForList(sql, String.class, entityType, field);

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
        org.springframework.jdbc.support.KeyHolder keyHolder = new org.springframework.jdbc.support.GeneratedKeyHolder();
        jdbcTemplate.update(connection -> {
            java.sql.PreparedStatement ps = connection.prepareStatement("""
                    INSERT INTO agent_run (entity_type, entity_id, field, status, model)
                    VALUES (?, ?, ?, 'running', ?)
                    """, java.sql.Statement.RETURN_GENERATED_KEYS);
            ps.setString(1, entityType);
            ps.setString(2, entityId);
            ps.setString(3, field);
            ps.setString(4, "deepseek-flash");
            return ps;
        }, keyHolder);
        // 用同一连接取主键，避免 LAST_INSERT_ID() 落到别的池连接
        return keyHolder.getKey() == null ? 0L : keyHolder.getKey().longValue();
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

    /** 核验：URL 必须出现在搜索结果中，且正文含该值 */
    private boolean evidenceInHits(List<DeepSeekClient.SearchHit> hits, String sourceUrl, String value) {
        String target = normalize(value);
        for (DeepSeekClient.SearchHit hit : hits) {
            if (!hit.url().equals(sourceUrl)) {
                continue;
            }
            String body = normalize(hit.content() + " " + hit.summary() + " " + hit.title());
            if (body.contains(target)) {
                return true;
            }
        }
        return false;
    }

    private void throttle() {
        synchronized (AgentService.class) {
            long now = System.currentTimeMillis();
            long wait = MIN_INTERVAL_MS - (now - lastProposeAt);
            if (wait > 0) {
                try {
                    Thread.sleep(wait);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                }
            }
            lastProposeAt = System.currentTimeMillis();
        }
    }

    private String hostOf(String url) {        try {
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
