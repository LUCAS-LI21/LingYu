package com.poiintel.poi;

import java.util.List;

import lombok.Data;

@Data
public class PoiQuery {
    private List<String> types;
    private String keyword;
    private String district;
    private String branchType = "all";
    private Integer minPrice;
    private Integer maxPrice;
    private Integer minYear;
    private Integer maxYear;
    private Double west;
    private Double south;
    private Double east;
    private Double north;
    private String sort = "default";
    private int offset = 0;
    private int size = 20;
    private int limit = 50;
    /** 精简投影：地图/列表批量拉取只要核心字段，详情才用全量 */
    private boolean lite;
}
