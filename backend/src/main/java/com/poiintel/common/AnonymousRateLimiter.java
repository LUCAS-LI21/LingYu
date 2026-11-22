package com.poiintel.common;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 匿名写接口限流（单实例内存窗口）：按 IP + 场景做分钟级窗口，超限抛 RateLimitException（429）。
 * 多实例部署需换 Redis 计数器。
 */
@Component
public class AnonymousRateLimiter {

    private static final long WINDOW_MS = 60_000;

    private final Map<String, Deque<Long>> windows = new ConcurrentHashMap<>();

    @Value("${app.rate-limit.feedback-per-minute:10}")
    private int feedbackPerMinute;

    @Value("${app.rate-limit.locate-per-minute:20}")
    private int locatePerMinute;

    public void checkFeedback(String ip) {
        check("feedback:" + ip, feedbackPerMinute, "提交过于频繁，请稍后再试");
    }

    public void checkLocate(String ip) {
        check("locate:" + ip, locatePerMinute, "提交坐标过于频繁，请稍后再试");
    }

    private void check(String key, int limit, String message) {
        long now = System.currentTimeMillis();
        Deque<Long> window = windows.computeIfAbsent(key, k -> new ArrayDeque<>());
        synchronized (window) {
            while (!window.isEmpty() && now - window.peekFirst() > WINDOW_MS) {
                window.pollFirst();
            }
            if (window.size() >= limit) {
                throw new RateLimitException(message);
            }
            window.addLast(now);
        }
    }
}
