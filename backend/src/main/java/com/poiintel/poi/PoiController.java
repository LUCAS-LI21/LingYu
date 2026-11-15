package com.poiintel.poi;

import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.poiintel.admin.QueryLogService;
import com.poiintel.common.ApiResult;

import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class PoiController {

    private final PoiService poiService;
    private final QueryLogService queryLogService;
    private final CommunityLocateService locateService;
    private final JdbcTemplate jdbcTemplate;

    @GetMapping("/health")
    public ApiResult<Map<String, Object>> health() {
        Integer one = jdbcTemplate.queryForObject("SELECT 1", Integer.class);
        return ApiResult.ok(Map.of("status", "ok", "db", one != null && one == 1 ? "up" : "down"));
    }

    @GetMapping("/pois")
    public ApiResult<PoiService.PageResult> list(
            @RequestParam(required = false) String types,
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) String district,
            @RequestParam(required = false, defaultValue = "all") String branchType,
            @RequestParam(required = false) Integer minPrice,
            @RequestParam(required = false) Integer maxPrice,
            @RequestParam(required = false) Integer minYear,
            @RequestParam(required = false) Integer maxYear,
            @RequestParam(required = false) Double west,
            @RequestParam(required = false) Double south,
            @RequestParam(required = false) Double east,
            @RequestParam(required = false) Double north,
            @RequestParam(required = false, defaultValue = "default") String sort,
            @RequestParam(required = false, defaultValue = "1") int page,
            @RequestParam(required = false, defaultValue = "20") int size) {

        PoiQuery query = new PoiQuery();
        query.setTypes(parseTypes(types));
        query.setKeyword(keyword);
        query.setDistrict(district);
        query.setBranchType(branchType == null ? "all" : branchType);
        query.setMinPrice(minPrice);
        query.setMaxPrice(maxPrice);
        query.setMinYear(minYear);
        query.setMaxYear(maxYear);
        query.setWest(west);
        query.setSouth(south);
        query.setEast(east);
        query.setNorth(north);
        query.setSort(sort == null ? "default" : sort);
        // 上限 20000：小区已扩到 3600+，加上银行超过 5000，卡太低会导致前端静默丢点位
        int safeSize = Math.min(Math.max(size, 1), 20000);
        query.setSize(safeSize);
        query.setOffset(Math.max(0, (Math.max(page, 1) - 1) * safeSize));

        long started = System.currentTimeMillis();
        PoiService.PageResult result = poiService.list(query);

        // 查询日志 → 热点闭环的原料（失败不影响主流程）
        Double centerLng = (west != null && east != null) ? (west + east) / 2 : null;
        Double centerLat = (south != null && north != null) ? (south + north) / 2 : null;
        queryLogService.log("list", keyword, district, QueryLogService.gridOf(centerLng, centerLat),
                result.items().size(), System.currentTimeMillis() - started);

        return ApiResult.ok(result);
    }

    @GetMapping("/pois/nearby")
    public ApiResult<Map<String, Object>> nearby(
            @RequestParam double lng,
            @RequestParam double lat,
            @RequestParam(defaultValue = "1000") double radius,
            @RequestParam(required = false, defaultValue = "all") String branchType,
            @RequestParam(defaultValue = "50") int limit) {

        long started = System.currentTimeMillis();
        List<PoiService.NearbyItem> items = poiService.nearby(lng, lat, radius, branchType,
                Math.min(Math.max(limit, 1), 200));
        queryLogService.log("nearby", "", "", QueryLogService.gridOf(lng, lat), items.size(),
                System.currentTimeMillis() - started);
        return ApiResult.ok(Map.of("items", items, "total", items.size()));
    }

    @GetMapping("/pois/{id}")
    public ApiResult<PoiRow> detail(@PathVariable String id) {
        return ApiResult.ok(poiService.detail(id));
    }

    /** 字段级来源：每个字段最后由谁写入（政府/官网/Agent/审核），用于回答"这条数据哪来的" */
    @GetMapping("/pois/{id}/sources")
    public ApiResult<java.util.List<Map<String, Object>>> sources(@PathVariable String id) {
        return ApiResult.ok(jdbcTemplate.queryForList("""
                SELECT field, source, source_url, updated_at
                FROM poi_field_source WHERE poi_id = ? ORDER BY field
                """, id));
    }

    /**
     * 待定位小区名录（有名称地址、缺坐标）。
     *
     * 定位靠「高德地图查看」外链：把地址交给用户在浏览器里打开，
     * 我们不解析、不存储坐标（高德协议禁止存储，见 docs/design/数据源矩阵.md）。
     */
    @GetMapping("/community-pending")
    public ApiResult<Map<String, Object>> communityPending(
            @RequestParam(required = false) String district,
            @RequestParam(required = false) String keyword,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int size) {
        int safeSize = Math.min(Math.max(size, 1), 100);
        int safePage = Math.max(page, 1);
        List<Object> args = new java.util.ArrayList<>();
        StringBuilder where = new StringBuilder(" WHERE status = 'pending' ");
        if (district != null && !district.isBlank()) {
            where.append(" AND district = ? ");
            args.add(district.trim());
        }
        if (keyword != null && !keyword.isBlank()) {
            where.append(" AND (name LIKE ? OR address LIKE ?) ");
            String like = "%" + keyword.trim() + "%";
            args.add(like);
            args.add(like);
        }
        String base = " FROM community_pending " + where;
        Integer total = jdbcTemplate.queryForObject("SELECT COUNT(*)" + base, Integer.class, args.toArray());
        List<Object> pageArgs = new java.util.ArrayList<>(args);
        pageArgs.add(safeSize);
        pageArgs.add((safePage - 1) * safeSize);
        List<Map<String, Object>> items = jdbcTemplate.queryForList(
                "SELECT id, name, address, district, street, attribute" + base
                        + " ORDER BY district, name LIMIT ? OFFSET ?",
                pageArgs.toArray());

        Map<String, Object> result = new java.util.LinkedHashMap<>();
        result.put("total", total == null ? 0 : total);
        result.put("page", safePage);
        result.put("size", safeSize);
        result.put("items", items);
        return ApiResult.ok(result);
    }

    /** 待定位小区的地图初始中心（按区给一个近似中心，含 GCJ 版） */
    @GetMapping("/community-pending/hint")
    public ApiResult<Map<String, Object>> communityPendingHint(
            @RequestParam(required = false) String district) {
        return ApiResult.ok(locateService.hint(district));
    }

    /**
     * 用户提交坐标（众包）：进入待审队列，管理员通过后才转正。
     * 小程序/网页都能调，无需登录；管理员标注走 /admin 下的同名接口（直接生效）。
     */
    @PostMapping("/community-pending/{id}/locate")
    public ApiResult<Map<String, Object>> locate(
            @PathVariable String id,
            @RequestBody Map<String, Object> body) {
        double lng = number(body.get("lng"));
        double lat = number(body.get("lat"));
        String note = body.get("note") == null ? "" : String.valueOf(body.get("note"));
        return ApiResult.ok(locateService.submit(id, lng, lat, "user", "web", note));
    }

    private double number(Object value) {
        if (value instanceof Number n) {
            return n.doubleValue();
        }
        if (value == null) {
            throw new IllegalArgumentException("缺少坐标");
        }
        return Double.parseDouble(String.valueOf(value));
    }

    /**
     * 反向关联：某银行网点周边的小区（赛题「查询某银行服务范围内的小区信息」）。
     * 与「小区周边银行」互为镜像，同样按球面距离升序。
     */
    @GetMapping("/pois/{id}/nearby-communities")
    public ApiResult<Map<String, Object>> nearbyCommunities(
            @PathVariable String id,
            @RequestParam(defaultValue = "1000") double radius,
            @RequestParam(defaultValue = "10") int limit) {
        PoiRow poi = poiService.detail(id);
        int safeLimit = Math.min(Math.max(limit, 1), 50);
        List<PoiService.NearbyItem> items =
                poiService.nearbyCommunities(poi.getLng(), poi.getLat(), radius, safeLimit);
        List<Map<String, Object>> list = new java.util.ArrayList<>();
        for (PoiService.NearbyItem item : items) {
            PoiRow community = item.poi();
            Map<String, Object> row = new java.util.LinkedHashMap<>();
            row.put("id", community.getId());
            row.put("name", community.getName());
            row.put("address", community.getAddress());
            row.put("district", community.getDistrict());
            row.put("distance", Math.round(item.distance()));
            row.put("avgPrice", community.getAvgPrice());
            row.put("builtYear", community.getBuiltYear());
            list.add(row);
        }
        Map<String, Object> result = new java.util.LinkedHashMap<>();
        result.put("poiId", id);
        result.put("radius", radius);
        result.put("items", list);
        return ApiResult.ok(result);
    }

    /**
     * 最近 N 家银行：小区详情页用，按球面距离升序。
     * 半径默认 5km，找不到就返回空列表（不编造"附近"）。
     */
    @GetMapping("/pois/{id}/nearest-banks")
    public ApiResult<Map<String, Object>> nearestBanks(
            @PathVariable String id,
            @RequestParam(defaultValue = "3") int limit,
            @RequestParam(defaultValue = "5000") double radius) {
        PoiRow poi = poiService.detail(id);
        if (poi == null) {
            throw new IllegalArgumentException("点位不存在");
        }
        int safeLimit = Math.min(Math.max(limit, 1), 10);
        List<PoiService.NearbyItem> items = poiService.nearby(poi.getLng(), poi.getLat(), radius, "all", safeLimit);
        List<Map<String, Object>> list = new java.util.ArrayList<>();
        for (PoiService.NearbyItem item : items) {
            PoiRow bank = item.poi();
            Map<String, Object> row = new java.util.LinkedHashMap<>();
            row.put("id", bank.getId());
            row.put("name", bank.getName());
            row.put("brand", bank.getBrand());
            row.put("address", bank.getAddress());
            row.put("branchType", bank.getBranchType());
            row.put("distance", Math.round(item.distance()));
            list.add(row);
        }
        Map<String, Object> result = new java.util.LinkedHashMap<>();
        result.put("poiId", id);
        result.put("items", list);
        return ApiResult.ok(result);
    }

    /**
     * 存量住宅用地（宗地级）：政府开放数据接入的旁证，和 POI 是两套语义，单独查询。
     */
    @GetMapping("/land-parcels")
    public ApiResult<Map<String, Object>> landParcels(
            @RequestParam(required = false) String district,
            @RequestParam(defaultValue = "20") int limit) {
        int safeLimit = Math.min(Math.max(limit, 1), 200);
        boolean filtered = district != null && !district.isBlank();
        String where = filtered ? "WHERE district_street LIKE ? " : "";
        Object[] args = filtered ? new Object[]{"%" + district.trim() + "%"} : new Object[0];
        Map<String, Object> result = new java.util.LinkedHashMap<>();
        result.put("total", jdbcTemplate.queryForObject("SELECT COUNT(*) FROM land_parcel " + where,
                Integer.class, args));
        result.put("items", jdbcTemplate.queryForList(
                "SELECT id, district_street, location, area_ha, housing_type, build_status, developer, "
                        + "project_name, supply_date FROM land_parcel " + where
                        + "ORDER BY supply_date DESC LIMIT " + safeLimit, args));
        return ApiResult.ok(result);
    }

    @GetMapping("/stats")
    public ApiResult<Map<String, Object>> stats() {
        return ApiResult.ok(poiService.stats());
    }

    private List<String> parseTypes(String types) {
        if (types == null || types.isBlank()) {
            return List.of("bank", "community");
        }
        return List.of(types.split(",")).stream().map(String::trim).filter(s -> !s.isEmpty()).toList();
    }
}
