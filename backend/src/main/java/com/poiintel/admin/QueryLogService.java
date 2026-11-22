package com.poiintel.admin;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class QueryLogService {

    private static final Logger log = LoggerFactory.getLogger(QueryLogService.class);

    private final JdbcTemplate jdbcTemplate;

    /** 记录查询日志；失败不影响主流程，仅告警。 */
    public void log(String kind, String keyword, String district, String grid, int resultCount, long costMs) {
        try {
            jdbcTemplate.update("""
                    INSERT INTO query_log (kind, keyword, district, grid, result_count, cost_ms)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """, kind, safe(keyword), safe(district), safe(grid), resultCount, (int) costMs);
        } catch (Exception ex) {
            log.debug("查询日志写入失败：{}", ex.getMessage());
        }
    }

    /** 0.02° 网格（约 2.2km），与统计页口径一致 */
    public static String gridOf(Double lng, Double lat) {
        if (lng == null || lat == null) {
            return "";
        }
        double gx = Math.floor(lng / 0.02) * 0.02 + 0.01;
        double gy = Math.floor(lat / 0.02) * 0.02 + 0.01;
        return String.format("%.2f,%.2f", gx, gy);
    }

    private String safe(String value) {
        if (value == null) {
            return "";
        }
        return value.length() > 120 ? value.substring(0, 120) : value;
    }
}
