package com.poiintel.feedback;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import com.poiintel.admin.AdminService;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class FeedbackService {

    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("yyyyMMdd");

    private final JdbcTemplate jdbcTemplate;
    private final AdminService adminService;

    /** 低风险字段：可由系统直接采纳生效；坐标/名称/关闭状态与新增点位必须人工审核 */
    private static final Set<String> LOW_RISK_FIELDS = Set.of("电话", "营业时间", "均价", "物业费", "建成年份");

    public Map<String, Object> submit(FeedbackRequest request) {
        int next = jdbcTemplate.queryForObject("SELECT COALESCE(MAX(id), 0) + 1 FROM feedback", Integer.class);
        String code = "FB" + LocalDate.now().format(DAY) + "-" + String.format("%04d", next);
        String status = "pending";

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

        // 低风险字段走「系统自动审核」：复用同一套生效逻辑，保证版本留痕一致
        boolean autoApply = !"add".equals(request.type())
                && LOW_RISK_FIELDS.contains(request.field())
                && request.newValue() != null
                && !request.newValue().isBlank();
        if (autoApply) {
            try {
                adminService.approve(code, "system");
                status = "approved";
            } catch (Exception ex) {
                // 自动生效失败则退回人工队列，不让用户白填
                status = "pending";
            }
        }

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
