package com.poiintel.feedback;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.sql.PreparedStatement;
import java.sql.Statement;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Service;

import com.poiintel.admin.AdminService;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class FeedbackService {

    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("yyyyMMdd");

    private final JdbcTemplate jdbcTemplate;
    private final AdminService adminService;

    /** 是否允许匿名反馈直接改主表：默认关闭，需 app.feedback.auto-apply=true 开启。 */
    @Value("${app.feedback.auto-apply:false}")
    private boolean autoApplyEnabled;

    /** 低风险字段：系统可直接采纳；坐标/名称/关闭状态与新增点位必须人工审核。 */
    private static final Set<String> LOW_RISK_FIELDS = Set.of("电话", "营业时间", "均价", "物业费", "建成年份");

    public Map<String, Object> submit(FeedbackRequest request) {
        String status = "pending";
        // lambda 内只能引用 effectively-final 变量
        final String initialStatus = status;
        // 临时码仅用于占位，长度必须 <= code 列宽（VARCHAR(32)）
        String tempCode = "TMP-" + UUID.randomUUID().toString().replace("-", "").substring(0, 20);

        KeyHolder keyHolder = new GeneratedKeyHolder();
        jdbcTemplate.update(connection -> {
            PreparedStatement ps = connection.prepareStatement("""
                    INSERT INTO feedback
                        (code, poi_type, poi_id, poi_name, type, field_name, new_value, description, contact, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, Statement.RETURN_GENERATED_KEYS);
            ps.setString(1, tempCode);
            ps.setString(2, request.poiType());
            ps.setString(3, request.poiId());
            ps.setString(4, request.poiName() == null ? "" : request.poiName());
            ps.setString(5, request.type());
            ps.setString(6, request.field() == null ? "" : request.field());
            ps.setString(7, request.newValue() == null ? "" : request.newValue());
            ps.setString(8, request.description());
            ps.setString(9, request.contact() == null ? "" : request.contact());
            ps.setString(10, initialStatus);
            return ps;
        }, keyHolder);

        // 用自增 id 生成对外编号，避免并发撞唯一键
        long id = keyHolder.getKey() == null ? 0L : keyHolder.getKey().longValue();
        String code = "FB" + LocalDate.now().format(DAY) + "-" + String.format("%04d", id);
        jdbcTemplate.update("UPDATE feedback SET code = ? WHERE id = ?", code, id);

        // 低风险字段走自动审核，复用同一套生效逻辑保证版本留痕；默认关闭。
        boolean autoApply = autoApplyEnabled
                && !"add".equals(request.type())
                && LOW_RISK_FIELDS.contains(request.field())
                && request.newValue() != null
                && !request.newValue().isBlank();
        if (autoApply) {
            try {
                adminService.approve(code, "system");
                status = "approved";
            } catch (Exception ex) {
                // 自动生效失败则退回人工队列
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
                        throw new com.poiintel.common.NotFoundException("反馈不存在：" + code);
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
