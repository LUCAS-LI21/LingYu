package com.poiintel.seed;

import java.io.InputStream;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.poiintel.poi.Districts;

import lombok.RequiredArgsConstructor;

/**
 * 首次启动时把 OSM 种子数据（ODbL）导入本地库。
 * 小区均价/年份 OSM 不提供，这里用与前端一致的稳定哈希生成演示值，并打 demo_attributes 标记。
 */
@Component
@RequiredArgsConstructor
public class SeedRunner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(SeedRunner.class);

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    @Override
    public void run(ApplicationArguments args) throws Exception {
        Integer existing = jdbcTemplate.queryForObject(
                "SELECT (SELECT COUNT(*) FROM poi_bank) + (SELECT COUNT(*) FROM poi_community)", Integer.class);
        if (existing != null && existing > 0) {
            log.info("[seed] 已存在 {} 条 POI，跳过导入", existing);
            return;
        }

        try (InputStream in = new ClassPathResource("seed/pois.json").getInputStream()) {
            JsonNode root = objectMapper.readTree(in);
            JsonNode pois = root.path("pois");
            if (!pois.isArray() || pois.isEmpty()) {
                log.warn("[seed] 种子文件为空，跳过");
                return;
            }

            List<Object[]> banks = new ArrayList<>();
            List<Object[]> communities = new ArrayList<>();

            for (JsonNode node : pois) {
                String type = node.path("type").asText();
                double lng = node.path("lng").asDouble();
                double lat = node.path("lat").asDouble();
                String district = Districts.nearest(lng, lat);
                String name = node.path("name").asText("").trim();
                if (name.isEmpty()) {
                    continue;
                }

                if ("bank".equals(type)) {
                    banks.add(new Object[]{
                            node.path("id").asText(),
                            name,
                            node.path("brand").asText(""),
                            node.path("branchType").asText("branch"),
                            node.path("address").asText(""),
                            district,
                            lng,
                            lat,
                            node.path("phone").asText(""),
                            node.path("openingHours").asText(""),
                            node.path("source").asText("OpenStreetMap"),
                            node.path("license").asText("ODbL"),
                            node.path("sourceLevel").asText("L1")
                    });
                } else if ("community".equals(type)) {
                    int seed = hash(node.path("id").asText() + name);
                    int builtYear = seeded(seed, 1, 1996, 2022);
                    int avgPrice = seeded(seed, 2, 42000, 138000);
                    BigDecimal fee = BigDecimal.valueOf(seeded(seed, 3, 25, 98))
                            .divide(BigDecimal.TEN, 1, RoundingMode.HALF_UP);
                    communities.add(new Object[]{
                            node.path("id").asText(),
                            name,
                            node.path("address").asText(""),
                            district,
                            lng,
                            lat,
                            builtYear,
                            avgPrice,
                            fee,
                            node.path("source").asText("OpenStreetMap"),
                            node.path("license").asText("ODbL"),
                            node.path("sourceLevel").asText("L1")
                    });
                }
            }

            jdbcTemplate.batchUpdate("""
                    INSERT INTO poi_bank
                        (id, name, brand, branch_type, address, district, lng, lat, phone, opening_hours,
                         source, license, source_level)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE name = VALUES(name)
                    """, banks);

            jdbcTemplate.batchUpdate("""
                    INSERT INTO poi_community
                        (id, name, address, district, lng, lat, built_year, avg_price, property_fee,
                         source, license, source_level, demo_attributes)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                    ON DUPLICATE KEY UPDATE name = VALUES(name)
                    """, communities);

            log.info("[seed] 导入完成：银行 {} 条，小区 {} 条", banks.size(), communities.size());
        }
    }

    private static int hash(String input) {
        int h = 0x811c9dc5;
        for (int i = 0; i < input.length(); i++) {
            h ^= input.charAt(i);
            h *= 0x01000193;
        }
        return h & 0x7fffffff;
    }

    private static int seeded(int seed, int salt, int min, int max) {
        double x = Math.sin(seed * 0.0001 + salt * 12.9898) * 43758.5453;
        double frac = x - Math.floor(x);
        return (int) Math.round(min + frac * (max - min));
    }
}
