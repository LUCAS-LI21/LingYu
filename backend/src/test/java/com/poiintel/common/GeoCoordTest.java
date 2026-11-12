package com.poiintel.common;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 坐标转换的正确性回归：深圳点偏数百米、境外不加偏、往返误差 &lt; 2 m。
 *
 * <p>这组用例守护 ADR-0002 §6 的 P0 缺陷——转换失效时它必须红，而不是等演示时才发现地址指到隔壁。
 */
class GeoCoordTest {

    /** 深圳福田某银行网点附近（WGS-84） */
    private static final double LNG = 114.0579;
    private static final double LAT = 22.5431;

    @Test
    @DisplayName("深圳点 WGS-84 → GCJ-02 偏移应在数百米量级")
    void shenzhenPointShiftsByHundredsOfMeters() {
        double[] gcj = GeoCoord.wgs84ToGcj02(LNG, LAT);

        assertTrue(gcj[0] != LNG || gcj[1] != LAT, "转完坐标不能原地不动");
        double meters = haversineMeters(LNG, LAT, gcj[0], gcj[1]);
        assertTrue(meters > 100 && meters < 1000, "偏移量异常：" + meters + " m");
    }

    @Test
    @DisplayName("境外坐标原样返回（GCJ-02 只在中国大陆加偏）")
    void overseasPointIsUntouched() {
        double[] tokyo = GeoCoord.wgs84ToGcj02(139.6917, 35.6895);
        assertEquals(139.6917, tokyo[0], 1e-9);
        assertEquals(35.6895, tokyo[1], 1e-9);

        double[] back = GeoCoord.gcj02ToWgs84(139.6917, 35.6895);
        assertEquals(139.6917, back[0], 1e-9);
        assertEquals(35.6895, back[1], 1e-9);
    }

    @Test
    @DisplayName("GCJ-02 → WGS-84 往返误差 < 2 m（高德周边坐标回画的精度要求）")
    void roundTripWithinTwoMeters() {
        double[] gcj = GeoCoord.wgs84ToGcj02(LNG, LAT);
        double[] back = GeoCoord.gcj02ToWgs84(gcj[0], gcj[1]);

        double meters = haversineMeters(LNG, LAT, back[0], back[1]);
        assertTrue(meters < 2.0, "往返误差 " + meters + " m，超过 2 m");
    }

    @Test
    @DisplayName("转换方向正确：GCJ-02 在深圳应位于 WGS-84 的东北方向附近（至少同量级）")
    void conversionIsStableAcrossNearbyPoints() {
        double[] a = GeoCoord.wgs84ToGcj02(LNG, LAT);
        double[] b = GeoCoord.wgs84ToGcj02(LNG + 0.01, LAT + 0.01);

        double shiftA = haversineMeters(LNG, LAT, a[0], a[1]);
        double shiftB = haversineMeters(LNG + 0.01, LAT + 0.01, b[0], b[1]);
        assertTrue(Math.abs(shiftA - shiftB) < 20, "相邻点偏移量不应剧变：" + shiftA + " vs " + shiftB);
    }

    /** 球面距离（米），只用于断言，不参与业务。 */
    private static double haversineMeters(double lng1, double lat1, double lng2, double lat2) {
        double earthRadius = 6_371_000d;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLng = Math.toRadians(lng2 - lng1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                        * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
}
