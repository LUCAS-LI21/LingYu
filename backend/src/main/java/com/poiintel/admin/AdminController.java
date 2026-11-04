package com.poiintel.admin;

import java.util.List;
import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.poiintel.common.ApiResult;

import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api/v1/admin")
@RequiredArgsConstructor
public class AdminController {

    private final AdminService adminService;
    private final IngestService ingestService;

    @GetMapping("/overview")
    public ApiResult<Map<String, Object>> overview() {
        return ApiResult.ok(adminService.overview());
    }

    @GetMapping("/feedback")
    public ApiResult<Map<String, Object>> feedback(
            @RequestParam(required = false, defaultValue = "pending") String status,
            @RequestParam(required = false, defaultValue = "1") int page,
            @RequestParam(required = false, defaultValue = "20") int size) {
        return ApiResult.ok(adminService.feedbackPage(status, page, Math.min(Math.max(size, 1), 100)));
    }

    @PostMapping("/feedback/{code}/approve")
    public ApiResult<Map<String, Object>> approve(
            @PathVariable String code,
            @RequestBody(required = false) Map<String, String> body) {
        String reviewer = body == null ? "operator" : body.getOrDefault("reviewer", "operator");
        return ApiResult.ok(adminService.approve(code, reviewer));
    }

    @PostMapping("/feedback/{code}/reject")
    public ApiResult<Map<String, Object>> reject(
            @PathVariable String code,
            @RequestBody(required = false) Map<String, String> body) {
        String reviewer = body == null ? "operator" : body.getOrDefault("reviewer", "operator");
        String note = body == null ? "" : body.getOrDefault("note", "");
        return ApiResult.ok(adminService.reject(code, reviewer, note));
    }

    @GetMapping("/jobs")
    public ApiResult<Map<String, Object>> jobs(
            @RequestParam(required = false, defaultValue = "1") int page,
            @RequestParam(required = false, defaultValue = "20") int size) {
        return ApiResult.ok(adminService.jobs(page, Math.min(Math.max(size, 1), 100)));
    }

    /** 手动触发一次 OSM 采集：默认取福田中心区，避免一次拉全城拖垮公共实例 */
    @PostMapping("/jobs")
    public ApiResult<Map<String, Object>> createJob(@RequestBody(required = false) Map<String, Object> body) {
        double south = number(body, "south", 22.520);
        double west = number(body, "west", 114.030);
        double north = number(body, "north", 22.560);
        double east = number(body, "east", 114.090);
        String trigger = body == null ? "manual" : String.valueOf(body.getOrDefault("trigger", "manual"));

        long jobId = ingestService.createJob(trigger, south, west, north, east);
        ingestService.runJob(jobId, south, west, north, east);

        return ApiResult.ok(Map.of("jobId", jobId, "status", "pending"));
    }

    @GetMapping("/hotspots")
    public ApiResult<List<Map<String, Object>>> hotspots() {
        return ApiResult.ok(adminService.hotspots());
    }

    @PostMapping("/hotspots/recompute")
    public ApiResult<Map<String, Object>> recompute() {
        return ApiResult.ok(adminService.recomputeHotspots());
    }

    private double number(Map<String, Object> body, String key, double fallback) {
        if (body == null || body.get(key) == null) {
            return fallback;
        }
        Object value = body.get(key);
        return value instanceof Number n ? n.doubleValue() : Double.parseDouble(String.valueOf(value));
    }
}
