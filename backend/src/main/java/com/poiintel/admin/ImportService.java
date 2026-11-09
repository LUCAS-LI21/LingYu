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
 * 数据来自官方发布文件（如深圳市政府数据开放平台），来源可追溯、允许入库。
 *
 * 合并规则（经复核修正）：
 * - 有 id：必须与库中同名，否则拒绝（防止改错对象）
 * - 无 id：同名 + 球面距离 ≤ 165m + 品牌/地址至少一项相容，才判定为同一实体
 * - 默认「只补空字段」，不覆盖已有值；显式 overwrite=true 才覆盖
 */
@Service
@RequiredArgsConstructor
public class ImportService {

    private static final Logger log = LoggerFactory.getLogger(ImportService.class);

    /** 深圳大致范围，挡住明显错误的坐标 */
    private static final double LNG_MIN = 113.6, LNG_MAX = 114.7;
    private static final double LAT_MIN = 22.3, LAT_MAX = 22.9;
    /** 同名判定为同一实体的球面距离（米） */
    private static final double SAME_ENTITY_METERS = 165;
    /** 单次导入行数上限，防止超大 payload */
    private static final int MAX_ROWS = 5000;

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
            Double propertyFee,
            String propertyCompany) {
    }

    public record Request(String source, String license, String type, Boolean overwrite, Boolean enrich,
            List<Row> rows) {
    }

    /**
     * 串行执行：导入是低频管理动作，用 synchronized 换掉「先查后插」的并发重复风险
     * （多实例部署时需换成数据库唯一约束或分布式锁）。
     */
    @Transactional
    public synchronized Map<String, Object> importRows(Request request) {
        if (request == null || request.rows() == null || request.rows().isEmpty()) {
            throw new IllegalArgumentException("没有可导入的数据行");
        }
        if (request.rows().size() > MAX_ROWS) {
            throw new IllegalArgumentException("单次最多导入 " + MAX_ROWS + " 行，请拆分文件");
        }
        String type = normalizeType(request.type());
        String table = "bank".equals(type) ? "poi_bank" : "poi_community";
        String source = blankTo(request.source(), "政府开放数据");
        String license = blankTo(request.license(), "政府公开信息");
        boolean overwrite = Boolean.TRUE.equals(request.overwrite());
        // 补全模式：数据集只有名称+数值（如二手房参考价），没有坐标，
        // 只能按名称匹配已有 POI 补字段，绝不新建无坐标的记录。
        boolean enrich = Boolean.TRUE.equals(request.enrich());

        int inserted = 0, updated = 0, skipped = 0, conflicts = 0;
        List<String> errors = new ArrayList<>();

        for (Row raw : request.rows()) {
            Row row = normalize(raw);
            String invalid = enrich ? validateEnrich(row) : validate(row);
            if (invalid != null) {
                skipped++;
                if (errors.size() < 10) {
                    errors.add(invalid + "：" + blankTo(row == null ? "" : row.name(), "(无名称)"));
                }
                continue;
            }

            if (enrich) {
                List<Map<String, Object>> matches = matchByName(table, row);
                if (matches.isEmpty()) {
                    skipped++;
                    if (errors.size() < 10) {
                        errors.add("名称无法匹配：" + blankTo(row.name(), "(无名称)"));
                    }
                    continue;
                }
                if (matches.size() > 1) {
                    skipped++;
                    if (errors.size() < 10) {
                        errors.add("同名多条，拒绝猜测：" + row.name() + "（命中 " + matches.size() + " 条）");
                    }
                    continue;
                }
                String matchedId = String.valueOf(matches.get(0).get("id"));
                try {
                    Map<String, Object> before = jdbcTemplate.queryForMap(
                            "SELECT * FROM " + table + " WHERE id = ?", matchedId);
                    int changed = updateRow(table, matchedId, row, source, license, overwrite);
                    if (changed == 0) {
                        conflicts++;
                    } else {
                        Map<String, Object> after = jdbcTemplate.queryForMap(
                                "SELECT * FROM " + table + " WHERE id = ?", matchedId);
                        jdbcTemplate.update("""
                                INSERT INTO poi_version (poi_type, poi_id, change_type, before_json, after_json,
                                                         changed_fields, operator)
                                VALUES (?, ?, 'update', ?, ?, ?, ?)
                                """, type, matchedId, toJson(before), toJson(after),
                                String.join(",", changedFields(before, after)), "import:" + source);
                        updated++;
                    }
                } catch (Exception ex) {
                    skipped++;
                    if (errors.size() < 10) {
                        errors.add(row.name() + "：" + shortMessage(ex));
                    }
                }
                continue;
            }

            try {
                String existingId = findExisting(table, row);
                if (existingId == null) {
                    String newId = blankTo(row.id(),
                            "import-" + Math.abs((row.name() + row.lng() + row.lat()).hashCode()));
                    insertRow(table, type, newId, row, source, license);
                    inserted++;
                } else {
                    Map<String, Object> before = jdbcTemplate.queryForMap(
                            "SELECT * FROM " + table + " WHERE id = ?", existingId);
                    int changed = updateRow(table, existingId, row, source, license, overwrite);
                    if (changed == 0) {
                        conflicts++;
                    } else {
                        Map<String, Object> after = jdbcTemplate.queryForMap(
                                "SELECT * FROM " + table + " WHERE id = ?", existingId);
                        jdbcTemplate.update("""
                                INSERT INTO poi_version (poi_type, poi_id, change_type, before_json, after_json,
                                                         changed_fields, operator)
                                VALUES (?, ?, 'update', ?, ?, ?, ?)
                                """, type, existingId, toJson(before), toJson(after),
                                String.join(",", changedFields(before, after)), "import:" + source);
                        updated++;
                    }
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
        result.put("overwrite", overwrite);
        result.put("enrich", enrich);
        result.put("inserted", inserted);
        result.put("updated", updated);
        result.put("skipped", skipped);
        result.put("unchanged", conflicts);
        result.put("errors", errors);
        log.info("[import] {} 来源={} 新增={} 更新={} 跳过={} 未变={}",
                type, source, inserted, updated, skipped, conflicts);
        return result;
    }

    private String normalizeType(String type) {
        if (type == null || type.isBlank()) return "bank";
        String value = type.trim().toLowerCase();
        if (value.equals("bank") || value.equals("银行")) return "bank";
        if (value.equals("community") || value.equals("小区") || value.equals("住宅")) return "community";
        throw new IllegalArgumentException("type 只能是 bank 或 community，收到：" + type);
    }

    private Row normalize(Row row) {
        if (row == null) return null;
        return new Row(
                trim(row.id()), trim(row.name()), trim(row.address()), trim(row.district()),
                row.lng(), row.lat(), trim(row.phone()), trim(row.openingHours()), trim(row.brand()),
                trim(row.branchType()), row.builtYear(), row.avgPrice(), row.propertyFee(),
                trim(row.propertyCompany()));
    }

    private String validateEnrich(Row row) {
        if (row == null) return "空行";
        if (blankTo(row.name(), "").isBlank()) return "缺少名称";
        return null;
    }

    private List<Map<String, Object>> matchByName(String table, Row row) {
        if (row.district() != null && !row.district().isBlank()) {
            return jdbcTemplate.queryForList(
                    "SELECT id FROM " + table + " WHERE name = ? AND district = ?",
                    row.name(), row.district());
        }
        return jdbcTemplate.queryForList("SELECT id FROM " + table + " WHERE name = ?", row.name());
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
            List<Map<String, Object>> hits = jdbcTemplate.queryForList(
                    "SELECT id, name FROM " + table + " WHERE id = ?", row.id());
            if (hits.isEmpty()) return null;
            String existingName = String.valueOf(hits.get(0).get("name")).trim();
            if (!existingName.equals(row.name())) {
                throw new IllegalArgumentException(
                        "id 与库中名称不符（库中为「" + existingName + "」），拒绝按 id 覆盖");
            }
            return row.id();
        }

        // 先用窗口粗筛，再用球面距离精筛，避免方形窗口的对角误差
        // 注意：poi_community 没有 brand 列，按表取不同列集合
        String columns = "poi_bank".equals(table)
                ? "id, name, lat, lng, brand, address"
                : "id, name, lat, lng, '' AS brand, address";
        List<Map<String, Object>> candidates = jdbcTemplate.queryForList("""
                SELECT %s FROM %s
                WHERE name = ? AND ABS(lat - ?) <= 0.003 AND ABS(lng - ?) <= 0.003
                """.formatted(columns, table), row.name(), row.lat(), row.lng());

        for (Map<String, Object> candidate : candidates) {
            double lat = ((Number) candidate.get("lat")).doubleValue();
            double lng = ((Number) candidate.get("lng")).doubleValue();
            if (distanceMeters(row.lat(), row.lng(), lat, lng) > SAME_ENTITY_METERS) {
                continue;
            }
            if (!compatible(row, candidate)) {
                continue;
            }
            return String.valueOf(candidate.get("id"));
        }
        return null;
    }

    /** 同名同位置还不够：品牌或地址要能对上，避免把相邻的两家网点合并 */
    private boolean compatible(Row row, Map<String, Object> candidate) {
        String brand = blankTo(row.brand(), "");
        String existingBrand = String.valueOf(candidate.get("brand") == null ? "" : candidate.get("brand"));
        if (!brand.isBlank() && !existingBrand.isBlank() && !brand.equals(existingBrand)) {
            return false;
        }
        String address = blankTo(row.address(), "");
        String existingAddress = String.valueOf(candidate.get("address") == null ? "" : candidate.get("address"));
        if (address.isBlank() || existingAddress.isBlank()) {
            return true;
        }
        return address.contains(existingAddress) || existingAddress.contains(address);
    }

    private double distanceMeters(double lat1, double lng1, double lat2, double lng2) {
        double earth = 6371000;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLng = Math.toRadians(lng2 - lng1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return 2 * earth * Math.asin(Math.min(1, Math.sqrt(a)));
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
                                               property_fee, property_company, demo_attributes, source, license,
                                               source_level, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'L1', 'active')
                    """, id, row.name(), blankTo(row.address(), ""), blankTo(row.district(), ""),
                    row.lng(), row.lat(), row.builtYear(), row.avgPrice(), row.propertyFee(),
                    blankTo(row.propertyCompany(), ""), source, license);
        }
        // 新增行也记字段来源
        List<String> fields = new ArrayList<>();
        if (!blankTo(row.address(), "").isBlank()) fields.add("address");
        if (!blankTo(row.district(), "").isBlank()) fields.add("district");
        if ("bank".equals(type)) {
            if (!blankTo(row.phone(), "").isBlank()) fields.add("phone");
            if (!blankTo(row.openingHours(), "").isBlank()) fields.add("opening_hours");
            if (!blankTo(row.brand(), "").isBlank()) fields.add("brand");
        } else {
            if (row.builtYear() != null) fields.add("built_year");
            if (row.avgPrice() != null) fields.add("avg_price");
            if (row.propertyFee() != null) fields.add("property_fee");
            if (!blankTo(row.propertyCompany(), "").isBlank()) fields.add("property_company");
        }
        recordFieldSources(type, id, fields, source, "");
    }

    /**
     * 默认只补空字段；overwrite=true 才覆盖。
     * 返回实际改动的列数，0 表示没有变化（计入 unchanged）。
     */
    private int updateRow(String table, String id, Row row, String source, String license, boolean overwrite) {
        Map<String, Object> before = jdbcTemplate.queryForMap("SELECT * FROM " + table + " WHERE id = ?", id);
        List<String> sets = new ArrayList<>();
        List<Object> args = new ArrayList<>();

        putIfNeeded(sets, args, before, "address", row.address(), overwrite);
        putIfNeeded(sets, args, before, "district", row.district(), overwrite);
        putIfNeeded(sets, args, before, "source", source, true);
        putIfNeeded(sets, args, before, "license", license, true);
        if ("poi_bank".equals(table)) {
            putIfNeeded(sets, args, before, "phone", row.phone(), overwrite);
            putIfNeeded(sets, args, before, "opening_hours", row.openingHours(), overwrite);
            putIfNeeded(sets, args, before, "brand", row.brand(), overwrite);
        } else {
            putIfNeeded(sets, args, before, "built_year", row.builtYear(), overwrite);
            putIfNeeded(sets, args, before, "avg_price", row.avgPrice(), overwrite);
            putIfNeeded(sets, args, before, "property_fee", row.propertyFee(), overwrite);
            putIfNeeded(sets, args, before, "property_company", row.propertyCompany(), overwrite);
        }
        if (sets.isEmpty()) return 0;
        sets.add("updated_at = NOW()");
        args.add(id);
        jdbcTemplate.update("UPDATE " + table + " SET " + String.join(", ", sets) + " WHERE id = ?",
                args.toArray());

        // 字段级来源：只记真正被写入的数据列（source/license 是元数据，不算）
        Map<String, Object> after = jdbcTemplate.queryForMap("SELECT * FROM " + table + " WHERE id = ?", id);
        List<String> touched = changedFields(before, after);
        touched.removeAll(List.of("source", "license", "updated_at"));
        recordFieldSources(typeOfTable(table), id, touched, source, "");
        return sets.size() - 1;
    }

    private String typeOfTable(String table) {
        return "poi_bank".equals(table) ? "bank" : "community";
    }

    /** 记录「某个字段最后由谁写入」，解决 enrich 改整行 source 掩盖真实来源的问题 */
    private void recordFieldSources(String poiType, String id, List<String> fields, String source, String url) {
        for (String field : fields) {
            jdbcTemplate.update("""
                    INSERT INTO poi_field_source (poi_type, poi_id, field, source, source_url)
                    VALUES (?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE source = VALUES(source), source_url = VALUES(source_url), updated_at = NOW()
                    """, poiType, id, field, source, url == null ? "" : url);
        }
    }

    private void putIfNeeded(List<String> sets, List<Object> args, Map<String, Object> before,
                             String column, Object value, boolean overwrite) {
        if (value == null || (value instanceof String text && text.isBlank())) return;
        Object current = before.get(column);
        String newValue = value instanceof String text ? text.trim() : String.valueOf(value);
        String oldValue = current == null ? "" : String.valueOf(current).trim();
        if (newValue.equals(oldValue)) return;
        boolean currentEmpty = current == null || oldValue.isBlank() || oldValue.equals("0");
        if (!currentEmpty && !overwrite) return;
        sets.add(column + " = ?");
        args.add(value instanceof String text ? text.trim() : value);
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

    private static String trim(String value) {
        return value == null ? null : value.trim();
    }

    private static String blankTo(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value.trim();
    }
}
