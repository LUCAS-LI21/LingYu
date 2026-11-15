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

    /** 审核人必须来自 token 主体，不能信请求体（否则可伪造审核记录） */
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

        // 「新增点位」类反馈：审核通过后自动围绕锚点建一个定向抓取任务（闭环 B）
        if ("need_refetch".equals(result.get("status"))) {
            // 1) 先落到待定位暂存表：OSM 里没有的网点只靠重抓是补不回来的，
            //    落库后后台「待定位」里能看到，可人工补坐标/信息再转正。
            try {
                Map<String, Object> fb = pendingBankService.feedbackOf(code);
                if (fb != null) {
                    pendingBankService.importRows(new PendingBankService.Request(
                            "用户反馈（新增点位）",
                            "feedback:" + code,
                            List.of(new PendingBankService.Row(
                                    String.valueOf(fb.get("name")),
                                    fb.get("address") == null ? "" : String.valueOf(fb.get("address")),
                                    "", "", ""))));
                    result.put("pendingStaged", true);
                }
            } catch (Exception ex) {
                result.put("pendingError", ex.getMessage());
            }

            // 2) 再围绕锚点重抓一次，补 OSM 里可能存在的邻居点位
            if (result.get("anchorLng") != null) {
                double lng = ((Number) result.get("anchorLng")).doubleValue();
                double lat = ((Number) result.get("anchorLat")).doubleValue();
                double span = 0.012; // 约 1.3km
                try {
                    long jobId = ingestService.createJob("feedback", lat - span, lng - span, lat + span, lng + span);
                    ingestService.runJob(jobId, lat - span, lng - span, lat + span, lng + span);
                    result.put("jobId", jobId);
                } catch (IllegalStateException busy) {
                    // 抓取任务被占用不算失败：点位已进暂存表，可稍后重试审核
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

    /** 关闭是单向操作，这里提供恢复入口（评审 P1-10） */
    @PostMapping("/pois/{id}/reopen")
    public ApiResult<Map<String, Object>> reopen(
            @PathVariable String id,
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        return ApiResult.ok(adminService.reopen(id, reviewerOf(authorization)));
    }

    /**
     * 导入政府开放数据（L1）：官方数据集人工下载后，按列映射成 JSON 行提交。
     * 与抓取不同，这里的数据来自官方发布的文件，来源可追溯、允许入库。
     */
    @PostMapping("/import")
    public ApiResult<Map<String, Object>> importPois(@RequestBody ImportService.Request request) {
        return ApiResult.ok(importService.importRows(request));
    }

    /**
     * 导入「有名称地址但无坐标」的网点到暂存表（如兴业银行）。
     * 没有坐标就不写 poi_bank，避免编造位置。
     */
    @PostMapping("/pending/import")
    public ApiResult<Map<String, Object>> importPending(@RequestBody PendingBankService.Request request) {
        return ApiResult.ok(pendingBankService.importRows(request));
    }

    @GetMapping("/pending")
    public ApiResult<List<Map<String, Object>>> pending(
            @RequestParam(required = false) String status,
            @RequestParam(defaultValue = "50") int limit) {
        return ApiResult.ok(pendingBankService.list(status, limit));
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

    /** 管理员直接标注坐标：立即转正成 poi_community（用户提交则走下面的审核队列） */
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
