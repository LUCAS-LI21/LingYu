package com.poiintel.admin;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.fasterxml.jackson.databind.ObjectMapper;

import lombok.RequiredArgsConstructor;

/**
 * 政府开放数据导入（L1）。
 *
 * 场景：深圳市政府数据开放平台等官方数据集，人工下载后按列映射导入。
 * 与抓取的区别：数据来自官方发布的文件，来源可追溯，允许入库。
 *
 * 去重策略：有 id 用 id；无 id 时用「同名 + 150m 内」判定为同一实体，
 * 命中则补空字段并写版本，未命中才新增。
 */
@Service
@RequiredArgsConstructor
public class ImportService {

    private static final Logger log = LoggerFactory.getLogger(ImportService.class);

    /** 深圳大致范围，挡住明显错误的坐标 */
    private static final double LNG_MIN = 113.6, LNG_MAX = 114.7;
    private static final double LAT_MIN = 22.3, LAT_MAX = 22.9;
    /** 同名判定为同一实体的距离阈值（度），约 165m */
    private static final double SAME_ENTITY_DEG = 0.0015;

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    public record Row(
            String id,
            String name,
            String address,
            String district,
            Double lng,
            Double lat,
            String phone,
            String openingHours,
            String brand,
            String branchType,
            Integer builtYear,
            Integer avgPrice,
            Double propertyFee) {
    }

    public record Request(String source, String license, String type, List<Row> rows) {
    }

    @Transactional
    public Map<String, Object> importRows(Request request) {
        if (request == null || request.rows() == null || request.rows().isEmpty()) {
            throw new IllegalArgumentException("没有可导入的数据行");
        }
        String type = "community".equals(request.type()) ? "community" : "bank";
        String table = "bank".equals(type) ? "poi_bank" : "poi_community";
        String source = blankTo(request.source(), "政府开放数据");
        String license = blankTo(request.license(), "政府公开信息");

        int inserted = 0, updated = 0, skipped = 0;
        List<String> errors = new ArrayList<>();

        for (Row row : request.rows()) {
            String invalid = validate(row);
            if (invalid != null) {
                skipped++;
                if (errors.size() < 10) {
                    errors.add(invalid + "：" + blankTo(row.name(), "(无名称)"));
                }
                continue;
            }

            String existingId = findExisting(table, row);
            try {
                if (existingId == null) {
                    String newId = blankTo(row.id(), "import-" + Math.abs((row.name() + row.lng() + row.lat()).hashCode()));
                    insertRow(table, type, newId, row, source, license);
                    inserted++;
                } else {
                    Map<String, Object> before = jdbcTemplate.queryForMap(
                            "SELECT * FROM " + table + " WHERE id = ?", existingId);
                    updateRow(table, existingId, row, source, license);
                    Map<String, Object> after = jdbcTemplate.queryForMap(
                            "SELECT * FROM " + table + " WHERE id = ?", existingId);
                    List<String> changed = changedFields(before, after);
                    if (!changed.isEmpty()) {
                        jdbcTemplate.update("""
                                INSERT INTO poi_version (poi_type, poi_id, change_type, before_json, after_json,
                                                         changed_fields, operator)
                                VALUES (?, ?, 'update', ?, ?, ?, ?)
                                """, type, existingId, toJson(before), toJson(after),
                                String.join(",", changed), "import:" + source);
                    }
                    updated++;
                }
            } catch (Exception ex) {
                skipped++;
                if (errors.size() < 10) {
                    errors.add(blankTo(row.name(), "(无名称)") + "：" + shortMessage(ex));
                }
            }
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("type", type);
        result.put("source", source);
        result.put("inserted", inserted);
        result.put("updated", updated);
        result.put("skipped", skipped);
        result.put("errors", errors);
        log.info("[import] {} 来源={} 新增={} 更新={} 跳过={}", type, source, inserted, updated, skipped);
        return result;
    }

    private String validate(Row row) {
        if (row == null) return "空行";
        if (blankTo(row.name(), "").isBlank()) return "缺少名称";
        if (row.lng() == null || row.lat() == null) return "缺少坐标";
        if (row.lng() < LNG_MIN || row.lng() > LNG_MAX || row.lat() < LAT_MIN || row.lat() > LAT_MAX) {
            return "坐标超出深圳范围";
        }
        return null;
    }

    private String findExisting(String table, Row row) {
        if (row.id() != null && !row.id().isBlank()) {
            List<String> hit = jdbcTemplate.queryForList(
                    "SELECT id FROM " + table + " WHERE id = ?", String.class, row.id());
            if (!hit.isEmpty()) return hit.get(0);
        }
        List<String> near = jdbcTemplate.queryForList("""
                SELECT id FROM %s
                WHERE name = ? AND ABS(lat - ?) <= ? AND ABS(lng - ?) <= ?
                LIMIT 1
                """.formatted(table), String.class,
                row.name(), row.lat(), SAME_ENTITY_DEG, row.lng(), SAME_ENTITY_DEG);
        return near.isEmpty() ? null : near.get(0);
    }

    private void insertRow(String table, String type, String id, Row row, String source, String license) {
        if ("bank".equals(type)) {
            jdbcTemplate.update("""
                    INSERT INTO poi_bank (id, name, brand, branch_type, address, district, lng, lat,
                                          phone, opening_hours, source, license, source_level, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'L1', 'active')
                    """, id, row.name(), blankTo(row.brand(), ""),
                    blankTo(row.branchType(), "branch"), blankTo(row.address(), ""),
                    blankTo(row.district(), ""), row.lng(), row.lat(),
                    blankTo(row.phone(), ""), blankTo(row.openingHours(), ""), source, license);
        } else {
            jdbcTemplate.update("""
                    INSERT INTO poi_community (id, name, address, district, lng, lat, built_year, avg_price,
                                               property_fee, demo_attributes, source, license, source_level, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'L1', 'active')
                    """, id, row.name(), blankTo(row.address(), ""), blankTo(row.district(), ""),
                    row.lng(), row.lat(), row.builtYear(), row.avgPrice(), row.propertyFee(), source, license);
        }
    }

    /** 只覆盖有值的字段，避免用空值把已有数据冲掉 */
    private void updateRow(String table, String id, Row row, String source, String license) {
        List<String> sets = new ArrayList<>();
        List<Object> args = new ArrayList<>();
        addIfPresent(sets, args, "address", row.address());
        addIfPresent(sets, args, "district", row.district());
        addIfPresent(sets, args, "source", source);
        addIfPresent(sets, args, "license", license);
        if ("poi_bank".equals(table)) {
            addIfPresent(sets, args, "phone", row.phone());
            addIfPresent(sets, args, "opening_hours", row.openingHours());
            addIfPresent(sets, args, "brand", row.brand());
        } else {
            if (row.builtYear() != null) { sets.add("built_year = ?"); args.add(row.builtYear()); }
            if (row.avgPrice() != null) { sets.add("avg_price = ?"); args.add(row.avgPrice()); }
            if (row.propertyFee() != null) { sets.add("property_fee = ?"); args.add(row.propertyFee()); }
        }
        if (sets.isEmpty()) return;
        sets.add("updated_at = NOW()");
        args.add(id);
        jdbcTemplate.update("UPDATE " + table + " SET " + String.join(", ", sets) + " WHERE id = ?",
                args.toArray());
    }

    private void addIfPresent(List<String> sets, List<Object> args, String column, String value) {
        if (value == null || value.isBlank()) return;
        sets.add(column + " = ?");
        args.add(value.trim());
    }

    private List<String> changedFields(Map<String, Object> before, Map<String, Object> after) {
        List<String> changed = new ArrayList<>();
        for (String key : after.keySet()) {
            if ("updated_at".equals(key)) continue;
            Object a = before.get(key), b = after.get(key);
            if (a == null ? b != null : !a.equals(b)) changed.add(key);
        }
        return changed;
    }

    private String toJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception ex) {
            return "{}";
        }
    }

    private String shortMessage(Exception ex) {
        String message = ex.getMessage();
        return message == null ? ex.getClass().getSimpleName() : message.substring(0, Math.min(120, message.length()));
    }

    private static String blankTo(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value.trim();
    }
}
