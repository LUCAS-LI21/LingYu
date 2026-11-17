package com.poiintel.auth;

import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import lombok.RequiredArgsConstructor;

/**
 * 内置运营账号：口令来自配置，库里只存 PBKDF2 哈希。
 *
 * 两条规则：
 * 1. 账号不存在 → 创建
 * 2. 账号存在，但显式配置了 OPERATOR_PASSWORD，且与配置值不一致 → **更新成配置值**
 *
 * 为什么要有第 2 条：部署时常用真实数据覆盖容器初始化库（mysqldump 导入），
 * 导入的 sys_user 会盖掉环境变量设的口令，导致 .env 里的密码"看起来没生效"。
 * 让环境变量成为唯一权威，部署行为才可预期。
 */
@Component
@RequiredArgsConstructor
public class AdminAccountSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(AdminAccountSeeder.class);

    private static final String DEFAULT_PASSWORD = "operator123";

    private final JdbcTemplate jdbcTemplate;

    @Value("${app.auth.operator-username:operator}")
    private String username;

    @Value("${app.auth.operator-password:" + DEFAULT_PASSWORD + "}")
    private String password;

    @Override
    public void run(ApplicationArguments args) {
        List<String> hashes = jdbcTemplate.queryForList(
                "SELECT password_hash FROM sys_user WHERE username = ?", String.class, username);

        if (hashes.isEmpty()) {
            jdbcTemplate.update("""
                    INSERT INTO sys_user (username, password_hash, role, display_name, status)
                    VALUES (?, ?, 'operator', '数据运营', 1)
                    """, username, AuthService.encodeSaltAndHash(password));
            if (DEFAULT_PASSWORD.equals(password)) {
                log.warn("[auth] 正在使用默认运营口令，请通过 OPERATOR_PASSWORD 环境变量覆盖");
            }
            return;
        }

        // 已存在：仅在显式配置了非默认口令时校准，避免默认值反复覆盖运维改过的密码
        if (DEFAULT_PASSWORD.equals(password)) {
            return;
        }
        if (!AuthService.matches(password, hashes.get(0))) {
            jdbcTemplate.update("UPDATE sys_user SET password_hash = ? WHERE username = ?",
                    AuthService.encodeSaltAndHash(password), username);
            log.info("[auth] 已按 OPERATOR_PASSWORD 校准运营账号口令");
        }
    }
}
