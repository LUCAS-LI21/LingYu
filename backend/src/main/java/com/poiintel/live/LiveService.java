package com.poiintel.live;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.poiintel.common.GeoCoord;

/**
 * L2 实时层（ADR-0001 / ADR-0002）：只展示、不落库。
 *
 * <p>高德服务协议 3.5 条禁止存储/缓存 API 返回数据，因此这里：
 *
 * <ul>
 *   <li>不写任何表、不缓存、不记响应体
 *   <li>只在用户显式点击时调用一次，结果直接回给前端
 *   <li>调用前做 WGS-84 → GCJ-02 转换（OSM/浏览器给的是 WGS-84，高德要 GCJ-02）
 *   <li>每日预算与最小间隔闸门，防止误用打爆 5,000/月 的搜索配额
 *   <li>未配置 Key 时优雅降级，不影响主功能
 * </ul>
 */
@Service
public class LiveService {

    private static final Logger log = LoggerFactory.getLogger(LiveService.class);

    private final ObjectMapper objectMapper;
    private final String amapKey;
    private final LiveQuota quota;

    public LiveService(
            ObjectMapper objectMapper,
            @Value("${app.live.amap-key:}") String amapKey,
            @Value("${app.live.daily-budget:300}") int dailyBudget,
            @Value("${app.live.daily-budget-around:100}") int aroundBudget,
            @Value("${app.live.min-interval-ms:200}") long minIntervalMs) {
        this.objectMapper = objectMapper;
        this.amapKey = amapKey == null ? "" : amapKey.trim();
        this.quota = new LiveQuota(dailyBudget, aroundBudget, minIntervalMs);
    }

    public Map<String, Object> reverseGeocode(double lng, double lat) {
        Map<String, Object> result = new LinkedHashMap<>();
        if (amapKey.isBlank()) {
            result.put("enabled", false);
            result.put("reason", "未配置 AMAP_KEY：实时地址查询不可用（这是合规设计，不是故障）");
            return result;
        }

        // 本地库/OSM 是 WGS-84，高德 regeo 没有坐标系入参，必须先转成 GCJ-02
        double[] gcj = GeoCoord.wgs84ToGcj02(lng, lat);
        LiveQuota.Decision gate = quota.acquire(false);
        if (!gate.allowed()) {
            return throttled(result, gate.reason());
        }

        String url = String.format(
                "https://restapi.amap.com/v3/geocode/regeo?location=%.6f,%.6f&key=%s", gcj[0], gcj[1], amapKey);
        try {
            JsonNode root = get(url);

            String status = root.path("status").asText();
            if (!"1".equals(status)) {
                result.put("enabled", true);
                result.put("throttled", false);
                result.put("error", friendly(root.path("info").asText("高德返回异常")));
                return result;
            }

            String address = root.path("regeocode").path("formatted_address").asText("");
            result.put("enabled", true);
            result.put("throttled", false);
            result.put("address", address);
            result.put("source", "amap");
            result.put("stored", false);
            result.put("coord_sys", "gcj02");
            return result;
        } catch (Exception ex) {
            // 只记异常类型，不记 URL（含 key）与响应体
            log.warn("[live] 高德逆地理编码失败：{}", ex.getClass().getSimpleName());
            result.put("enabled", true);
            result.put("throttled", false);
            result.put("error", "实时地址查询超时或失败");
            return result;
        }
    }

    /**
     * L2 实时周边 POI：用高德 around 搜索补齐"本地库这里没数据"的体验。
     *
     * <p>同样不落库、不缓存，只回给当前请求。返回坐标统一转回 WGS-84，
     * 避免前端把它画到 OSM 底图上时偏数百米。
     */
    public Map<String, Object> searchAround(double lng, double lat, int radius, String keywords) {
        Map<String, Object> result = new LinkedHashMap<>();
        if (amapKey.isBlank()) {
            result.put("enabled", false);
            result.put("reason", "未配置 AMAP_KEY：实时周边查询不可用");
            return result;
        }

        double[] gcj = GeoCoord.wgs84ToGcj02(lng, lat);
        LiveQuota.Decision gate = quota.acquire(true);
        if (!gate.allowed()) {
            return throttled(result, gate.reason());
        }

        StringBuilder url = new StringBuilder(String.format(
                "https://restapi.amap.com/v3/place/around?location=%.6f,%.6f&radius=%d&offset=10&page=1&key=%s",
                gcj[0], gcj[1], Math.min(Math.max(radius, 100), 5000), amapKey));
        if (keywords != null && !keywords.isBlank()) {
            url.append("&keywords=").append(URLEncoder.encode(keywords, StandardCharsets.UTF_8));
        }

        try {
            JsonNode root = get(url.toString());
            if (!"1".equals(root.path("status").asText())) {
                result.put("enabled", true);
                result.put("throttled", false);
                result.put("error", friendly(root.path("info").asText("高德返回异常")));
                return result;
            }

            List<Map<String, Object>> items = new ArrayList<>();
            for (JsonNode poi : root.path("pois")) {
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("name", poi.path("name").asText(""));
                item.put("address", poi.path("address").asText(""));
                item.put("type", poi.path("type").asText(""));
                item.put("phone", poi.path("tel").asText(""));
                String distance = poi.path("distance").asText("");
                if (!distance.isBlank()) {
                    try {
                        item.put("distance", (int) Double.parseDouble(distance));
                    } catch (NumberFormatException ignored) {
                        // 高德偶发返回空串，忽略即可
                    }
                }
                String location = poi.path("location").asText("");
                String[] parts = location.split(",");
                if (parts.length == 2) {
                    try {
                        double[] wgs = GeoCoord.gcj02ToWgs84(
                                Double.parseDouble(parts[0]), Double.parseDouble(parts[1]));
                        item.put("lng", round6(wgs[0]));
                        item.put("lat", round6(wgs[1]));
                    } catch (NumberFormatException ignored) {
                        // 坐标异常就只展示名称/地址，不阻断整条结果
                    }
                }
                items.add(item);
            }

            result.put("enabled", true);
            result.put("throttled", false);
            result.put("source", "amap");
            result.put("stored", false);
            result.put("coord_sys", "wgs84");
            result.put("items", items);
            return result;
        } catch (Exception ex) {
            log.warn("[live] 高德周边查询失败：{}", ex.getClass().getSimpleName());
            result.put("enabled", true);
            result.put("throttled", false);
            result.put("error", "实时周边查询超时或失败");
            return result;
        }
    }

    private JsonNode get(String url) throws Exception {
        HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
        HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(6))
                .GET()
                .build();
        HttpResponse<String> response = client
                .sendAsync(request, HttpResponse.BodyHandlers.ofString())
                .orTimeout(10, TimeUnit.SECONDS)
                .join();
        return objectMapper.readTree(response.body());
    }

    private Map<String, Object> throttled(Map<String, Object> result, String reason) {
        log.info("[live] 触发本地闸门，跳过高德请求：{}（今日已用 {} 次，其中周边 {} 次）",
                reason, quota.usedToday(), quota.usedAroundToday());
        result.put("enabled", true);
        result.put("throttled", true);
        result.put("stored", false);
        result.put("error", reason);
        return result;
    }

    /** 把高德的英文错误码翻成人话，方便前端直接展示与排查。 */
    private static String friendly(String info) {
        if (info == null || info.isBlank()) {
            return "高德返回异常";
        }
        if (info.contains("DAILY_QUERY_OVER_LIMIT") || info.contains("CUQPS_HAS_EXCEEDED_THE_LIMIT")) {
            return "高德配额已用尽或并发超限（" + info + "），已降级为本地库";
        }
        if (info.contains("INVALID_USER_KEY")
                || info.contains("USERKEY_PLAT_NOMATCH")
                || info.contains("INVALID_USER_SCODE")) {
            return "高德 Key 无效或平台类型不匹配（请确认是「Web服务」Key）：" + info;
        }
        return info;
    }

    private static double round6(double value) {
        return Math.round(value * 1_000_000d) / 1_000_000d;
    }
}
