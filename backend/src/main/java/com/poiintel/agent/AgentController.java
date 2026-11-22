package com.poiintel.agent;

import java.util.List;
import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.poiintel.auth.AuthService;
import com.poiintel.common.ApiResult;

import lombok.RequiredArgsConstructor;

/** 数据接入 Agent 接口（仅管理员）：propose 只出建议，apply 才写库。 */
@RestController
@RequestMapping("/api/v1/admin/agent")
@RequiredArgsConstructor
public class AgentController {

    private final AgentService agentService;
    private final DeepSeekClient deepSeekClient;
    private final AuthService authService;

    private String reviewerOf(String authorization) {
        if (authorization != null && authorization.startsWith("Bearer ")) {
            return authService.verify(authorization.substring(7)).orElse("unknown");
        }
        return "unknown";
    }

    @GetMapping("/status")
    public ApiResult<Map<String, Object>> status() {
        return ApiResult.ok(deepSeekClient.status());
    }

    /** 数据质量巡检：楼栋编号、纯数字、过短名称（规则版）。 */
    @GetMapping("/quality")
    public ApiResult<Map<String, Object>> quality() {
        return ApiResult.ok(agentService.quality());
    }

    @PostMapping("/propose")
    public ApiResult<Map<String, Object>> propose(
            @RequestParam String entityType,
            @RequestParam String entityId,
            @RequestParam String field) {
        return ApiResult.ok(agentService.propose(entityType, entityId, field));
    }

    @PostMapping("/{runId}/apply")
    public ApiResult<Map<String, Object>> apply(
            @PathVariable long runId,
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        return ApiResult.ok(agentService.apply(runId, reviewerOf(authorization)));
    }

    @GetMapping("/runs")
    public ApiResult<List<Map<String, Object>>> runs(@RequestParam(defaultValue = "20") int limit) {
        return ApiResult.ok(agentService.recentRuns(Math.min(Math.max(limit, 1), 100)));
    }

    /** 批量补全：一次最多 20 条，只出建议不写库 */
    @PostMapping("/batch")
    public ApiResult<Map<String, Object>> batch(
            @RequestParam(defaultValue = "bank") String entityType,
            @RequestParam(defaultValue = "address") String field,
            @RequestParam(defaultValue = "10") int limit,
            @RequestParam(defaultValue = "false") boolean branchOnly) {
        return ApiResult.ok(agentService.batch(entityType, field, limit, branchOnly));
    }
}
