package com.poiintel.feedback;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class FeedbackService {

    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("yyyyMMdd");

    private final JdbcTemplate jdbcTemplate;

    public Map<String, Object> submit(FeedbackRequest request) {
        int next = jdbcTemplate.queryForObject("SELECT COALESCE(MAX(id), 0) + 1 FROM feedback", Integer.class);
        String code = "FB" + LocalDate.now().format(DAY) + "-" + String.format("%04d", next);
        // 新增点位需要人工/抓取核实，其余低风险字段先按「已受理」处理
        String status = "add".equals(request.type()) ? "pending" : "auto_applied";

        jdbcTemplate.update("""
                INSERT INTO feedback
                    (code, poi_type, poi_id, poi_name, type, field_name, new_value, description, contact, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                code,
                request.poiType(),
                request.poiId(),
                request.poiName() == null ? "" : request.poiName(),
                request.type(),
                request.field() == null ? "" : request.field(),
                request.newValue() == null ? "" : request.newValue(),
                request.description(),
                request.contact() == null ? "" : request.contact(),
                status);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("code", code);
        result.put("status", status);
        return result;
    }

    public Map<String, Object> findByCode(String code) {
        return jdbcTemplate.query("""
                        SELECT code, poi_type AS poiType, poi_id AS poiId, poi_name AS poiName,
                               type, field_name AS fieldName, new_value AS newValue,
                               description, status, created_at AS createdAt
                        FROM feedback WHERE code = ?
                        """,
                rs -> {
                    if (!rs.next()) {
                        throw new IllegalArgumentException("反馈不存在：" + code);
                    }
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("code", rs.getString("code"));
                    row.put("poiType", rs.getString("poiType"));
                    row.put("poiId", rs.getString("poiId"));
                    row.put("poiName", rs.getString("poiName"));
                    row.put("type", rs.getString("type"));
                    row.put("field", rs.getString("fieldName"));
                    row.put("newValue", rs.getString("newValue"));
                    row.put("description", rs.getString("description"));
                    row.put("status", rs.getString("status"));
                    row.put("createdAt", String.valueOf(rs.getTimestamp("createdAt")));
                    return row;
                },
                code);
    }
}
