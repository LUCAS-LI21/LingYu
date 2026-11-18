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
 * 给每个请求分配 request-id，写入响应头与日志 MDC。
 *
 * 为什么需要：评审指出"出问题只能翻容器日志，无法把一次前端报错对应到后端日志"。
 * 有了 X-Request-Id，前端报错时带上这个 id，后端用 grep 就能定位整条链路。
 *
 * 规则：优先复用上游（nginx / 调用方）传的 X-Request-Id，没有就生成 12 位短 id。
 * 日志格式在 application.yml 的 logging.pattern 里用 %X{requestId} 输出。
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
            // 只记慢请求与错误，避免日志被 5MB 全量查询刷屏
            if (costMs >= 300 || response.getStatus() >= 400) {
                log.info("{} {} -> {} {}ms", request.getMethod(), request.getRequestURI(),
                        response.getStatus(), costMs);
            }
            MDC.remove(MDC_KEY);
        }
    }
}
