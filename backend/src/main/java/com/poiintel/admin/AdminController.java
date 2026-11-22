package com.poiintel.admin;

import java.util.List;
import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.poiintel.auth.AuthService;
import com.poiintel.common.ApiResult;

import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api/v1/admin")
@RequiredArgsConstructor
public class AdminController {

    private final AdminService adminService;
    private final IngestService ingestService;
    private final ImportService importService;
    private final PendingBankService pendingBankService;
    private final com.poiintel.poi.CommunityLocateService communityLocateService;
    private final AuthService authService;

    /** 审核人取自 token 主体，不信任请求体 */
    private String reviewerOf(String authorization) {
        if (authorization != null && authorization.startsWith("Bearer ")) {
            return authService.verify(authorization.substring(7)).orElse("unknown");
        }
        return "unknown";
    }

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
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        Map<String, Object> result = adminService.approve(code, reviewerOf(authorization));

        // 「新增点位」审核通过后：先入待定位暂存表，再围绕锚点重抓
        if ("need_refetch".equals(result.get("status"))) {
            try {
                Map<String, Object> fb = pendingBankService.feedbackOf(code);
                if (fb != null) {
                    // 按点位类型分流到 bank_pending / community_pending
                    String poiType = String.valueOf(fb.get("poiType"));
                    String name = String.valueOf(fb.get("name"));
                    String address = fb.get("address") == null ? "" : String.valueOf(fb.get("address"));
                    if ("community".equals(poiType)) {
                        communityLocateService.stagePending(name, pendingBankService.addressOf(code), "用户反馈（新增小区）", code);
                    } else {
                        pendingBankService.importRows(new PendingBankService.Request(
                                "用户反馈（新增点位）",
                                "feedback:" + code,
                                List.of(new PendingBankService.Row(name, address, "", "", ""))));
                    }
                    result.put("pendingStaged", true);
                    result.put("pendingKind", poiType);
                }
            } catch (Exception ex) {
                result.put("pendingError", ex.getMessage());
            }

            // 围绕锚点重抓，补齐 OSM 邻居点位
            if (result.get("anchorLng") != null) {
                double lng = ((Number) result.get("anchorLng")).doubleValue();
                double lat = ((Number) result.get("anchorLat")).doubleValue();
                double span = 0.012; // 0.012° ≈ 1.3km
                try {
                    long jobId = ingestService.createJob("feedback", lat - span, lng - span, lat + span, lng + span, code);
                    ingestService.runJob(jobId, lat - span, lng - span, lat + span, lng + span);
                    result.put("jobId", jobId);
                } catch (IllegalStateException busy) {
                    // 任务被占用不算失败：点位已入暂存表，可稍后重试
                    result.put("jobError", busy.getMessage());
                }
            }
        }
        return ApiResult.ok(result);
    }

    @PostMapping("/feedback/{code}/reject")
    public ApiResult<Map<String, Object>> reject(
            @PathVariable String code,
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @RequestBody(required = false) Map<String, String> body) {
        String note = body == null ? "" : body.getOrDefault("note", "");
        return ApiResult.ok(adminService.reject(code, reviewerOf(authorization), note));
    }

    /** 关闭为单向操作，提供恢复入口 */
    @PostMapping("/pois/{id}/reopen")
    public ApiResult<Map<String, Object>> reopen(
            @PathVariable String id,
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        return ApiResult.ok(adminService.reopen(id, reviewerOf(authorization)));
    }

    /** 导入政府开放数据（L1）：官方文件按列映射后提交，来源可追溯。 */
    @PostMapping("/import")
    public ApiResult<Map<String, Object>> importPois(@RequestBody ImportService.Request request) {
        return ApiResult.ok(importService.importRows(request));
    }

    /** 导入无坐标网点到暂存表；无坐标不写 poi_bank。 */
    @PostMapping("/pending/import")
    public ApiResult<Map<String, Object>> importPending(@RequestBody PendingBankService.Request request) {
        return ApiResult.ok(pendingBankService.importRows(request));
    }

    @GetMapping("/pending")
    public ApiResult<Map<String, Object>> pending(
            @RequestParam(required = false) String status,
            @RequestParam(defaultValue = "50") int limit) {
        // 列表统一返回 {items,total,limit}
        List<Map<String, Object>> items = pendingBankService.list(status, limit);
        Map<String, Object> page = new java.util.LinkedHashMap<>();
        page.put("items", items);
        page.put("total", items.size());
        page.put("limit", limit);
        return ApiResult.ok(page);
    }

    /** 驳回待定位小区 */
    @PostMapping("/community-pending/{id}/reject")
    public ApiResult<Map<String, Object>> rejectCommunityPending(
            @PathVariable String id,
            @RequestBody(required = false) Map<String, Object> body,
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        String reason = body == null || body.get("reason") == null ? "" : String.valueOf(body.get("reason"));
        return ApiResult.ok(communityLocateService.rejectPending(id, reviewerOf(authorization), reason));
    }

    /** 人工确认坐标后转正 */
    @PostMapping("/pending/{id}/promote")
    public ApiResult<Map<String, Object>> promote(
            @PathVariable long id,
            @RequestParam double lng,
            @RequestParam double lat,
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        return ApiResult.ok(pendingBankService.promote(id, lng, lat, reviewerOf(authorization)));
    }

    // ---------- 待定位小区：众包坐标 ----------

    /** 管理员标注坐标：直接转正；用户提交走审核队列。 */
    @PostMapping("/community-pending/{id}/locate")
    public ApiResult<Map<String, Object>> locateCommunity(
            @PathVariable String id,
            @RequestBody Map<String, Object> body,
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        double lng = Double.parseDouble(String.valueOf(body.get("lng")));
        double lat = Double.parseDouble(String.valueOf(body.get("lat")));
        String note = body.get("note") == null ? "" : String.valueOf(body.get("note"));
        return ApiResult.ok(communityLocateService.submit(id, lng, lat, "admin",
                reviewerOf(authorization), note));
    }

    /** 用户提交的坐标（默认只看待审） */
    @GetMapping("/coordinate-submissions")
    public ApiResult<List<Map<String, Object>>> coordinateSubmissions(
            @RequestParam(required = false, defaultValue = "pending") String status,
            @RequestParam(defaultValue = "50") int limit) {
        return ApiResult.ok(communityLocateService.submissions(status, limit));
    }

    @PostMapping("/coordinate-submissions/{id}/approve")
    public ApiResult<Map<String, Object>> approveCoordinate(
            @PathVariable long id,
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        return ApiResult.ok(communityLocateService.approve(id, reviewerOf(authorization)));
    }

    @PostMapping("/coordinate-submissions/{id}/reject")
    public ApiResult<Map<String, Object>> rejectCoordinate(
            @PathVariable long id,
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        return ApiResult.ok(communityLocateService.reject(id, reviewerOf(authorization)));
    }

    @GetMapping("/jobs")
    public ApiResult<Map<String, Object>> jobs(
            @RequestParam(required = false, defaultValue = "1") int page,
            @RequestParam(required = false, defaultValue = "20") int size) {
        return ApiResult.ok(adminService.jobs(page, Math.min(Math.max(size, 1), 100)));
    }

    /** 手动触发 OSM 采集：默认福田中心区范围。 */
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
