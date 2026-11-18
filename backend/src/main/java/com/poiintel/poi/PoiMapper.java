package com.poiintel.poi;

import java.util.List;
import java.util.Map;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface PoiMapper {

    List<PoiRow> query(PoiQuery query);

    long count(PoiQuery query);

    PoiRow findById(@Param("id") String id);

    List<PoiRow> nearby(@Param("lng") double lng,
                        @Param("lat") double lat,
                        @Param("radius") double radius,
                        @Param("branchType") String branchType,
                        @Param("limit") int limit);

    List<Map<String, Object>> countsByType();

    int districtCount();

    List<Map<String, Object>> topBrands(@Param("limit") int limit);

    List<Map<String, Object>> priceBuckets();

    /** 小区总数与其中「有官方参考价」的数量，用于在洞察页标注样本口径 */
    Map<String, Object> priceSampleCount();

    List<Map<String, Object>> gridTop(@Param("limit") int limit);

    /** 区域维度：每个区的银行数与小区数，供洞察页画图 */
    List<Map<String, Object>> countsByDistrict();

    /** 反向关联：某个银行网点周边的住宅小区（赛题三.3） */
    List<PoiRow> nearbyCommunities(@Param("lng") double lng,
                                   @Param("lat") double lat,
                                   @Param("radius") double radius,
                                   @Param("limit") int limit);
}
