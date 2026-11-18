package com.poiintel.auth;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.poiintel.common.ApiResult;
import com.poiintel.common.RateLimitException;

import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api/v1/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;

    /** 每个 IP 的登录尝试时间窗，用于限流（单实例内存足够，多实例需换 Redis） */
    private static final Map<String, Deque<Long>> ATTEMPTS = new ConcurrentHashMap<>();
    private static final long WINDOW_MS = 60_000;

    @Value("${app.auth.login-limit-per-minute:5}")
    private int limitPerMinute;

    public record LoginRequest(String username, String password) {
    }

    @PostMapping("/login")
    public ApiResult<Map<String, Object>> login(@RequestBody LoginRequest request, HttpServletRequest http) {
        if (request == null || request.username() == null || request.password() == null) {
            throw new IllegalArgumentException("用户名与口令不能为空");
        }
        String ip = clientIp(http);
        enforceRateLimit(ip);

        return authService.login(request.username(), request.password())
                .map(session -> ApiResult.ok(Map.<String, Object>of(
                        "token", session.token(),
                        "username", session.username(),
                        "expiresAt", session.expiresAt())))
                .orElseThrow(() -> new com.poiintel.common.UnauthorizedException("用户名或口令错误"));
    }

    /**
     * 简单的滑窗限流：同一 IP 每分钟最多 N 次登录尝试。
     * 运营口令只有几十位熵，不限制的话可以被在线爆破。
     */
    private void enforceRateLimit(String ip) {
        long now = System.currentTimeMillis();
        Deque<Long> window = ATTEMPTS.computeIfAbsent(ip, key -> new ArrayDeque<>());
        synchronized (window) {
            while (!window.isEmpty() && now - window.peekFirst() > WINDOW_MS) {
                window.pollFirst();
            }
            if (window.size() >= limitPerMinute) {
                throw new RateLimitException("登录尝试过于频繁，请稍后再试");
            }
            window.addLast(now);
        }
    }

    /**
     * 取真实客户端 IP。
     * 只信 X-Forwarded-For 的**最后一段**（最近代理追加的那段）；
     * 第一段可以随意伪造，用它做限流等于没限流。
     */
    private String clientIp(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            String[] parts = forwarded.split(",");
            String last = parts[parts.length - 1].trim();
            if (!last.isEmpty()) {
                return last;
            }
        }
        return request.getRemoteAddr() == null ? "unknown" : request.getRemoteAddr();
    }
}
