package com.poiintel.feedback;

import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.poiintel.common.AnonymousRateLimiter;
import com.poiintel.common.ApiResult;
import com.poiintel.common.NotFoundException;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api/v1/feedback")
@RequiredArgsConstructor
public class FeedbackController {

    private final FeedbackService feedbackService;
    private final AnonymousRateLimiter rateLimiter;

    @PostMapping
    public ApiResult<Map<String, Object>> submit(@Valid @RequestBody FeedbackRequest request,
                                                 HttpServletRequest http) {
        // 匿名可写：按 IP 限流，避免单人刷库（评审指出原先零限流）
        rateLimiter.checkFeedback(clientIp(http));
        return ApiResult.ok(feedbackService.submit(request));
    }

    /**
     * 用户查询自己的反馈进展（凭受理编号）。
     * 之前只有运营后台能看到状态，用户提交完就是黑盒——闭环缺了"状态回流"这一环。
     */
    @GetMapping("/{code}")
    public ApiResult<Map<String, Object>> status(@PathVariable String code) {
        Map<String, Object> row = feedbackService.findByCode(code);
        if (row == null) {
            throw new NotFoundException("反馈不存在：" + code);
        }
        return ApiResult.ok(row);
    }

    private String clientIp(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            String[] parts = forwarded.split(",");
            String last = parts[parts.length - 1].trim();
            if (!last.isEmpty()) {
                return last;
            }
        }
        return request.getRemoteAddr() == null ? "unknown" : request.getRemoteAddr();
    }
}
