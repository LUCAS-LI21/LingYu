package com.poiintel.auth;

import java.io.IOException;

import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;

/**
 * 运营接口鉴权。
 *
 * 用拦截器而不是 Filter：Filter 拿到的 getRequestURI 是未解码的原始串，
 * `/api/v1/%61dmin/**` 这种编码路径能绕过 startsWith 前缀判断；拦截器由 Spring
 * 在解析后的处理器映射上匹配，路径已经是解码+规范化之后的。
 */
@Component
@RequiredArgsConstructor
public class AdminAuthInterceptor implements HandlerInterceptor {

    private final AuthService authService;

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler)
            throws IOException {
        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
            return true;
        }
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")
                && authService.verify(header.substring(7)).isPresent()) {
            return true;
        }
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType("application/json;charset=UTF-8");
        response.getWriter().write("{\"code\":401,\"message\":\"未登录或登录已过期\",\"data\":null}");
        return false;
    }
}
