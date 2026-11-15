package com.poiintel.poi;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Service;

import com.poiintel.common.GeoCoord;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class PoiService {

    private final PoiMapper poiMapper;

    public record PageResult(List<PoiRow> items, long total, int page, int size) {
    }

    public record NearbyItem(PoiRow poi, double distance) {
    }

    public PageResult list(PoiQuery query) {
        long total = poiMapper.count(query);
        List<PoiRow> items = total == 0 ? List.of() : poiMapper.query(query);
        items.forEach(this::fillGcj);
        int page = query.getOffset() / Math.max(1, query.getSize()) + 1;
        return new PageResult(items, total, page, query.getSize());
    }

    public PoiRow detail(String id) {
        PoiRow row = poiMapper.findById(id);
        if (row == null) {
            throw new IllegalArgumentException("POI 不存在：" + id);
        }
        fillGcj(row);
        return row;
    }

    /**
     * 补 GCJ-02 坐标：库里存 WGS-84，高德/腾讯导航要 GCJ-02。
     * 前端做「导航」跳转时直接用 gcjLng/gcjLat，不要自己拿 lng/lat 拼链接。
     */
    private void fillGcj(PoiRow row) {
        if (row == null || row.getLng() == null || row.getLat() == null) {
            return;
        }
        double[] gcj = GeoCoord.wgs84ToGcj02(row.getLng(), row.getLat());
        row.setGcjLng(Math.round(gcj[0] * 1e6) / 1e6);
        row.setGcjLat(Math.round(gcj[1] * 1e6) / 1e6);
    }

    public List<NearbyItem> nearby(double lng, double lat, double radius, String branchType, int limit) {
        List<PoiRow> rows = poiMapper.nearby(lng, lat, radius, branchType, limit);
        List<NearbyItem> result = new ArrayList<>(rows.size());
        for (PoiRow row : rows) {
            fillGcj(row);
            result.add(new NearbyItem(row, distanceMeters(lat, lng, row.getLat(), row.getLng())));
        }
        return result;
    }

    /** 反向关联：某银行网点周边的小区（与「小区周边银行」互为镜像） */
    public List<NearbyItem> nearbyCommunities(double lng, double lat, double radius, int limit) {
        List<PoiRow> rows = poiMapper.nearbyCommunities(lng, lat, radius, limit);
        List<NearbyItem> result = new ArrayList<>(rows.size());
        for (PoiRow row : rows) {
            fillGcj(row);
            result.add(new NearbyItem(row, distanceMeters(lat, lng, row.getLat(), row.getLng())));
        }
        return result;
    }

    public Map<String, Object> stats() {
        int bank = 0;
        int atm = 0;
        int branch = 0;
        int community = 0;

        for (Map<String, Object> row : poiMapper.countsByType()) {
            String type = String.valueOf(row.get("type"));
            String branchType = String.valueOf(row.get("branchType"));
            int count = ((Number) row.get("cnt")).intValue();
            if ("bank".equals(type)) {
                bank += count;
                if ("atm".equals(branchType)) {
                    atm += count;
                } else {
                    branch += count;
                }
            } else {
                community += count;
            }
        }

        Map<String, Object> stats = new LinkedHashMap<>();
        stats.put("total", bank + community);
        stats.put("bank", bank);
        stats.put("atm", atm);
        stats.put("branch", branch);
        stats.put("community", community);
        stats.put("districts", poiMapper.districtCount());
        stats.put("brands", normalizeList(poiMapper.topBrands(8), "label", "value"));
        stats.put("byDistrict", poiMapper.countsByDistrict());
        stats.put("priceBuckets", orderedBuckets(poiMapper.priceBuckets()));
        stats.put("gridTop", gridCells(poiMapper.gridTop(6)));
        return stats;
    }

    private List<Map<String, Object>> normalizeList(List<Map<String, Object>> rows, String labelKey,
                                                    String valueKey) {
        List<Map<String, Object>> result = new ArrayList<>(rows.size());
        for (Map<String, Object> row : rows) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put(labelKey, String.valueOf(row.get("label")));
            item.put(valueKey, ((Number) row.get("value")).intValue());
            result.add(item);
        }
        return result;
    }

    /** 价格分桶固定顺序，避免 SQL 分组后顺序随机 */
    private List<Map<String, Object>> orderedBuckets(List<Map<String, Object>> rows) {
        String[] order = {"< 5 万", "5–7 万", "7–9 万", "9–11 万", "≥ 11 万", "未知"};
        Map<String, Integer> counts = new LinkedHashMap<>();
        for (String label : order) {
            counts.put(label, 0);
        }
        for (Map<String, Object> row : rows) {
            String label = String.valueOf(row.get("label"));
            counts.put(label, ((Number) row.get("value")).intValue());
        }
        List<Map<String, Object>> result = new ArrayList<>();
        for (String label : order) {
            if ("未知".equals(label)) {
                continue;
            }
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("label", label);
            item.put("value", counts.getOrDefault(label, 0));
            result.add(item);
        }
        return result;
    }

    private List<Map<String, Object>> gridCells(List<Map<String, Object>> rows) {
        List<Map<String, Object>> result = new ArrayList<>(rows.size());
        for (Map<String, Object> row : rows) {
            double gx = ((Number) row.get("gx")).doubleValue();
            double gy = ((Number) row.get("gy")).doubleValue();
            double lng = (gx + 0.5) * 0.02;
            double lat = (gy + 0.5) * 0.02;
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("label", String.format("%.2f, %.2f", lng, lat));
            item.put("value", ((Number) row.get("value")).intValue());
            item.put("lng", lng);
            item.put("lat", lat);
            result.add(item);
        }
        return result;
    }

    /** Haversine，单位米 */
    public static double distanceMeters(double lat1, double lng1, double lat2, double lng2) {
        double r = 6371000d;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLng = Math.toRadians(lng2 - lng1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return 2 * r * Math.asin(Math.sqrt(a));
    }
}
