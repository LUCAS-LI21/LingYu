package com.poiintel.auth;

import java.io.IOException;

import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;

/** 运营接口鉴权。使用拦截器而非 Filter：Filter 的 URI 未解码，编码路径可绕过前缀判断。 */
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
        // 校验角色，避免任意登录用户获得管理权限
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
