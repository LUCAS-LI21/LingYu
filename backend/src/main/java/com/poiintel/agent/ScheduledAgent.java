package com.poiintel.agent;

import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import lombok.RequiredArgsConstructor;

/** 每日定时批量补全（默认关闭，需 app.agent.schedule-enabled=true）；仅产出建议。 */
@Component
@RequiredArgsConstructor
public class ScheduledAgent {

    private static final Logger log = LoggerFactory.getLogger(ScheduledAgent.class);

    private final AgentService agentService;
    private final DeepSeekClient deepSeekClient;

    @org.springframework.beans.factory.annotation.Value("${app.agent.schedule-enabled:false}")
    private boolean enabled;

    @org.springframework.beans.factory.annotation.Value("${app.agent.batch-size:10}")
    private int batchSize;

    /** 每天 03:30 执行一批 */
    @Scheduled(cron = "${app.agent.cron:0 30 3 * * *}")
    public void dailyEnrich() {
        if (!enabled) {
            return;
        }
        if (!deepSeekClient.enabled()) {
            log.warn("[agent-schedule] 未配置 DEEPSEEK_API_KEY，跳过");
            return;
        }
        try {
            Map<String, Object> result = agentService.batch("bank", "address", batchSize, true);
            log.info("[agent-schedule] 本批完成：{}", result.get("tally"));
        } catch (Exception ex) {
            log.warn("[agent-schedule] 执行失败：{}", ex.getMessage());
        }
    }
}
