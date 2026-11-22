package com.poiintel.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.Optional;

import javax.crypto.Mac;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;

/** 轻量鉴权：PBKDF2 存口令 + HMAC-SHA256 签 token。 */
@Service
@RequiredArgsConstructor
public class AuthService {

    private static final String HMAC = "HmacSHA256";
    private static final int ITERATIONS = 120_000;
    private static final Logger log = LoggerFactory.getLogger(AuthService.class);

    private final JdbcTemplate jdbcTemplate;

    @Value("${app.auth.secret:}")
    private String secret;

    @Value("${app.auth.ttl-minutes:720}")
    private long ttlMinutes;

    /** 未配置密钥时生成临时随机值，防止默认密钥被用于伪造 token */
    @PostConstruct
    void initSecret() {
        if (secret == null || secret.isBlank() || secret.startsWith("dev-only")) {
            byte[] random = new byte[32];
            new SecureRandom().nextBytes(random);
            secret = Base64.getEncoder().encodeToString(random);
            log.warn("[auth] 未配置 AUTH_SECRET，已生成临时密钥；服务重启后已签发的 token 将失效");
        } else if (secret.getBytes(StandardCharsets.UTF_8).length < 32) {
            log.warn("[auth] AUTH_SECRET 长度不足 32 字节，建议更换为更长的随机值");
        }
    }

    public record Session(String token, String username, long expiresAt) {
    }

    public Optional<Session> login(String username, String password) {
        var rows = jdbcTemplate.queryForList(
                "SELECT username, password_hash FROM sys_user WHERE username = ? AND status = 1", username);
        if (rows.isEmpty()) {
            return Optional.empty();
        }
        String stored = String.valueOf(rows.get(0).get("password_hash"));
        if (!verifyPassword(password, stored)) {
            return Optional.empty();
        }
        jdbcTemplate.update("UPDATE sys_user SET last_login_at = NOW() WHERE username = ?", username);
        long expiresAt = Instant.now().plusSeconds(ttlMinutes * 60).getEpochSecond();
        return Optional.of(new Session(sign(username, expiresAt), username, expiresAt));
    }

    /** 取用户角色（operator/viewer）；账号不存在返回空。 */
    public java.util.Optional<String> roleOf(String username) {
        try {
            return jdbcTemplate.queryForList("SELECT role FROM sys_user WHERE username = ? AND status = 1",
                    String.class, username).stream().findFirst();
        } catch (Exception ex) {
            return java.util.Optional.empty();
        }
    }

    /** 校验并返回用户名 */
    public Optional<String> verify(String token) {
        try {
            String[] parts = token.split("\\.");
            if (parts.length != 2) {
                return Optional.empty();
            }
            String payload = new String(Base64.getUrlDecoder().decode(parts[0]), StandardCharsets.UTF_8);
            String[] fields = payload.split("\\|");
            if (fields.length != 2) {
                return Optional.empty();
            }
            String username = fields[0];
            long expiresAt = Long.parseLong(fields[1]);
            if (Instant.now().getEpochSecond() > expiresAt) {
                return Optional.empty();
            }
            String expected = base64Url(hmac(payload));
            if (!MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8),
                    parts[1].getBytes(StandardCharsets.UTF_8))) {
                return Optional.empty();
            }
            return Optional.of(username);
        } catch (Exception ex) {
            return Optional.empty();
        }
    }

    private String sign(String username, long expiresAt) {
        String payload = username + "|" + expiresAt;
        return base64Url(payload.getBytes(StandardCharsets.UTF_8)) + "." + base64Url(hmac(payload));
    }

    private byte[] hmac(String payload) {
        try {
            Mac mac = Mac.getInstance(HMAC);
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), HMAC));
            return mac.doFinal(payload.getBytes(StandardCharsets.UTF_8));
        } catch (Exception ex) {
            throw new IllegalStateException("签名失败", ex);
        }
    }

    public static String hashPassword(String password, byte[] salt) {
        try {
            PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), salt, ITERATIONS, 256);
            SecretKeyFactory factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
            return Base64.getEncoder().encodeToString(factory.generateSecret(spec).getEncoded());
        } catch (Exception ex) {
            throw new IllegalStateException("口令哈希失败", ex);
        }
    }

    private boolean verifyPassword(String raw, String stored) {
        return matches(raw, stored);
    }

    /** 校验明文口令与 base64(salt)$base64(hash) 是否一致。 */
    public static boolean matches(String raw, String stored) {
        try {
            String[] parts = stored.split("\\$");
            if (parts.length != 2) {
                return false;
            }
            // 格式：base64(salt)$base64(hash)
            byte[] salt = Base64.getDecoder().decode(parts[0]);
            String computed = hashPassword(raw, salt);
            return MessageDigest.isEqual(computed.getBytes(StandardCharsets.UTF_8),
                    parts[1].getBytes(StandardCharsets.UTF_8));
        } catch (Exception ex) {
            return false;
        }
    }

    public static String encodeSaltAndHash(String password) {
        byte[] salt = new byte[16];
        new SecureRandom().nextBytes(salt);
        return Base64.getEncoder().encodeToString(salt) + "$" + hashPassword(password, salt);
    }

    private String base64Url(byte[] bytes) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
}
