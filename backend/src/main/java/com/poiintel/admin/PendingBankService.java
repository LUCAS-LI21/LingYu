package com.poiintel.admin;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import lombok.RequiredArgsConstructor;

/**
 * 待定位网点暂存。
 *
 * 有些银行官网只给「名称/地址/电话/营业时间」，不给经纬度（如兴业银行）。
 * 没有坐标就写进 poi_bank 等于编造位置，所以先存这里，等有地理编码能力再转正。
 */
@Service
@RequiredArgsConstructor
public class PendingBankService {

    private final JdbcTemplate jdbcTemplate;

    public record Row(String name, String address, String phone, String openingHours, String district) {
    }

    public record Request(String source, String sourceUrl, List<Row> rows) {
    }

    @Transactional
    /**
     * 从「新增点位」反馈里取出要暂存的网点名称。
     * 用户填的名字在 new_value，留空时退回 description；都没有就返回 null（不落脏数据）。
     */
    public Map<String, Object> feedbackOf(String code) {
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT new_value, description FROM feedback WHERE code = ? AND type = 'add'", code);
        if (rows.isEmpty()) {
            return null;
        }
        String name = String.valueOf(rows.get(0).get("new_value"));
        if (name.isBlank() || "null".equals(name)) {
            name = String.valueOf(rows.get(0).get("description"));
        }
        if (name.isBlank() || "null".equals(name)) {
            return null;
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("name", name.length() > 128 ? name.substring(0, 128) : name.trim());
        result.put("address", "");
        return result;
    }

    public synchronized Map<String, Object> importRows(Request request) {
        if (request == null || request.rows() == null || request.rows().isEmpty()) {
            throw new IllegalArgumentException("没有可导入的数据行");
        }
        String source = request.source() == null || request.source().isBlank() ? "未知来源" : request.source().trim();
        String url = request.sourceUrl() == null ? "" : request.sourceUrl().trim();

        int inserted = 0;
        int skipped = 0;
        for (Row row : request.rows()) {
            if (row == null || row.name() == null || row.name().isBlank()) {
                skipped++;
                continue;
            }
            String address = row.address() == null ? "" : row.address().trim();
            Integer exists = jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM bank_pending WHERE name = ? AND address = ?",
                    Integer.class, row.name().trim(), address);
            if (exists != null && exists > 0) {
                skipped++;
                continue;
            }
            jdbcTemplate.update("""
                    INSERT INTO bank_pending (name, address, phone, opening_hours, district, source, source_url)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """, row.name().trim(), address,
                    row.phone() == null ? "" : row.phone().trim(),
                    row.openingHours() == null ? "" : row.openingHours().trim(),
                    row.district() == null ? "" : row.district().trim(),
                    source, url);
            inserted++;
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("source", source);
        result.put("inserted", inserted);
        result.put("skipped", skipped);
        result.put("total", countPending());
        return result;
    }

    public List<Map<String, Object>> list(String status, int limit) {
        String sql = "SELECT id, name, address, phone, opening_hours, district, source, status, created_at "
                + "FROM bank_pending " + (status == null || status.isBlank() ? "" : "WHERE status = ? ")
                + "ORDER BY id DESC LIMIT ?";
        List<Object> args = new ArrayList<>();
        if (status != null && !status.isBlank()) args.add(status);
        args.add(Math.min(Math.max(limit, 1), 200));
        return jdbcTemplate.queryForList(sql, args.toArray());
    }

    public int countPending() {
        Integer count = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM bank_pending WHERE status = 'pending'", Integer.class);
        return count == null ? 0 : count;
    }

    /** 人工确认坐标后转正：写入 poi_bank 并从暂存表移除 */
    @Transactional
    public Map<String, Object> promote(long pendingId, double lng, double lat, String reviewer) {
        Map<String, Object> row = jdbcTemplate.queryForMap("SELECT * FROM bank_pending WHERE id = ?", pendingId);
        String name = String.valueOf(row.get("name"));
        String address = String.valueOf(row.get("address"));
        String district = String.valueOf(row.get("district"));
        jdbcTemplate.update("""
                INSERT INTO poi_bank (id, name, brand, branch_type, address, district, lng, lat, phone,
                                      opening_hours, source, license, source_level, status)
                VALUES (?, ?, ?, 'branch', ?, ?, ?, ?, ?, ?, ?, '公开信息（官网）', 'L1', 'active')
                """, "pending-" + pendingId, name, brandOf(name), address, district, lng, lat,
                String.valueOf(row.get("phone")), String.valueOf(row.get("opening_hours")),
                String.valueOf(row.get("source")));
        jdbcTemplate.update("UPDATE bank_pending SET status = 'geocoded', note = ? WHERE id = ?",
                "promoted by " + reviewer, pendingId);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", "pending-" + pendingId);
        result.put("name", name);
        result.put("lng", lng);
        result.put("lat", lat);
        return result;
    }

    private String brandOf(String name) {
        int idx = name.indexOf("银行");
        return idx > 0 ? name.substring(0, idx + 2) : name;
    }
}
