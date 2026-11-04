package com.poiintel.poi;

import java.util.List;
import java.util.Map;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.poiintel.common.ApiResult;

import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class PoiController {

    private final PoiService poiService;
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
        int safeSize = Math.min(Math.max(size, 1), 5000);
        query.setSize(safeSize);
        query.setOffset(Math.max(0, (Math.max(page, 1) - 1) * safeSize));

        return ApiResult.ok(poiService.list(query));
    }

    @GetMapping("/pois/nearby")
    public ApiResult<Map<String, Object>> nearby(
            @RequestParam double lng,
            @RequestParam double lat,
            @RequestParam(defaultValue = "1000") double radius,
            @RequestParam(required = false, defaultValue = "all") String branchType,
            @RequestParam(defaultValue = "50") int limit) {

        List<PoiService.NearbyItem> items = poiService.nearby(lng, lat, radius, branchType,
                Math.min(Math.max(limit, 1), 200));
        return ApiResult.ok(Map.of("items", items, "total", items.size()));
    }

    @GetMapping("/pois/{id}")
    public ApiResult<PoiRow> detail(@PathVariable String id) {
        return ApiResult.ok(poiService.detail(id));
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
