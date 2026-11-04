package com.poiintel.feedback;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record FeedbackRequest(
        @NotBlank(message = "不能为空") String poiType,
        @NotBlank(message = "不能为空") String poiId,
        String poiName,
        @NotBlank(message = "不能为空") String type,
        String field,
        String newValue,
        @NotBlank(message = "不能为空") @Size(max = 1000, message = "最多 1000 字") String description,
        String contact) {
}
