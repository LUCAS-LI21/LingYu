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
 * 内置运营账号：口令来自配置，库中只存 PBKDF2 哈希。
 * 显式配置 OPERATOR_PASSWORD 时以配置值为准，覆盖库中已有口令。
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

    // 用 String 接收并宽松解析：空串会导致布尔转换异常
    @Value("${app.auth.allow-default-password:false}")
    private String allowDefaultPasswordRaw;

    @Override
    public void run(ApplicationArguments args) {
        // 空口令一律拒绝
        if (password == null || password.isBlank()) {
            throw new IllegalStateException(
                    "OPERATOR_PASSWORD 为空，拒绝启动；请设置为随机强口令（不允许空口令登录）");
        }
        // 使用默认口令时非开发环境启动失败
        boolean allowDefaultPassword = "true".equalsIgnoreCase(
                allowDefaultPasswordRaw == null ? "" : allowDefaultPasswordRaw.trim());
        if (DEFAULT_PASSWORD.equals(password) && !allowDefaultPassword) {
            throw new IllegalStateException(
                    "OPERATOR_PASSWORD 仍是默认值，拒绝启动；请设置随机强口令（开发环境可设 APP_AUTH_ALLOW_DEFAULT_PASSWORD=true 放行）");
        }
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

        // 已存在账号仅在配置非默认口令时校准密码
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
