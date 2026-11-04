package com.poiintel.poi;

import java.math.BigDecimal;

import lombok.Data;

/**
 * v_poi 视图的行对象：银行与小区共用一个出参结构，前端无需区分两个接口。
 */
@Data
public class PoiRow {
    private String id;
    private String type;
    private String name;
    private String address;
    private String district;
    private Double lng;
    private Double lat;
    private String brand;
    private String branchType;
    private String phone;
    private String openingHours;
    private Integer builtYear;
    private Integer avgPrice;
    private BigDecimal propertyFee;
    private Boolean demoAttributes;
    private String source;
    private String license;
    private String sourceLevel;
}
