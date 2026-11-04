package com.poiintel.auth;

import java.util.Map;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.poiintel.common.ApiResult;

import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api/v1/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;

    public record LoginRequest(String username, String password) {
    }

    @PostMapping("/login")
    public ApiResult<Map<String, Object>> login(@RequestBody LoginRequest request) {
        if (request == null || request.username() == null || request.password() == null) {
            throw new IllegalArgumentException("用户名与口令不能为空");
        }
        return authService.login(request.username(), request.password())
                .map(session -> ApiResult.ok(Map.<String, Object>of(
                        "token", session.token(),
                        "username", session.username(),
                        "expiresAt", session.expiresAt())))
                .orElseThrow(() -> new IllegalArgumentException("用户名或口令错误"));
    }
}
