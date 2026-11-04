package com.poiintel.feedback;

import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.poiintel.common.ApiResult;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api/v1/feedback")
@RequiredArgsConstructor
public class FeedbackController {

    private final FeedbackService feedbackService;

    @PostMapping
    public ApiResult<Map<String, Object>> submit(@Valid @RequestBody FeedbackRequest request) {
        return ApiResult.ok(feedbackService.submit(request));
    }

    @GetMapping("/{code}")
    public ApiResult<Map<String, Object>> detail(@PathVariable String code) {
        return ApiResult.ok(feedbackService.findByCode(code));
    }
}
