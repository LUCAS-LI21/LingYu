package com.poiintel.common;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import com.poiintel.auth.AdminAuthInterceptor;

import lombok.RequiredArgsConstructor;

@Configuration
@RequiredArgsConstructor
public class WebConfig implements WebMvcConfigurer {

    private final AdminAuthInterceptor adminAuthInterceptor;

    /**
     * 允许的跨域来源。默认只放开发环境 5173；生产走 Nginx 同源反代（nginx 会剥掉 Origin）。
     *
     * 覆盖方式二选一：`CORS_ORIGINS=http://a,http://b`（环境变量，与部署文档一致）
     * 或 `APP_CORS_ORIGINS`（Spring 宽松绑定）。两层占位符保证环境变量真的生效——
     * 之前只写 app.cors.origins，导致文档里的 CORS_ORIGINS 静默无效。
     */
    @Value("${app.cors.origins:${CORS_ORIGINS:http://127.0.0.1:5173,http://localhost:5173}}")
    private String allowedOrigins;

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOrigins(allowedOrigins.split(","))
                .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
                .allowedHeaders("*")
                .maxAge(3600);
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(adminAuthInterceptor).addPathPatterns("/api/v1/admin/**");
    }
}
