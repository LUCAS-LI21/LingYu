package com.poiintel.poi;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

/**
 * 统计接口的聚合口径：银行/小区计数、区域维度、品牌 Top N 都要能对上。
 *
 * <p>用 mock mapper 隔离数据库，只验证 PoiService 的聚合与字段映射逻辑。
 */
@ExtendWith(MockitoExtension.class)
class PoiServiceStatsTest {

    @Mock
    private PoiMapper poiMapper;

    private PoiService poiService;

    @BeforeEach
    void setUp() {
        poiService = new PoiService(poiMapper);
    }

    @Test
    @DisplayName("银行/ATM/小区分别计数，total 不含 ATM 重复")
    void aggregatesCounts() {
        when(poiMapper.countsByType()).thenReturn(List.of(
                Map.of("type", "bank", "branchType", "branch", "cnt", 1536),
                Map.of("type", "bank", "branchType", "atm", "cnt", 45),
                Map.of("type", "community", "branchType", "", "cnt", 3601)));
        when(poiMapper.districtCount()).thenReturn(10);
        when(poiMapper.topBrands(8)).thenReturn(List.of());
        when(poiMapper.countsByDistrict()).thenReturn(List.of());
        when(poiMapper.priceBuckets()).thenReturn(List.of());
        when(poiMapper.gridTop(6)).thenReturn(List.of());

        Map<String, Object> stats = poiService.stats();

        assertEquals(1581, stats.get("bank"));
        assertEquals(45, stats.get("atm"));
        assertEquals(1536, stats.get("branch"));
        assertEquals(3601, stats.get("community"));
        assertEquals(5182, stats.get("total"));
        assertEquals(10, stats.get("districts"));
    }

    @Test
    @DisplayName("区域维度原样透出，供前端画图")
    void exposesDistrictBreakdown() {
        when(poiMapper.countsByType()).thenReturn(List.of());
        when(poiMapper.topBrands(8)).thenReturn(List.of());
        when(poiMapper.countsByDistrict()).thenReturn(List.of(
                Map.of("label", "福田区", "bank", 360, "community", 754),
                Map.of("label", "南山区", "bank", 323, "community", 691)));
        when(poiMapper.priceBuckets()).thenReturn(List.of());
        when(poiMapper.gridTop(6)).thenReturn(List.of());

        Map<String, Object> stats = poiService.stats();

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> byDistrict = (List<Map<String, Object>>) stats.get("byDistrict");
        assertEquals(2, byDistrict.size());
        assertEquals("福田区", byDistrict.get(0).get("label"));
        assertEquals(360, byDistrict.get(0).get("bank"));
    }

    @Test
    @DisplayName("列表分页：offset 换算页码，total=0 时不查明细")
    void listPagination() {
        PoiQuery query = new PoiQuery();
        query.setSize(20);
        query.setOffset(40);
        when(poiMapper.count(query)).thenReturn(0L);

        PoiService.PageResult result = poiService.list(query);

        assertEquals(3, result.page());
        assertTrue(result.items().isEmpty());
    }
}
