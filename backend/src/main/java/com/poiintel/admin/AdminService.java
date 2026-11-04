package com.poiintel.admin;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.fasterxml.jackson.databind.ObjectMapper;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class AdminService {

    private static final Map<String, Map<String, String>> FIELD_WHITELIST = Map.of(
            "bank", Map.of(
                    "名称", "name",
                    "地址", "address",
                    "电话", "phone",
                    "营业时间", "opening_hours"),
            "community", Map.of(
                    "名称", "name",
                    "地址", "address",
                    "建成年份", "built_year",
                    "均价", "avg_price",
                    "物业费", "property_fee"));

    private static final List<String> NUMERIC_COLUMNS = List.of("built_year", "avg_price", "property_fee");

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    // ---------------- 概览 ----------------

    public Map<String, Object> overview() {
        Map<String, Object> row = jdbcTemplate.queryForMap("""
                SELECT
                    (SELECT COUNT(*) FROM feedback WHERE status = 'pending')                AS pending_feedback,
                    (SELECT COUNT(*) FROM feedback)                                          AS total_feedback,
                    (SELECT COUNT(*) FROM ingest_job)                                        AS total_jobs,
                    (SELECT COUNT(*) FROM ingest_job WHERE status = 'success')               AS success_jobs,
                    (SELECT COUNT(*) FROM ingest_job WHERE status = 'failed')                AS failed_jobs,
                    (SELECT COUNT(*) FROM ingest_job WHERE status = 'running')               AS running_jobs,
                    (SELECT COUNT(*) FROM hot_region)                                        AS hot_regions,
                    (SELECT COUNT(*) FROM poi_version)                                       AS versions,
                    (SELECT ROUND(AVG(TIMESTAMPDIFF(HOUR, updated_at, NOW()))) FROM v_poi)    AS avg_fresh_hours
                """);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("pendingFeedback", number(row, "pending_feedback"));
        result.put("totalFeedback", number(row, "total_feedback"));
        result.put("totalJobs", number(row, "total_jobs"));
        result.put("successJobs", number(row, "success_jobs"));
        result.put("failedJobs", number(row, "failed_jobs"));
        result.put("runningJobs", number(row, "running_jobs"));
        result.put("hotRegions", number(row, "hot_regions"));
        result.put("versions", number(row, "versions"));
        result.put("avgFreshHours", number(row, "avg_fresh_hours"));
        return result;
    }

    private int number(Map<String, Object> row, String key) {
        Object value = row.get(key);
        return value == null ? 0 : ((Number) value).intValue();
    }

    // ---------------- 反馈审核 ----------------

    public Map<String, Object> feedbackPage(String status, int page, int size) {
        int offset = (Math.max(page, 1) - 1) * size;
        String where = (status == null || status.isBlank() || "all".equals(status)) ? "" : "WHERE status = ?";
        List<Object> args = new ArrayList<>();
        if (!where.isEmpty()) {
            args.add(status);
        }

        long total = where.isEmpty()
                ? jdbcTemplate.queryForObject("SELECT COUNT(*) FROM feedback", Long.class)
                : jdbcTemplate.queryForObject("SELECT COUNT(*) FROM feedback " + where, Long.class, args.toArray());

        List<Object> queryArgs = new ArrayList<>(args);
        queryArgs.add(size);
        queryArgs.add(offset);
        List<Map<String, Object>> items = jdbcTemplate.queryForList("""
                SELECT code, poi_type AS poiType, poi_id AS poiId, poi_name AS poiName, type,
                       field_name AS field, new_value AS newValue, description, contact,
                       status, reviewer, review_note AS reviewNote,
                       DATE_FORMAT(created_at, '%Y-%m-%d %H:%i') AS createdAt
                FROM feedback
                """ + where + " ORDER BY id DESC LIMIT ? OFFSET ?", queryArgs.toArray());

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("items", items);
        result.put("total", total);
        result.put("page", page);
        result.put("size", size);
        return result;
    }

    @Transactional
    public Map<String, Object> approve(String code, String reviewer) {
        Map<String, Object> feedback = jdbcTemplate.queryForMap("SELECT * FROM feedback WHERE code = ?", code);
        long feedbackId = ((Number) feedback.get("id")).longValue();
        String poiType = String.valueOf(feedback.get("poi_type"));
        String poiId = String.valueOf(feedback.get("poi_id"));
        String type = String.valueOf(feedback.get("type"));
        String field = String.valueOf(feedback.get("field_name"));
        String newValue = String.valueOf(feedback.get("new_value"));

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("code", code);

        if ("add".equals(type)) {
            // 新增点位不能凭空造，转成定向抓取任务，由采集侧核实
            jdbcTemplate.update("""
                    UPDATE feedback SET status = 'need_refetch', reviewer = ?, reviewed_at = NOW(),
                        review_note = '新增点位需重新采集核实' WHERE code = ?
                    """, reviewer, code);
            result.put("status", "need_refetch");
            result.put("applied", List.of());
            return result;
        }

        String table = "bank".equals(poiType) ? "poi_bank" : "poi_community";
        Map<String, Object> before = jdbcTemplate.queryForMap("SELECT * FROM " + table + " WHERE id = ?", poiId);

        List<String> applied = new ArrayList<>();
        if ("closed".equals(type)) {
            jdbcTemplate.update("UPDATE " + table + " SET status = 'closed', updated_at = NOW() WHERE id = ?", poiId);
            applied.add("status=closed");
        } else {
            Map<String, String> mapping = FIELD_WHITELIST.getOrDefault(poiType, Map.of());
            String column = mapping.get(field);
            if (column == null) {
                // 字段不在白名单（如「网点状态」走 closed 分支），只记录审核通过
                applied.add("no-op:" + field);
            } else if (newValue != null && !newValue.isBlank()) {
                Object value = NUMERIC_COLUMNS.contains(column) ? parseNumber(newValue) : newValue.trim();
                jdbcTemplate.update("UPDATE " + table + " SET " + column + " = ?, updated_at = NOW() WHERE id = ?",
                        value, poiId);
                applied.add(column + "=" + value);
            }
        }

        Map<String, Object> after = jdbcTemplate.queryForMap("SELECT * FROM " + table + " WHERE id = ?", poiId);
        jdbcTemplate.update("""
                INSERT INTO poi_version (poi_type, poi_id, change_type, before_json, after_json,
                                         changed_fields, operator, feedback_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, poiType, poiId, "closed".equals(type) ? "close" : "update",
                toJson(before), toJson(after), String.join(",", applied), reviewer, feedbackId);

        jdbcTemplate.update("""
                UPDATE feedback SET status = 'approved', reviewer = ?, reviewed_at = NOW(),
                    review_note = '审核通过并已生效' WHERE code = ?
                """, reviewer, code);

        result.put("status", "approved");
        result.put("applied", applied);
        return result;
    }

    @Transactional
    public Map<String, Object> reject(String code, String reviewer, String note) {
        jdbcTemplate.update("""
                UPDATE feedback SET status = 'rejected', reviewer = ?, reviewed_at = NOW(), review_note = ?
                WHERE code = ?
                """, reviewer, note == null ? "" : note, code);
        return Map.of("code", code, "status", "rejected");
    }

    private Object parseNumber(String raw) {
        String cleaned = raw.replaceAll("[^0-9.]", "");
        if (cleaned.isEmpty()) {
            return null;
        }
        try {
            double value = Double.parseDouble(cleaned);
            return value == Math.floor(value) ? (int) value : value;
        } catch (NumberFormatException ex) {
            return null;
        }
    }

    private String toJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception ex) {
            return "{}";
        }
    }

    // ---------------- 抓取任务 ----------------

    public Map<String, Object> jobs(int page, int size) {
        int offset = (Math.max(page, 1) - 1) * size;
        List<Map<String, Object>> items = jdbcTemplate.queryForList("""
                SELECT id, source_code AS sourceCode, trigger_type AS triggerType, scope_type AS scopeType,
                       scope_value AS scopeValue, status, fetched_count AS fetchedCount,
                       inserted_count AS insertedCount, updated_count AS updatedCount,
                       failed_count AS failedCount, error_summary AS errorSummary,
                       DATE_FORMAT(created_at, '%m-%d %H:%i') AS createdAt,
                       DATE_FORMAT(finished_at, '%m-%d %H:%i') AS finishedAt
                FROM ingest_job ORDER BY id DESC LIMIT ? OFFSET ?
                """, size, offset);
        Long total = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM ingest_job", Long.class);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("items", items);
        result.put("total", total == null ? 0 : total);
        return result;
    }

    // ---------------- 热点 ----------------

    public List<Map<String, Object>> hotspots() {
        return jdbcTemplate.queryForList("""
                SELECT grid, stat_date AS statDate, query_count AS queryCount,
                       zero_result_count AS zeroResultCount, priority,
                       DATE_FORMAT(updated_at, '%m-%d %H:%i') AS updatedAt
                FROM hot_region ORDER BY stat_date DESC, priority DESC LIMIT 20
                """);
    }

    public Map<String, Object> recomputeHotspots() {
        int affected = jdbcTemplate.update("""
                INSERT INTO hot_region (grid, stat_date, query_count, zero_result_count, priority)
                SELECT grid, CURDATE(), COUNT(*),
                       SUM(CASE WHEN result_count = 0 THEN 1 ELSE 0 END),
                       COUNT(*) + 2 * SUM(CASE WHEN result_count = 0 THEN 1 ELSE 0 END)
                FROM query_log
                WHERE grid <> '' AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                GROUP BY grid
                ON DUPLICATE KEY UPDATE
                    query_count = VALUES(query_count),
                    zero_result_count = VALUES(zero_result_count),
                    priority = VALUES(priority),
                    updated_at = NOW()
                """);
        return Map.of("affected", affected, "recomputedAt", LocalDateTime.now().toString());
    }
}
