package com.poiintel.poi;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.poiintel.common.GeoCoord;

import lombok.RequiredArgsConstructor;

/**
 * 待定位小区的「众包标注位置」。
 *
 * 背景：全市 4 941 个小区只有名称与地址、没有坐标，而公开数据里没有小区级坐标，
 * 商业地图（高德/腾讯）的坐标又不能落库（协议 3.5）。唯一合规的办法是**自己产生数据**：
 * 用户或管理员在地图上点一下，坐标就是旁证可查的一手数据。
 *
 * 规则：
 * - 管理员标注（source=admin）→ 直接转正；
 * - 用户提交（source=user）→ 进 coordinate_submission 待审，管理员通过后才转正；
 * - 转正时写 poi_community（来源标注「用户贡献/管理员标注」）+ poi_field_source 逐字段留痕。
 */
@Service
@RequiredArgsConstructor
public class CommunityLocateService {

    private final JdbcTemplate jdbcTemplate;

    private static final double LNG_MIN = 113.6, LNG_MAX = 114.7;
    private static final double LAT_MIN = 22.3, LAT_MAX = 22.9;

    private void validateCoord(double lng, double lat) {
        if (lng < LNG_MIN || lng > LNG_MAX || lat < LAT_MIN || lat > LAT_MAX) {
            throw new IllegalArgumentException("坐标超出深圳范围");
        }
    }

    /**
     * 把「用户反馈新增小区」暂存进 community_pending，等运营标注坐标后转正。
     * 与银行那条链路对称：反馈 → 暂存 → 标注 → 转正 → 地图可见。
     */
    public String stagePending(String name, String address, String source, String feedbackCode) {
        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("小区名称不能为空");
        }
        String id = "fb-" + feedbackCode;
        String district = "";
        if (address != null) {
            for (String d : new String[]{"福田区", "南山区", "罗湖区", "宝安区", "龙岗区", "盐田区", "龙华区", "坪山区", "光明区", "大鹏新区"}) {
                if (address.contains(d)) {
                    district = d;
                    break;
                }
            }
        }
        jdbcTemplate.update("""
                INSERT INTO community_pending (id, name, address, district, source, status, attribute)
                VALUES (?, ?, ?, ?, ?, 'pending', '用户反馈')
                ON DUPLICATE KEY UPDATE name = VALUES(name), address = VALUES(address), district = VALUES(district)
                """, id, name.trim(), address == null ? "" : address.trim(), district, source);
        return id;
    }

    /**
     * 提交坐标。管理员直接转正并返回 poiId，用户提交进审核队列。
     */
    @Transactional
    public Map<String, Object> submit(String pendingId, double lng, double lat, String source,
            String submitter, String note) {
        validateCoord(lng, lat);
        Map<String, Object> pending = jdbcTemplate.queryForMap(
                "SELECT * FROM community_pending WHERE id = ?", pendingId);
        String status = String.valueOf(pending.get("status"));
        if ("geocoded".equals(status)) {
            throw new IllegalStateException("该小区已定位，无需重复提交");
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("pendingId", pendingId);

        if ("admin".equals(source)) {
            String poiId = promote(pending, lng, lat, "admin:" + submitter);
            result.put("status", "approved");
            result.put("poiId", poiId);
            return result;
        }

        jdbcTemplate.update("""
                INSERT INTO coordinate_submission (pending_id, lng, lat, source, submitter, note)
                VALUES (?, ?, ?, 'user', ?, ?)
                """, pendingId, lng, lat, submitter == null ? "" : submitter, note == null ? "" : note);
        result.put("status", "pending");
        result.put("message", "已提交，等待管理员核实");
        return result;
    }

    public List<Map<String, Object>> submissions(String status, int limit) {
        String where = status == null || status.isBlank() ? "" : "WHERE s.status = ? ";
        Object[] args = where.isEmpty() ? new Object[]{Math.min(Math.max(limit, 1), 200)}
                : new Object[]{status, Math.min(Math.max(limit, 1), 200)};
        return jdbcTemplate.queryForList(
                "SELECT s.id, s.pending_id, s.lng, s.lat, s.source, s.submitter, s.note, s.status, "
                        + "s.created_at, p.name, p.address, p.district, p.street "
                        + "FROM coordinate_submission s JOIN community_pending p ON p.id = s.pending_id "
                        + where + "ORDER BY s.id DESC LIMIT ?", args);
    }

    /** 审核通过：把提交里的坐标转正 */
    @Transactional
    public Map<String, Object> approve(long submissionId, String reviewer) {
        Map<String, Object> row = jdbcTemplate.queryForMap(
                "SELECT * FROM coordinate_submission WHERE id = ?", submissionId);
        if (!"pending".equals(String.valueOf(row.get("status")))) {
            throw new IllegalStateException("该提交已处理");
        }
        String pendingId = String.valueOf(row.get("pending_id"));
        double lng = ((Number) row.get("lng")).doubleValue();
        double lat = ((Number) row.get("lat")).doubleValue();
        Map<String, Object> pending = jdbcTemplate.queryForMap(
                "SELECT * FROM community_pending WHERE id = ?", pendingId);
        String poiId = promote(pending, lng, lat, reviewer);
        jdbcTemplate.update("""
                UPDATE coordinate_submission SET status = 'approved', reviewer = ?, reviewed_at = NOW(), poi_id = ?
                WHERE id = ? AND status = 'pending'
                """, reviewer, poiId, submissionId);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("status", "approved");
        result.put("poiId", poiId);
        return result;
    }

    @Transactional
    public Map<String, Object> reject(long submissionId, String reviewer) {
        int updated = jdbcTemplate.update("""
                UPDATE coordinate_submission SET status = 'rejected', reviewer = ?, reviewed_at = NOW()
                WHERE id = ? AND status = 'pending'
                """, reviewer, submissionId);
        if (updated == 0) {
            throw new IllegalStateException("该提交已处理");
        }
        return Map.of("status", "rejected");
    }

    /**
     * 把待定位小区转正成 poi_community：写坐标、来源、字段级留痕。
     * 调用前坐标已校验。
     */
    private String promote(Map<String, Object> pending, double lng, double lat, String operator) {
        String pendingId = String.valueOf(pending.get("id"));
        String name = String.valueOf(pending.get("name"));
        String address = String.valueOf(pending.get("address"));
        String district = String.valueOf(pending.get("district"));
        Object existing = pending.get("poi_id");
        if (existing != null && !String.valueOf(existing).isBlank()) {
            return String.valueOf(existing);
        }

        String poiId = "cp-" + pendingId;
        String source = operator.startsWith("admin") ? "管理员标注" : "用户贡献";
        jdbcTemplate.update("""
                INSERT INTO poi_community (id, name, address, district, lng, lat, property_company,
                                           demo_attributes, source, license, source_level, status)
                VALUES (?, ?, ?, ?, ?, ?, '', 1, ?, '用户确认坐标（已审核）', 'L1', 'active')
                ON DUPLICATE KEY UPDATE lng = VALUES(lng), lat = VALUES(lat), updated_at = NOW()
                """, poiId, name, address, district, lng, lat, source);

        for (String field : List.of("name", "address", "district", "lng", "lat")) {
            jdbcTemplate.update("""
                    INSERT INTO poi_field_source (poi_type, poi_id, field, source, source_url)
                    VALUES ('community', ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE source = VALUES(source), source_url = VALUES(source_url),
                        updated_at = NOW()
                    """, poiId, field, source, "manual:" + operator);
        }

        jdbcTemplate.update("""
                UPDATE community_pending SET status = 'geocoded', lng = ?, lat = ?,
                    geocode_source = ?, geocoded_at = NOW(), poi_id = ?
                WHERE id = ?
                """, lng, lat, operator.startsWith("admin") ? "admin" : "user", poiId, pendingId);
        return poiId;
    }

    /** 前端画点用：给待定位小区一个建议中心（区中心），没有坐标时用来初始化地图 */
    public Map<String, Object> hint(String district) {
        Map<String, Object> result = new LinkedHashMap<>();
        double[] center = switch (district == null ? "" : district) {
            case "福田区" -> new double[]{114.055, 22.541};
            case "南山区" -> new double[]{113.930, 22.533};
            case "罗湖区" -> new double[]{114.131, 22.548};
            case "宝安区" -> new double[]{113.884, 22.555};
            case "龙岗区" -> new double[]{114.246, 22.720};
            case "盐田区" -> new double[]{114.237, 22.557};
            case "龙华区" -> new double[]{114.030, 22.657};
            case "坪山区" -> new double[]{114.350, 22.708};
            case "光明区" -> new double[]{113.936, 22.748};
            case "大鹏新区" -> new double[]{114.479, 22.596};
            default -> new double[]{114.057, 22.543};
        };
        // 给前端也备一份 GCJ-02，避免它自己转
        double[] gcj = GeoCoord.wgs84ToGcj02(center[0], center[1]);
        result.put("lng", center[0]);
        result.put("lat", center[1]);
        result.put("gcjLng", Math.round(gcj[0] * 1e6) / 1e6);
        result.put("gcjLat", Math.round(gcj[1] * 1e6) / 1e6);
        return result;
    }
}
