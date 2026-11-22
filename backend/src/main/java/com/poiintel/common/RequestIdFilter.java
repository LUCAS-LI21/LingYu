package com.poiintel.common;

import java.io.IOException;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * 为每个请求分配 requestId，写入响应头 X-Request-Id 与日志 MDC。
 * 优先复用上游传入值，否则生成 12 位短 id。
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestIdFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(RequestIdFilter.class);

    public static final String HEADER = "X-Request-Id";
    public static final String MDC_KEY = "requestId";

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String incoming = request.getHeader(HEADER);
        String requestId = (incoming == null || incoming.isBlank())
                ? UUID.randomUUID().toString().replace("-", "").substring(0, 12)
                : incoming.trim();

        MDC.put(MDC_KEY, requestId);
        response.setHeader(HEADER, requestId);
        long started = System.nanoTime();
        try {
            chain.doFilter(request, response);
        } finally {
            long costMs = (System.nanoTime() - started) / 1_000_000;
            // 仅记录慢请求与错误响应
            if (costMs >= 300 || response.getStatus() >= 400) {
                log.info("{} {} -> {} {}ms", request.getMethod(), request.getRequestURI(),
                        response.getStatus(), costMs);
            }
            MDC.remove(MDC_KEY);
        }
    }
}
