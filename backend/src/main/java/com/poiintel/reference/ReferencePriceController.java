package com.poiintel.reference;

import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.poiintel.common.ApiResult;

import lombok.RequiredArgsConstructor;

/** 二手房参考价（L1 展示层，不绑定 POI）；数据来自深圳市政府数据开放平台，须注明来源。 */
@RestController
@RequestMapping("/api/v1/reference-price")
@RequiredArgsConstructor
public class ReferencePriceController {

    private final ReferencePriceService service;

    /** 分区行情概览：条数、中位数、最低、最高 */
    @GetMapping
    public ApiResult<Map<String, Object>> overview() {
        return ApiResult.ok(service.overview());
    }

    /** 明细列表，支持按区筛选与分页 */
    @GetMapping("/items")
    public ApiResult<Map<String, Object>> items(
            @RequestParam(required = false) String district,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int size) {
        return ApiResult.ok(service.page(district, Math.max(page, 1), Math.min(Math.max(size, 1), 100)));
    }
}
