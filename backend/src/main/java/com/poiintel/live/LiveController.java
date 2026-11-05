package com.poiintel.live;

import java.util.Map;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.poiintel.common.ApiResult;

import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api/v1/live")
@RequiredArgsConstructor
public class LiveController {

    private final LiveService liveService;

    /** 实时地址（L2）：即取即显，绝不落库；响应头显式 no-store，浏览器也不缓存 */
    @GetMapping("/address")
    public ResponseEntity<ApiResult<Map<String, Object>>> address(
            @RequestParam double lng,
            @RequestParam double lat) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(ApiResult.ok(liveService.reverseGeocode(lng, lat)));
    }
}
