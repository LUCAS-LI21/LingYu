package com.poiintel.admin;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import lombok.RequiredArgsConstructor;

/**
 * 启动自愈：进程被杀时残留的 pending/running 任务会永久占住调度锁（评审 P1-8）。
 * 启动时统一标记为失败，让下一次调度能正常开始。
 */
@Component
@RequiredArgsConstructor
public class JobRecoveryRunner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(JobRecoveryRunner.class);

    private final JdbcTemplate jdbcTemplate;

    @Override
    public void run(ApplicationArguments args) {
        int recovered = jdbcTemplate.update("""
                UPDATE ingest_job
                SET status = 'failed', error_summary = '服务重启导致任务中断', finished_at = NOW()
                WHERE status IN ('pending', 'running')
                """);
        if (recovered > 0) {
            log.warn("[ingest] 启动清理：{} 个未完成任务已标记失败", recovered);
        }
    }
}
