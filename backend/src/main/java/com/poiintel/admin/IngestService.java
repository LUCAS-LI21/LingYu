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
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.TimeUnit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.poiintel.poi.DemoData;
import com.poiintel.poi.Districts;

import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;

/**
 * OSM 采集（Overpass 公共实例，ODbL，限速）；仅处理可入库（L1）数据。
 * 银行与小区分两次请求：小区查询重，失败仅记 partial，不影响银行落库。
 */
@Service
@RequiredArgsConstructor
public class IngestService {

    private static final Logger log = LoggerFactory.getLogger(IngestService.class);

    /** 表名白名单：版本写入需拼表名，禁止外部输入 */
    private static final Set<String> TABLES = Set.of("poi_bank", "poi_community");

    /** 与 upsert 参数顺序严格对应（第 0 位是 id） */
    private static final List<String> BANK_COLUMNS = List.of(
            "name", "brand", "branch_type", "address", "district", "lng", "lat", "phone", "opening_hours");
    private static final List<String> COMMUNITY_COLUMNS = List.of(
            "name", "address", "district", "lng", "lat", "built_year", "avg_price_demo", "property_fee");

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;
    private final PlatformTransactionManager transactionManager;

    /** 每段写库单独短事务；网络抓取在事务外，避免长事务锁表 */
    private TransactionTemplate transactionTemplate;

    @PostConstruct
    void initTransactionTemplate() {
        this.transactionTemplate = new TransactionTemplate(transactionManager);
    }

    @Value("${app.ingest.proxy:}")
    private String proxy;

    @Value("${app.ingest.user-agent:poi-intel-demo/0.1}")
    private String userAgent;

    @Value("${app.ingest.endpoints:https://overpass-api.de/api/interpreter}")
    private String endpoints;

    /** 创建任务；synchronized + 运行中检查避免并发采集，多实例需 DB 级锁。 */
    public synchronized long createJob(String triggerType, double south, double west, double north, double east) {
        return createJob(triggerType, south, west, north, east, "");
    }

    /** 带反馈编号创建任务，结束后回写反馈状态。 */
    public synchronized long createJob(String triggerType, double south, double west, double north,
                                       double east, String feedbackCode) {
        Integer running = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM ingest_job WHERE status IN ('pending','running')", Integer.class);
        if (running != null && running > 0) {
            throw new IllegalStateException("已有抓取任务在执行，请稍后再试");
        }
        String scope = String.format("%.5f,%.5f,%.5f,%.5f", south, west, north, east);
        // 用 GeneratedKeyHolder 取主键：LAST_INSERT_ID() 可能读到其他连接的 0
        org.springframework.jdbc.support.GeneratedKeyHolder keyHolder =
                new org.springframework.jdbc.support.GeneratedKeyHolder();
        jdbcTemplate.update(connection -> {
            java.sql.PreparedStatement ps = connection.prepareStatement("""
                    INSERT INTO ingest_job (source_code, trigger_type, scope_type, scope_value, status, feedback_code)
                    VALUES ('osm_overpass', ?, 'bbox', ?, 'pending', ?)
                    """, java.sql.Statement.RETURN_GENERATED_KEYS);
            ps.setString(1, triggerType);
            ps.setString(2, scope);
            ps.setString(3, feedbackCode == null ? "" : feedbackCode);
            return ps;
        }, keyHolder);
        Number key = keyHolder.getKey();
        if (key == null) {
            throw new IllegalStateException("创建抓取任务失败：未拿到主键");
        }
        return key.longValue();
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
            // 第一段：银行/ATM 节点查询
            String bankQuery = String.format("""
                    [out:json][timeout:120];
                    node["amenity"~"^(bank|atm)$"](%.5f,%.5f,%.5f,%.5f);
                    out center tags;""", south, west, north, east);
            JsonNode bankRoot = fetch(bankQuery, Duration.ofSeconds(100));
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
            int[] bankResult = transactionTemplate.execute(state -> {
                int skipped = dropHumanEdited("bank", banks);
                if (skipped > 0) {
                    notes.add("跳过 " + skipped + " 条近期人工修改的网点");
                }
                recordVersions("poi_bank", "bank", banks, BANK_COLUMNS);
                return upsertBanks(banks);
            });
            if (bankResult == null) {
                bankResult = new int[0];
            }
            for (int rows : bankResult) {
                if (rows == 1) {
                    inserted++;
                } else {
                    updated++;
                }
            }

            // 第二段：小区面查询，失败不影响已入库的银行
            try {
                String communityQuery = String.format("""
                        [out:json][timeout:150];
                        way["landuse"="residential"](%.5f,%.5f,%.5f,%.5f);
                        out center tags;""", south, west, north, east);
                JsonNode communityRoot = fetch(communityQuery, Duration.ofSeconds(120));
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
                int[] communityResult = transactionTemplate.execute(state -> {
                    int skipped = dropHumanEdited("community", communities);
                    if (skipped > 0) {
                        notes.add("跳过 " + skipped + " 条近期人工修改的小区");
                    }
                    recordVersions("poi_community", "community", communities, COMMUNITY_COLUMNS);
                    return upsertCommunities(communities);
                });
                if (communityResult == null) {
                    communityResult = new int[0];
                }
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
            writeBackFeedback(jobId, status, inserted + updated, null);
        } catch (Exception ex) {
            // 失败也回写已完成计数，避免任务显示 0 条
            jdbcTemplate.update("""
                    UPDATE ingest_job
                    SET status = 'failed', fetched_count = ?, inserted_count = ?, updated_count = ?,
                        failed_count = ?, error_summary = ?, finished_at = NOW()
                    WHERE id = ?
                    """, fetched, inserted, updated, failed, shortMessage(ex), jobId);
            log.warn("[ingest] job {} 失败：{}", jobId, ex.getMessage());
            writeBackFeedback(jobId, "failed", 0, shortMessage(ex));
        }
    }

    /** 任务结束后回写反馈：成功/部分成功 → approved，失败 → need_refetch。 */
    private void writeBackFeedback(long jobId, String jobStatus, int touched, String error) {
        try {
            List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                    "SELECT feedback_code FROM ingest_job WHERE id = ? AND feedback_code <> ''", jobId);
            if (rows.isEmpty()) {
                return;
            }
            String code = String.valueOf(rows.get(0).get("feedback_code"));
            if ("failed".equals(jobStatus)) {
                jdbcTemplate.update("""
                        UPDATE feedback SET status = 'need_refetch', reviewed_at = NOW(),
                            review_note = ? WHERE code = ? AND status IN ('need_refetch','pending')
                        """, "重抓失败：" + (error == null ? "未知原因" : error), code);
            } else {
                jdbcTemplate.update("""
                        UPDATE feedback SET status = 'approved', reviewed_at = NOW(),
                            review_note = ? WHERE code = ? AND status IN ('need_refetch','pending')
                        """, "已重抓并入库，本次影响 " + touched + " 个点位", code);
            }
            log.info("[ingest] job {} 回写反馈 {} → {}", jobId, code, jobStatus);
        } catch (Exception ex) {
            log.warn("[ingest] job {} 回写反馈失败：{}", jobId, ex.getMessage());
        }
    }

    /** 采集侧写版本：仅把真正变化的字段记一条 poi_version。 */
    private void recordVersions(String table, String poiType, List<Object[]> rows, List<String> columns) {
        if (rows.isEmpty()) {
            return;
        }
        if (!TABLES.contains(table)) {
            throw new IllegalArgumentException("非法表名：" + table);
        }
        List<String> ids = new ArrayList<>(rows.size());
        for (Object[] row : rows) {
            ids.add(String.valueOf(row[0]));
        }
        Map<String, Map<String, Object>> existing = loadExisting(table, ids);
        if (existing.isEmpty()) {
            return;
        }

        List<Object[]> versions = new ArrayList<>();
        for (Object[] row : rows) {
            String id = String.valueOf(row[0]);
            Map<String, Object> before = existing.get(id);
            if (before == null) {
                continue;
            }
            Map<String, Object> after = new LinkedHashMap<>();
            List<String> changed = new ArrayList<>();
            for (int i = 0; i < columns.size(); i++) {
                String column = columns.get(i);
                Object newValue = row[i + 1];
                after.put(column, newValue);
                if (differs(before.get(column), newValue)) {
                    changed.add(column);
                }
            }
            if (changed.isEmpty()) {
                continue;
            }
            versions.add(new Object[]{
                    poiType, id, "update",
                    toJson(before), toJson(after),
                    String.join(",", changed), "system:ingest"
            });
        }

        if (!versions.isEmpty()) {
            jdbcTemplate.batchUpdate("""
                    INSERT INTO poi_version
                        (poi_type, poi_id, change_type, before_json, after_json, changed_fields, operator)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """, versions);
            log.info("[ingest] 记录 {} 条采集变更版本", versions.size());
        }
    }

    private Map<String, Map<String, Object>> loadExisting(String table, List<String> ids) {
        Map<String, Map<String, Object>> result = new HashMap<>();
        int chunkSize = 400;
        for (int i = 0; i < ids.size(); i += chunkSize) {
            List<String> chunk = ids.subList(i, Math.min(ids.size(), i + chunkSize));
            String placeholders = String.join(",", Collections.nCopies(chunk.size(), "?"));
            List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                    "SELECT * FROM " + table + " WHERE id IN (" + placeholders + ")", chunk.toArray());
            for (Map<String, Object> row : rows) {
                result.put(String.valueOf(row.get("id")), row);
            }
        }
        return result;
    }

    private boolean differs(Object oldValue, Object newValue) {
        if (oldValue == null && newValue == null) {
            return false;
        }
        if (oldValue == null || newValue == null) {
            return true;
        }
        if (oldValue instanceof Number || newValue instanceof Number) {
            try {
                double a = ((Number) oldValue).doubleValue();
                double b = newValue instanceof Number n ? n.doubleValue() : Double.parseDouble(String.valueOf(newValue));
                return Math.abs(a - b) > 1e-6;
            } catch (NumberFormatException ex) {
                return true;
            }
        }
        return !String.valueOf(oldValue).trim().equals(String.valueOf(newValue).trim());
    }

    private String toJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception ex) {
            return "{}";
        }
    }

    /** 近 30 天被人工审核改过的 POI 不参与本次覆盖，人工修正优先。 */
    private int dropHumanEdited(String poiType, List<Object[]> rows) {
        Set<String> locked = new HashSet<>(jdbcTemplate.queryForList("""
                SELECT DISTINCT poi_id FROM poi_version
                WHERE poi_type = ? AND operator NOT LIKE 'system:ingest'
                  AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                """, String.class, poiType));
        if (locked.isEmpty() || rows.isEmpty()) {
            return 0;
        }
        int before = rows.size();
        rows.removeIf(row -> locked.contains(String.valueOf(row[0])));
        return before - rows.size();
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
                ON DUPLICATE KEY UPDATE name = VALUES(name),
                    -- 空值不覆盖：OSM 常常没电话/营业时间，直接覆盖会把人工/官网补的值抹掉
                    address = IF(VALUES(address) = '', address, VALUES(address)),
                    phone = IF(VALUES(phone) = '', phone, VALUES(phone)),
                    opening_hours = IF(VALUES(opening_hours) = '', opening_hours, VALUES(opening_hours)),
                    updated_at = NOW()
                """, rows);
    }

    private int[] upsertCommunities(List<Object[]> rows) {
        if (rows.isEmpty()) {
            return new int[0];
        }
        // 名称闸门：楼栋编号不入库，丢弃并计入 failed_count
        int before = rows.size();
        rows.removeIf(row -> row.length > 1 && com.poiintel.common.NameQuality.isBuildingLike(
                row[1] == null ? null : String.valueOf(row[1])));
        if (rows.size() < before) {
            log.warn("[ingest] 小区名称闸门拦截 {} 条楼栋编号（如 29栋 / 36小区）", before - rows.size());
        }
        if (rows.isEmpty()) {
            return new int[0];
        }
        return jdbcTemplate.batchUpdate("""
                INSERT INTO poi_community
                    (id, name, address, district, lng, lat, built_year, avg_price_demo, property_fee,
                     demo_attributes, source, license, source_level, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'OpenStreetMap', 'ODbL', 'L1', NOW())
                ON DUPLICATE KEY UPDATE name = VALUES(name), address = VALUES(address), updated_at = NOW()
                """, rows);
    }

    private JsonNode fetch(String query, Duration timeout) {
        HttpClient client = buildClient();
        String body = "data=" + URLEncoder.encode(query, StandardCharsets.UTF_8);
        RuntimeException last = null;
        String[] hosts = endpoints.split(",");
        // 两轮重试：先顺序试所有镜像，全挂则退避后重来一次
        for (int round = 1; round <= 2; round++) {
            for (String endpoint : hosts) {
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
                    // sendAsync + orTimeout 做硬上限：HttpRequest.timeout 在代理 CONNECT 挂起时不生效
                    HttpResponse<String> response = client
                            .sendAsync(request, HttpResponse.BodyHandlers.ofString())
                            .orTimeout(timeout.toSeconds() + 15, TimeUnit.SECONDS)
                            .join();
                    if (response.statusCode() == 200) {
                        return objectMapper.readTree(response.body());
                    }
                    last = new IllegalStateException(url + " -> HTTP " + response.statusCode());
                } catch (Exception ex) {
                    Throwable cause = ex instanceof java.util.concurrent.CompletionException && ex.getCause() != null
                            ? ex.getCause()
                            : ex;
                    last = cause instanceof RuntimeException re ? re : new IllegalStateException(cause);
                }
                try {
                    Thread.sleep(1200);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    throw last == null ? new IllegalStateException("抓取被中断") : last;
                }
            }
            if (round == 1) {
                try {
                    Thread.sleep(3000L * round);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
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
                // 代理配置非法时退回直连
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
