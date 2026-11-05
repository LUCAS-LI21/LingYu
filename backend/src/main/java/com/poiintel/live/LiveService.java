package com.poiintel.live;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import lombok.RequiredArgsConstructor;

/**
 * L2 实时层（ADR-0001）：只展示、不落库。
 *
 * 高德服务协议 3.5 条禁止存储/缓存 API 返回数据，因此这里：
 * - 不写任何表、不缓存、不记响应体
 * - 只在用户显式点击时调用一次，结果直接回给前端
 * - 未配置 Key 时优雅降级，不影响主功能
 */
@Service
@RequiredArgsConstructor
public class LiveService {

    private static final Logger log = LoggerFactory.getLogger(LiveService.class);

    private final ObjectMapper objectMapper;

    @Value("${app.live.amap-key:}")
    private String amapKey;

    public Map<String, Object> reverseGeocode(double lng, double lat) {
        Map<String, Object> result = new LinkedHashMap<>();
        if (amapKey == null || amapKey.isBlank()) {
            result.put("enabled", false);
            result.put("reason", "未配置 AMAP_KEY：实时地址查询不可用（这是合规设计，不是故障）");
            return result;
        }

        String url = String.format(
                "https://restapi.amap.com/v3/geocode/regeo?location=%.6f,%.6f&key=%s", lng, lat, amapKey);
        try {
            HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
            HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofSeconds(6))
                    .GET()
                    .build();
            HttpResponse<String> response = client
                    .sendAsync(request, HttpResponse.BodyHandlers.ofString())
                    .orTimeout(10, TimeUnit.SECONDS)
                    .join();

            JsonNode root = objectMapper.readTree(response.body());
            String status = root.path("status").asText();
            if (!"1".equals(status)) {
                result.put("enabled", true);
                result.put("error", root.path("info").asText("高德返回异常"));
                return result;
            }

            String address = root.path("regeocode").path("formatted_address").asText("");
            result.put("enabled", true);
            result.put("address", address);
            result.put("source", "amap");
            result.put("stored", false);
            return result;
        } catch (Exception ex) {
            // 只记异常类型，不记 URL（含 key）与响应体
            log.warn("[live] 高德逆地理编码失败：{}", ex.getClass().getSimpleName());
            result.put("enabled", true);
            result.put("error", "实时地址查询超时或失败");
            return result;
        }
    }
}
