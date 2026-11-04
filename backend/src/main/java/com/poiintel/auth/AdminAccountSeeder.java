package com.poiintel.auth;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import lombok.RequiredArgsConstructor;

/**
 * 首次启动创建内置运营账号；口令来自配置，库里只存 PBKDF2 哈希。
 */
@Component
@RequiredArgsConstructor
public class AdminAccountSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(AdminAccountSeeder.class);

    private final JdbcTemplate jdbcTemplate;

    @Value("${app.auth.operator-username:operator}")
    private String username;

    @Value("${app.auth.operator-password:operator123}")
    private String password;

    @Override
    public void run(ApplicationArguments args) {
        Integer count = jdbcTemplate.queryForObject("SELECT COUNT(*) FROM sys_user", Integer.class);
        if (count != null && count > 0) {
            return;
        }
        if ("operator123".equals(password)) {
            log.warn("[auth] 正在使用默认运营口令，请通过 OPERATOR_PASSWORD 环境变量覆盖");
        }
        jdbcTemplate.update("""
                INSERT INTO sys_user (username, password_hash, role, display_name, status)
                VALUES (?, ?, 'operator', '数据运营', 1)
                """, username, AuthService.encodeSaltAndHash(password));
    }
}
