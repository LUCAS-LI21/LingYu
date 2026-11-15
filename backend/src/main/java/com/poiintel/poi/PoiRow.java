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
    /** GCJ-02 坐标：高德/腾讯等国内地图用，前端导航跳转直接取这两个值（WGS-84 直接喂给高德会偏 500 米） */
    private Double gcjLng;
    private Double gcjLat;
    private String brand;
    private String branchType;
    private String phone;
    private String openingHours;
    private Integer builtYear;
    private Integer avgPrice;
    private BigDecimal propertyFee;
    /** 物业公司（政府物业项目库） */
    private String propertyCompany;
    /** 节水型小区获评年度（政府数据集），null 表示未获评或未匹配 */
    private Integer waterSavingYear;
    /** 政府租赁参考价（元/㎡·月）：多层 / 高层 / 低密度，null 表示未匹配上 */
    private BigDecimal rentDc;
    private BigDecimal rentGc;
    private BigDecimal rentDmd;
    /** 周边配套：1km 内银行网点数 / ATM 数 / 品牌数，以及最近银行距离（米） */
    private Integer surroundBankCount;
    private Integer surroundAtmCount;
    private Integer nearbyBrandCount;
    private Integer nearestBankM;
    private Boolean demoAttributes;
    private String source;
    private String license;
    private String sourceLevel;
}
