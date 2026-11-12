package com.poiintel.poi;

import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
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
