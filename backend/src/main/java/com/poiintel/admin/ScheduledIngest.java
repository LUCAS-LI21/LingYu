package com.poiintel.admin;

import java.util.List;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import lombok.RequiredArgsConstructor;

/**
 * 定时抓取：把"热点驱动"从手动按钮变成自动动作。
 * 优先抓最近查询最多的网格；没有热点时退回福田中心区默认范围。
 */
@Component
@RequiredArgsConstructor
public class ScheduledIngest {

    private static final Logger log = LoggerFactory.getLogger(ScheduledIngest.class);

    /** 默认范围：福田中心区，半径约 3km */
    private static final double[] DEFAULT_CENTER = {114.055, 22.541};
    // 单次抓取范围约 2.2km：早期用 0.03（约 6.6km）时 Overpass 频繁 504，任务大面积 partial
    private static final double HALF_SPAN = 0.01;

    private final JdbcTemplate jdbcTemplate;
    private final IngestService ingestService;
    private final AdminService adminService;

    @Value("${app.ingest.enabled:true}")
    private boolean enabled;

    /** 每日重算热点，避免调度器读到过期排名（评审 P2-12） */
    @Scheduled(cron = "${app.hotspot.recompute-cron:0 30 2 * * *}")
    public void recomputeHotspotsDaily() {
        try {
            Map<String, Object> result = adminService.recomputeHotspots();
            log.info("[schedule] 每日热点重算完成：{}", result);
        } catch (Exception ex) {
            log.warn("[schedule] 热点重算失败：{}", ex.getMessage());
        }
    }

    @Scheduled(initialDelayString = "${app.ingest.initial-delay-ms:120000}",
            fixedDelayString = "${app.ingest.schedule-ms:1800000}")
    public void run() {
        if (!enabled) {
            return;
        }
        Integer running = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM ingest_job WHERE status IN ('pending','running')", Integer.class);
        if (running != null && running > 0) {
            log.info("[schedule] 已有任务在执行，跳过本轮");
            return;
        }

        String trigger = "schedule";
        double[] center = DEFAULT_CENTER;
        List<String> hot = jdbcTemplate.queryForList(
                "SELECT grid FROM hot_region ORDER BY priority DESC, updated_at DESC LIMIT 1", String.class);
        if (!hot.isEmpty()) {
            String[] parts = hot.get(0).split(",");
            if (parts.length == 2) {
                try {
                    center = new double[]{Double.parseDouble(parts[0].trim()), Double.parseDouble(parts[1].trim())};
                    trigger = "hotspot";
                } catch (NumberFormatException ignored) {
                    // 网格格式异常则用默认范围
                }
            }
        }

        double south = center[1] - HALF_SPAN;
        double north = center[1] + HALF_SPAN;
        double west = center[0] - HALF_SPAN;
        double east = center[0] + HALF_SPAN;

        long jobId = ingestService.createJob(trigger, south, west, north, east);
        ingestService.runJob(jobId, south, west, north, east);
        log.info("[schedule] 触发 job {}（{}，中心 {},{})", jobId, trigger, center[0], center[1]);
    }
}
