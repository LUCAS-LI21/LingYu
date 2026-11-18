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
        if (header == null || !header.startsWith("Bearer ")) {
            return reject(response, HttpServletResponse.SC_UNAUTHORIZED, 401, "未登录或登录已过期");
        }
        var username = authService.verify(header.substring(7));
        if (username.isEmpty()) {
            return reject(response, HttpServletResponse.SC_UNAUTHORIZED, 401, "未登录或登录已过期");
        }
        // 只验 token 不验角色等于"任何登录用户都是管理员"；这里补上角色校验
        String role = authService.roleOf(username.get()).orElse("");
        if (!"operator".equals(role) && !"admin".equals(role)) {
            return reject(response, HttpServletResponse.SC_FORBIDDEN, 403, "无运营权限");
        }
        return true;
    }

    private boolean reject(HttpServletResponse response, int status, int code, String message)
            throws IOException {
        response.setStatus(status);
        response.setContentType("application/json;charset=UTF-8");
        response.getWriter().write("{\"code\":" + code + ",\"message\":\"" + message + "\",\"data\":null}");
        return false;
    }
}
