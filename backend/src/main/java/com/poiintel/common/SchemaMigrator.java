package com.poiintel.common;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * 极简迁移器：按文件名顺序执行 db/migration/*.sql，记录于 schema_version，仅执行一次。
 * "Duplicate column/key/table" 视为已应用。
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class SchemaMigrator implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(SchemaMigrator.class);

    private final JdbcTemplate jdbcTemplate;

    public SchemaMigrator(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Override
    public void run(ApplicationArguments args) {
        jdbcTemplate.execute("""
                CREATE TABLE IF NOT EXISTS schema_version (
                  version    VARCHAR(64) NOT NULL PRIMARY KEY,
                  applied_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP
                ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT '迁移版本'
                """);

        List<Resource> files = new ArrayList<>();
        try {
            Resource[] found = new PathMatchingResourcePatternResolver()
                    .getResources("classpath:db/migration/V*.sql");
            files.addAll(List.of(found));
        } catch (IOException ex) {
            throw new IllegalStateException("读取迁移脚本失败", ex);
        }
        files.sort(Comparator.comparing(r -> String.valueOf(r.getFilename())));

        for (Resource file : files) {
            String name = file.getFilename() == null ? "" : file.getFilename().replace(".sql", "");
            Integer applied = jdbcTemplate.queryForObject(
                    "SELECT COUNT(*) FROM schema_version WHERE version = ?", Integer.class, name);
            if (applied != null && applied > 0) {
                continue;
            }
            log.info("[migrate] 应用 {}", name);
            for (String statement : splitStatements(read(file))) {
                try {
                    jdbcTemplate.execute(statement);
                } catch (RuntimeException ex) {
                    if (isAlreadyApplied(ex)) {
                        log.debug("[migrate] {} 已存在，跳过：{}", name, head(statement));
                    } else {
                        throw new IllegalStateException("迁移 " + name + " 失败：" + head(statement), ex);
                    }
                }
            }
            jdbcTemplate.update("INSERT INTO schema_version (version) VALUES (?)", name);
        }
    }

    private String read(Resource resource) {
        try (var in = resource.getInputStream()) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException ex) {
            throw new IllegalStateException("读取失败：" + resource, ex);
        }
    }

    /** 按分号切分语句，跳过纯注释行 */
    private List<String> splitStatements(String sql) {
        List<String> out = new ArrayList<>();
        for (String raw : sql.split(";")) {
            String statement = raw.strip();
            if (statement.isEmpty()) {
                continue;
            }
            StringBuilder kept = new StringBuilder();
            for (String line : statement.split("\n")) {
                String trimmed = line.stripLeading();
                if (trimmed.startsWith("--")) {
                    continue;
                }
                kept.append(line).append('\n');
            }
            String cleaned = kept.toString().strip();
            if (!cleaned.isEmpty()) {
                out.add(cleaned);
            }
        }
        return out;
    }

    private boolean isAlreadyApplied(RuntimeException ex) {
        Throwable cause = ex;
        while (cause != null) {
            if (cause instanceof SQLException sql) {
                String state = sql.getSQLState();
                // 42S21 = Duplicate column；42S01 = Table exists；42000 含 Duplicate key/索引
                return "42S21".equals(state) || "42S01".equals(state)
                        || (sql.getMessage() != null && sql.getMessage().contains("Duplicate"));
            }
            cause = cause.getCause();
        }
        return false;
    }

    private String head(String statement) {
        String flat = statement.replaceAll("\\s+", " ").strip();
        return flat.length() > 80 ? flat.substring(0, 80) + "…" : flat;
    }
}
