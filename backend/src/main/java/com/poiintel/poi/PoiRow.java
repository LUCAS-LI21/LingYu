package com.poiintel.poi;

import java.math.BigDecimal;

import com.fasterxml.jackson.annotation.JsonInclude;

import lombok.Data;

/**
 * v_poi 视图的行对象：银行与小区共用一个出参结构，前端无需区分两个接口。
 *
 * {@code NON_NULL}：列表一次可能返回 5000 行，每行 28 个字段里有一半是另一类型不用的 null，
 * 全量序列化约 3.6MB。省略 null 后体积约减半（前端本来就用 ?? 兜底，undefined 等价于 null）。
 */
@Data
@JsonInclude(JsonInclude.Include.NON_NULL)
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
    /** 服务类型：对公/对私/自助（来自官网文本，缺证据为空） */
    private String serviceTypes;
    private Integer builtYear;
    private Integer avgPrice;
    /** demo=演示值 / gov_reference=政府成交参考价 */
    private String avgPriceSource;
    /** 演示均价：仅用于展示并标注「演示」，不参与价格筛选/排序/统计 */
    private Integer avgPriceDemo;
    private BigDecimal propertyFee;
    /** 物业公司（政府物业项目库） */
    private String propertyCompany;
    /** 节水型小区获评年度（政府数据集），null 表示未获评或未匹配 */
    private Integer waterSavingYear;
    /** 政府租赁参考价（元/㎡·月）：多层 / 高层 / 低密度，null 表示未匹配上 */
    private BigDecimal rentDc;
    private BigDecimal rentGc;
    private BigDecimal rentDmd;
    /** 建设单位/开发商（竣工验收备案） */
    private String developer;
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
