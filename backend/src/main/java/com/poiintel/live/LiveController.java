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

    /** 实时地址（L2）：即取即显不落库，响应头 no-store。 */
    @GetMapping("/address")
    public ResponseEntity<ApiResult<Map<String, Object>>> address(
            @RequestParam double lng,
            @RequestParam double lat) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(ApiResult.ok(liveService.reverseGeocode(lng, lat)));
    }

    /** 实时周边 POI（L2）：本地缺数据时临时补齐，不落库。 */
    @GetMapping("/pois")
    public ResponseEntity<ApiResult<Map<String, Object>>> around(
            @RequestParam double lng,
            @RequestParam double lat,
            @RequestParam(defaultValue = "1000") int radius,
            @RequestParam(required = false) String keywords) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(ApiResult.ok(liveService.searchAround(lng, lat, radius, keywords)));
    }

    /** 实时周边配套（L2）：学校/医院/地铁/商场按类型归组，不落库。 */
    @GetMapping("/facilities")
    public ResponseEntity<ApiResult<Map<String, Object>>> facilities(
            @RequestParam double lng,
            @RequestParam double lat,
            @RequestParam(defaultValue = "1000") int radius) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(ApiResult.ok(liveService.facilities(lng, lat, radius)));
    }
}
