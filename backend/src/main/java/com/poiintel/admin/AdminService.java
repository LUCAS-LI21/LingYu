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

    /** POI 类型 → 表名，必须是白名单（表名会拼进 SQL） */
    private static final Map<String, String> TABLE_BY_TYPE = Map.of(
            "bank", "poi_bank",
            "community", "poi_community");

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
        String currentStatus = String.valueOf(feedback.get("status"));
        if ("need_refetch".equals(currentStatus)) {
            // 上次重抓因任务占用失败，允许再点一次审核重试；否则反馈会永久卡在 need_refetch
            int reset = jdbcTemplate.update(
                    "UPDATE feedback SET status = 'pending' WHERE code = ? AND status = 'need_refetch'", code);
            if (reset == 0) {
                throw new IllegalStateException("反馈状态已变更，请刷新后重试");
            }
        } else if (!"pending".equals(currentStatus)) {
            throw new IllegalStateException("该反馈已处理，当前状态：" + currentStatus);
        }
        long feedbackId = ((Number) feedback.get("id")).longValue();
        String poiType = String.valueOf(feedback.get("poi_type"));
        String poiId = String.valueOf(feedback.get("poi_id"));
        String type = String.valueOf(feedback.get("type"));
        String field = String.valueOf(feedback.get("field_name"));
        String newValue = String.valueOf(feedback.get("new_value"));

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("code", code);

        String table = TABLE_BY_TYPE.get(poiType);
        if (table == null) {
            throw new IllegalArgumentException("未知 POI 类型：" + poiType);
        }

        if ("add".equals(type)) {
            // 新增点位不能凭空造：置为待重抓，并把锚点坐标回传，由控制器创建定向抓取任务
            int updated = jdbcTemplate.update("""
                    UPDATE feedback SET status = 'need_refetch', reviewer = ?, reviewed_at = NOW(),
                        review_note = '新增点位需重新采集核实' WHERE code = ? AND status = 'pending'
                    """, reviewer, code);
            if (updated == 0) {
                throw new IllegalStateException("反馈状态已变更，请刷新后重试");
            }
            result.put("status", "need_refetch");
            result.put("applied", List.of());
            try {
                Map<String, Object> anchor = jdbcTemplate.queryForMap(
                        "SELECT lng, lat FROM " + table + " WHERE id = ?", poiId);
                result.put("anchorLng", ((Number) anchor.get("lng")).doubleValue());
                result.put("anchorLat", ((Number) anchor.get("lat")).doubleValue());
            } catch (Exception ignored) {
                // 锚点查不到就不建任务，只保留 need_refetch 状态
            }
            return result;
        }

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
                // 字段级来源要跟着改：否则审核完用户改的电话，详情页还显示「银行官网」
                jdbcTemplate.update("""
                        INSERT INTO poi_field_source (poi_type, poi_id, field, source, source_url)
                        VALUES (?, ?, ?, ?, ?)
                        ON DUPLICATE KEY UPDATE source = VALUES(source), source_url = VALUES(source_url),
                            updated_at = NOW()
                        """, poiType, poiId, column, "用户反馈（审核:" + reviewer + "）", "feedback:" + code);
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
                    review_note = '审核通过并已生效' WHERE code = ? AND status = 'pending'
                """, reviewer, code);

        result.put("status", "approved");
        result.put("applied", applied);
        return result;
    }

    /** 关闭是单向操作，补一个重开入口，避免"关错了没法救" */
    @Transactional
    public Map<String, Object> reopen(String poiId, String reviewer) {
        for (String table : TABLE_BY_TYPE.values()) {
            Map<String, Object> row;
            try {
                row = jdbcTemplate.queryForMap("SELECT * FROM " + table + " WHERE id = ?", poiId);
            } catch (Exception notFound) {
                continue;
            }
            String poiType = "poi_bank".equals(table) ? "bank" : "community";
            jdbcTemplate.update("UPDATE " + table + " SET status = 'active', updated_at = NOW() WHERE id = ?", poiId);
            jdbcTemplate.update("""
                    INSERT INTO poi_version (poi_type, poi_id, change_type, before_json, after_json,
                                             changed_fields, operator)
                    VALUES (?, ?, 'reopen', ?, ?, 'status=active', ?)
                    """, poiType, poiId, toJson(row),
                    toJson(jdbcTemplate.queryForMap("SELECT * FROM " + table + " WHERE id = ?", poiId)), reviewer);
            return Map.of("id", poiId, "status", "active", "type", poiType);
        }
        throw new com.poiintel.common.NotFoundException("POI 不存在：" + poiId);
    }

    @Transactional
    public Map<String, Object> reject(String code, String reviewer, String note) {
        // 允许驳回 pending 与 need_refetch：后者是「已标记待重抓」，
        // 如果抓不到或用户撤诉，运营必须能关掉，否则这条反馈永远悬着（闭环没有出口）
        int updated = jdbcTemplate.update("""
                UPDATE feedback SET status = 'rejected', reviewer = ?, reviewed_at = NOW(), review_note = ?
                WHERE code = ? AND status IN ('pending', 'need_refetch')
                """, reviewer, note == null ? "" : note, code);
        if (updated == 0) {
            throw new IllegalStateException("该反馈已处理或不存在，请刷新");
        }
        return Map.of("code", code, "status", "rejected");
    }

    private Object parseNumber(String raw) {
        String cleaned = raw.replaceAll("[^0-9.]", "");
        if (cleaned.isEmpty()) {
            throw new IllegalArgumentException("数值格式不正确：" + raw);
        }
        try {
            double value = Double.parseDouble(cleaned);
            return value == Math.floor(value) ? (int) value : value;
        } catch (NumberFormatException ex) {
            throw new IllegalArgumentException("数值格式不正确：" + raw);
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
