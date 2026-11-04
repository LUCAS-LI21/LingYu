package com.poiintel.admin;

import java.net.InetSocketAddress;
import java.net.ProxySelector;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.poiintel.poi.DemoData;
import com.poiintel.poi.Districts;

import lombok.RequiredArgsConstructor;

/**
 * OSM 采集：走 Overpass 公共实例，遵守 ODbL 与限速。
 * 只处理可入库（L1）数据；同样逻辑不允许用在高德等 L2 源上（见 docs/requirements/03）。
 *
 * 设计要点：银行与小区分两次请求。landuse=residential 的查询很重，
 * 公共实例常排队超时；拆开后银行能先落库，小区失败只记 partial，不让整任务失败。
 */
@Service
@RequiredArgsConstructor
public class IngestService {

    private static final Logger log = LoggerFactory.getLogger(IngestService.class);

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    @Value("${app.ingest.proxy:}")
    private String proxy;

    @Value("${app.ingest.user-agent:poi-intel-demo/0.1}")
    private String userAgent;

    @Value("${app.ingest.endpoints:https://overpass-api.de/api/interpreter}")
    private String endpoints;

    public long createJob(String triggerType, double south, double west, double north, double east) {
        String scope = String.format("%.5f,%.5f,%.5f,%.5f", south, west, north, east);
        jdbcTemplate.update("""
                INSERT INTO ingest_job (source_code, trigger_type, scope_type, scope_value, status)
                VALUES ('osm_overpass', ?, 'bbox', ?, 'pending')
                """, triggerType, scope);
        Long id = jdbcTemplate.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        return id == null ? 0L : id;
    }

    @Async
    public void runJob(long jobId, double south, double west, double north, double east) {
        jdbcTemplate.update("UPDATE ingest_job SET status = 'running', started_at = NOW() WHERE id = ?", jobId);
        log.info("[ingest] job {} 开始，bbox={},{},{},{} proxy={}", jobId, south, west, north, east, proxy);

        int inserted = 0;
        int updated = 0;
        int failed = 0;
        int fetched = 0;
        List<String> notes = new ArrayList<>();

        try {
            // 第一段：银行/ATM，节点查询，通常几十秒内返回
            String bankQuery = String.format("""
                    [out:json][timeout:120];
                    node["amenity"~"^(bank|atm)$"](%.5f,%.5f,%.5f,%.5f);
                    out center tags;""", south, west, north, east);
            JsonNode bankRoot = fetch(bankQuery, Duration.ofSeconds(150));
            List<Object[]> banks = new ArrayList<>();
            for (JsonNode element : bankRoot.path("elements")) {
                JsonNode tags = element.path("tags");
                String amenity = tags.path("amenity").asText();
                double lat = element.path("lat").asDouble();
                double lng = element.path("lon").asDouble();
                String name = firstNonBlank(tags.path("name").asText(), tags.path("brand").asText(),
                        tags.path("operator").asText());
                if (name.isBlank() || lat == 0 || lng == 0) {
                    failed++;
                    continue;
                }
                banks.add(new Object[]{
                        "osm-node-" + element.path("id").asText(),
                        name,
                        tags.path("brand").asText(""),
                        "atm".equals(amenity) ? "atm" : "branch",
                        address(tags),
                        Districts.nearest(lng, lat),
                        lng,
                        lat,
                        firstNonBlank(tags.path("phone").asText(), tags.path("contact:phone").asText()),
                        tags.path("opening_hours").asText("")
                });
            }
            fetched += banks.size();
            int[] bankResult = upsertBanks(banks);
            for (int rows : bankResult) {
                if (rows == 1) {
                    inserted++;
                } else {
                    updated++;
                }
            }

            // 第二段：小区面，重查询，失败不影响银行已入库的部分
            try {
                String communityQuery = String.format("""
                        [out:json][timeout:150];
                        way["landuse"="residential"](%.5f,%.5f,%.5f,%.5f);
                        out center tags;""", south, west, north, east);
                JsonNode communityRoot = fetch(communityQuery, Duration.ofSeconds(180));
                List<Object[]> communities = new ArrayList<>();
                for (JsonNode element : communityRoot.path("elements")) {
                    JsonNode tags = element.path("tags");
                    String name = tags.path("name").asText("").trim();
                    double lat = element.path("center").path("lat").asDouble();
                    double lng = element.path("center").path("lon").asDouble();
                    if (name.isEmpty() || lat == 0 || lng == 0) {
                        continue;
                    }
                    String id = "osm-way-" + element.path("id").asText();
                    int seed = DemoData.hash(id + name);
                    communities.add(new Object[]{
                            id,
                            name,
                            address(tags),
                            Districts.nearest(lng, lat),
                            lng,
                            lat,
                            DemoData.builtYear(seed),
                            DemoData.avgPrice(seed),
                            DemoData.propertyFee(seed)
                    });
                }
                fetched += communities.size();
                int[] communityResult = upsertCommunities(communities);
                for (int rows : communityResult) {
                    if (rows == 1) {
                        inserted++;
                    } else {
                        updated++;
                    }
                }
            } catch (Exception ex) {
                notes.add("小区段失败：" + shortMessage(ex));
                log.warn("[ingest] job {} 小区段失败：{}", jobId, ex.getMessage());
            }

            String status = notes.isEmpty() ? "success" : "partial";
            jdbcTemplate.update("""
                    UPDATE ingest_job
                    SET status = ?, fetched_count = ?, inserted_count = ?, updated_count = ?,
                        failed_count = ?, error_summary = ?, finished_at = NOW()
                    WHERE id = ?
                    """, status, fetched, inserted, updated, failed, joinNotes(notes), jobId);
            log.info("[ingest] job {} {}：抓取 {}，新增 {}，更新 {}", jobId, status, fetched, inserted, updated);
        } catch (Exception ex) {
            jdbcTemplate.update("""
                    UPDATE ingest_job SET status = 'failed', error_summary = ?, finished_at = NOW() WHERE id = ?
                    """, shortMessage(ex), jobId);
            log.warn("[ingest] job {} 失败：{}", jobId, ex.getMessage());
        }
    }

    private int[] upsertBanks(List<Object[]> rows) {
        if (rows.isEmpty()) {
            return new int[0];
        }
        return jdbcTemplate.batchUpdate("""
                INSERT INTO poi_bank
                    (id, name, brand, branch_type, address, district, lng, lat, phone, opening_hours,
                     source, license, source_level, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OpenStreetMap', 'ODbL', 'L1', NOW())
                ON DUPLICATE KEY UPDATE name = VALUES(name), address = VALUES(address),
                    phone = VALUES(phone), opening_hours = VALUES(opening_hours), updated_at = NOW()
                """, rows);
    }

    private int[] upsertCommunities(List<Object[]> rows) {
        if (rows.isEmpty()) {
            return new int[0];
        }
        return jdbcTemplate.batchUpdate("""
                INSERT INTO poi_community
                    (id, name, address, district, lng, lat, built_year, avg_price, property_fee,
                     demo_attributes, source, license, source_level, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'OpenStreetMap', 'ODbL', 'L1', NOW())
                ON DUPLICATE KEY UPDATE name = VALUES(name), address = VALUES(address), updated_at = NOW()
                """, rows);
    }

    private JsonNode fetch(String query, Duration timeout) throws Exception {
        HttpClient client = buildClient();
        String body = "data=" + URLEncoder.encode(query, StandardCharsets.UTF_8);
        Exception last = null;
        for (String endpoint : endpoints.split(",")) {
            String url = endpoint.trim();
            if (url.isEmpty()) {
                continue;
            }
            try {
                HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                        .header("User-Agent", userAgent)
                        .header("Content-Type", "application/x-www-form-urlencoded")
                        .POST(HttpRequest.BodyPublishers.ofString(body))
                        .timeout(timeout)
                        .build();
                HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
                if (response.statusCode() == 200) {
                    return objectMapper.readTree(response.body());
                }
                last = new IllegalStateException(url + " -> HTTP " + response.statusCode());
            } catch (Exception ex) {
                last = ex;
            }
            Thread.sleep(1200);
        }
        throw last == null ? new IllegalStateException("没有可用的 Overpass 端点") : last;
    }

    private HttpClient buildClient() {
        HttpClient.Builder builder = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(20));
        String value = proxy == null ? "" : proxy.trim();
        if (!value.isEmpty()) {
            value = value.replace("http://", "").replace("https://", "");
            String[] parts = value.split(":");
            if (parts.length == 2) {
                try {
                    builder.proxy(ProxySelector.of(new InetSocketAddress(parts[0], Integer.parseInt(parts[1]))));
                } catch (NumberFormatException ignored) {
                    // 代理配置非法则退回直连
                }
            }
        }
        return builder.build();
    }

    private String address(JsonNode tags) {
        StringBuilder sb = new StringBuilder();
        for (String key : new String[]{"addr:province", "addr:city", "addr:district", "addr:street", "addr:housenumber"}) {
            String part = tags.path(key).asText("");
            if (!part.isBlank()) {
                sb.append(part);
            }
        }
        return sb.isEmpty() ? tags.path("addr:full").asText("") : sb.toString();
    }

    private String firstNonBlank(String... values) {
        for (String value : values) {
            if (value != null && !value.isBlank()) {
                return value;
            }
        }
        return "";
    }

    private String shortMessage(Exception ex) {
        String message = ex.getClass().getSimpleName() + ": " + String.valueOf(ex.getMessage());
        return message.length() > 480 ? message.substring(0, 480) : message;
    }

    private String joinNotes(List<String> notes) {
        if (notes.isEmpty()) {
            return "";
        }
        String joined = String.join("；", notes);
        return joined.length() > 480 ? joined.substring(0, 480) : joined;
    }
}
